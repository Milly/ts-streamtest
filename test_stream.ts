/** A library for testing streams.
 * Provides helper functions that make it easier to test streams with various
 * scenarios and assertions.
 *
 * @module
 */

import { assertEquals } from "https://deno.land/std@0.199.0/assert/assert_equals.ts";
import { AssertionError } from "https://deno.land/std@0.199.0/assert/assertion_error.ts";
import { FakeTime } from "https://deno.land/std@0.199.0/testing/time.ts";
import { getLogger } from "https://deno.land/std@0.199.0/log/mod.ts";
import {
  LeakingAsyncOpsError,
  MaxTicksExceededError,
  OperationNotPermittedError,
  TestStreamError,
} from "./errors/mod.ts";

function logger() {
  return getLogger("testStream");
}

const DEFAULT_TICK_TIME = 100;
const DEFAULT_MAX_TICKS = 50;

const ANY_VALUE = Object.freeze(new (class AnyValue {})());
const NOOP = () => {};

/** Flag to prevent concurrent calls. */
let testStreamLocked = false;

/** Global testStream ID counter. For debugging. */
let currentTestStreamId = -1;

/** Global stream ID counter. For debugging. */
let nextStreamId = 0;

/** The arguments for the `testStream` function. */
export type TestStreamArgs =
  | [options: TestStreamDefinition]
  | [fn: TestStreamFn]
  | [options: Omit<TestStreamDefinition, "fn">, fn: TestStreamFn];

/** The options for the `testStream` function. */
export interface TestStreamDefinition {
  /**
   * The execution block of the `testStream` function.
   */
  fn: TestStreamFn;

  /**
   * The maximum number of ticks for test streams.
   * If the ticks exceed the specified number, the stream will be aborted.
   *
   * @default 50
   */
  maxTicks?: number;

  /**
   * The number of milliseconds to advance in one tick.
   *
   * @default 100
   */
  tickTime?: number;
}

/** Represents the execution block ot `testStream` function. */
export interface TestStreamFn {
  /**
   * The execution block of the `testStream` function.
   *
   * @param helper The test stream helper.
   * @returns A promise that resolves when the execution block is complete.
   */
  (helper: TestStreamHelper): Promise<void> | void;
}

/** Represents the helper functions provided in the `testStream` block. */
export interface TestStreamHelper {
  /**
   * Asserts that the readable stream matches the specified `series`.
   */
  assertReadable: TestStreamHelperAssertReadable;

  /**
   * Creates a `ReadableStream` with the specified `series`.
   */
  readable: TestStreamHelperReadable;

  /**
   * Process the test streams inside the `run` block.
   */
  run: TestStreamHelperRun;
}

/** Represents the `assertReadable` function of the test stream helper. */
export interface TestStreamHelperAssertReadable {
  /**
   * Make an assertion that actual matches the expected `series`. If not then reject.
   *
   * @see {@link readable} for more information on `series`.
   *
   * @template T The chunk type of the stream.
   * @param actual The actual readable stream.
   * @param expectedSeries The expected `series` for the readable stream.
   * @param [expectedValues] The record object to replace values for each character in `expectedSeries`.
   * @param [expectedError] The value that replaces the reason when the stream aborts.
   * @returns A promise that resolves when the assertion is complete.
   * @throws {SyntaxError} `series` is invalid format.
   * @throws {OperationNotPermittedError} Called concurrently or outside `testStream`.
   */
  <T>(
    actual: ReadableStream<T>,
    expectedSeries: string,
    expectedValues: Readonly<TestStreamValues<T>>,
    expectedError?: unknown,
  ): Promise<void>;
  (
    actual: ReadableStream<string>,
    expectedSeries: string,
    expectedValues?: Readonly<TestStreamValues<never>>,
    expectedError?: unknown,
  ): Promise<void>;
}

/** Represents the `readable` function of the test stream helper. */
export interface TestStreamHelperReadable {
  /**
   * Creates a `ReadableStream` with the specified `series`.
   *
   * The following characters are available in the `series`:
   *
   * - `\x20`  : Space is ignored. Used to align columns.
   * - `-`     : Advance 1 tick.
   * - `|`     : Close the stream.
   * - `!`     : Cancel the stream.
   * - `#`     : Abort the stream.
   * - `(...)` : Groups characters. It does not advance ticks inside.
   *             After closing `)`, advance 1 tick.
   * - Characters with keys in `values` will have their values enqueued to
   *   the stream, and then advance 1 tick.
   * - Other characters are enqueued into the stream as a single character,
   *   and then advance 1 tick.
   *
   * Example: `readable("  ---A--B(CD)--|", { A: "foo" })`
   *
   * 1. Waits 3 ticks.
   * 2. "foo" is enqueued and waits 1 tick.
   * 3. Waits 2 ticks.
   * 4. "B" is enqueued and waits 1 tick.
   * 5. "C" is enqueued, "D" is enqueued and waits 1 tick.
   * 6. Waits 2 ticks.
   * 7. Close the stream.
   *
   * @template T The chunk type of the stream.
   * @param series The string representing the progress of the ReadableStream.
   * @param [values] The store of values that replace chunks in the `series`.
   * @param [error] The value that replaces the reason when the stream aborts.
   * @returns The created ReadableStream.
   * @throws {SyntaxError} `series` is invalid format.
   * @throws {OperationNotPermittedError} Called concurrently or outside `testStream`.
   */
  (
    series: string,
    values?: Readonly<TestStreamValues<never>>,
    error?: unknown,
  ): ReadableStream<string>;
  <T>(
    series: string,
    values: Readonly<TestStreamValues<T>>,
    error?: unknown,
  ): ReadableStream<T>;
}

/** Represents the `run` function of the test stream helper. */
export interface TestStreamHelperRun {
  /**
   * Process the test streams inside the `run` block.
   *
   * @param streams Array of streams to process.
   * @param fn The `run` block in which the test streams are processed.
   * @returns A promise that resolves when the `run` block is complete.
   * @throws {OperationNotPermittedError} Called concurrently or outside `testStream`.
   */
  <T extends readonly [ReadableStream] | readonly ReadableStream[]>(
    streams: T,
    fn?: TestStreamHelperRunFn<T>,
  ): Promise<void>;
}

/** Represents the `run` block of the test stream helper. */
export interface TestStreamHelperRunFn<
  T extends readonly [ReadableStream] | readonly ReadableStream[],
> {
  /**
   * The `run` block in which the test streams are processed.
   *
   * @param streams Array of streams to process.
   * @returns A promise that resolves when the `run` block is complete.
   */
  (...streams: MutableTuple<T>): Promise<void> | void;
}

/** Represents the store of values that replace chunks in the `series`. */
export type TestStreamValues<T> = Record<string, T>;

type Frame = {
  type: FrameType;
  value?: unknown;
};

type FrameType = "tick" | "enqueue" | "close" | "cancel" | "error";

// deno-lint-ignore no-explicit-any
type Runner<T = any> = {
  id: number;
  readable: ReadableStream<T>;

  /**
   * Process one tick.
   */
  tick(): void;

  /**
   * Post-process after a tick.
   *
   * @returns `true` if it continues, `false` if it done.
   */
  postTick(): boolean;

  /**
   * Returns the processing log of the stream.
   *
   * @returns The processing log.
   */
  correctLog(): readonly Frame[];

  dispose(): void;
};

type CreateStreamArgs = [
  series: string,
  values?: Readonly<Record<string, unknown>>,
  error?: unknown,
];

type MutableTuple<T extends readonly unknown[]> =
  // deno-lint-ignore no-explicit-any
  ((...args: T) => any) extends ((...args: infer U) => any) ? U : never;

/**
 * Define a block to test streams.
 *
 * @param args The arguments for the `testStream` function.
 * @returns A promise that resolves when the `testStream` block is complete.
 * @throws {RangeError} Invalid option values.
 */
export function testStream(...args: TestStreamArgs): Promise<void> {
  const testStreamId = ++currentTestStreamId;
  logger().debug("testStream(): start", { testStreamId: currentTestStreamId });

  const { fn, tickTime, maxTicks } = testStreamDefinition(args);

  if (testStreamLocked) {
    throw new OperationNotPermittedError(
      "`testStream` does not allow concurrent call",
    );
  }
  testStreamLocked = true;

  const readableRunnerMap = new Map<ReadableStream, Runner>();
  let disposed = false;
  let locked = false;

  const assertNotDisposed = () => {
    if (disposed) {
      throw new OperationNotPermittedError(
        "Helpers does not allow call outside `testStream`",
      );
    }
  };

  const lock = (): void => {
    if (locked) {
      throw new OperationNotPermittedError(
        "Helpers does not allow concurrent call",
      );
    }
    locked = true;
  };

  const unlock = (): void => {
    locked = false;
  };

  /** Returns a readable for the specified stream arguments. */
  const createStream = (frames: Frame[]): ReadableStream => {
    const runner = createRunnerFromFrames(frames, maxTicks);
    readableRunnerMap.set(runner.readable, runner);
    return runner.readable;
  };

  /** Returns a runner for the specified stream. */
  const getRunner = <T>(stream: ReadableStream<T>): Runner<T> => {
    const runner = readableRunnerMap.get(stream)!;
    if (runner) return runner;
    const newRunner = createRunnerFromStream(stream, maxTicks);
    readableRunnerMap.set(stream, newRunner);
    return newRunner;
  };

  /** Process all ticks. */
  const processAllTicks = async (): Promise<void> => {
    // This function runs in an asynchronous event loop.
    // Should always check whether the execution block has been disposed.
    while (!disposed) {
      let runners: Runner[] = [];

      logger().debug("processAllTicks(): tick", { testStreamId });
      for (let index = 0; index < readableRunnerMap.size;) {
        runners = [...readableRunnerMap.values()];
        for (; index < runners.length; ++index) {
          runners[index].tick();
        }
        await time.tickAsync(0);
        if (disposed) return;
        await time.runMicrotasks();
        if (disposed) return;
      }

      logger().debug("processAllTicks(): postTick", { testStreamId });
      const results = runners.map((runner) => runner.postTick());
      await time.tickAsync(tickTime);

      // Exit if the continue flag is not included in results.
      if (!results.includes(true)) break;
    }
  };

  /** `readable` helper. */
  const createReadable: TestStreamHelperReadable = (
    ...streamArgs: CreateStreamArgs
  ): ReadableStream => {
    logger().debug("createReadable(): call", {
      testStreamId,
      streamId: nextStreamId,
      streamArgs,
    });
    const frames = parseSeries(...streamArgs);
    return createStream(frames);
  };

  /** `run` helper. */
  const processStreams: TestStreamHelperRun = async <
    T extends readonly ReadableStream[],
  >(
    streams: T,
    fn?: TestStreamHelperRunFn<T>,
  ): Promise<void> => {
    logger().debug("processStreams(): start", { testStreamId });

    // Register runners.
    const wrappedStreams = streams.map((s) =>
      getRunner(s).readable
    ) as MutableTuple<T>;

    await time.runMicrotasks();
    if (fn) {
      let fnContinue = true;
      const fnRunner = async () => {
        logger().debug("processStreams(): fn: start", { testStreamId });
        try {
          await fn(...wrappedStreams);
        } finally {
          fnContinue = false;
        }
        logger().debug("processStreams(): fn: end", { testStreamId });
      };

      const ticksRunner = async () => {
        do {
          await processAllTicks();
        } while (!disposed && (await time.nextAsync() || fnContinue));
      };

      await Promise.all([fnRunner(), ticksRunner()]);
    } else {
      await processAllTicks();
    }

    logger().debug("processStreams(): end", { testStreamId });
  };

  /** `assertReadable` helper. */
  const assertReadable: TestStreamHelperAssertReadable = async (
    actual: ReadableStream,
    ...streamArgs: CreateStreamArgs
  ): Promise<void> => {
    const [series, values = {}] = streamArgs;

    // Use ANY_VALUE if the error argument is unspecified.
    // Otherwise use the value of it. This is to allow undefined.
    const error = streamArgs.length < 3 ? ANY_VALUE : streamArgs[2];

    const expectedFrames = parseSeries(series, values, error);
    const expected = createStream(expectedFrames);
    await processStreams([actual, expected]);

    const actualLog = getRunner(actual).correctLog();
    const expectedLog = getRunner(expected).correctLog();
    assertFramesEquals(actualLog, expectedLog);
  };

  const helper: TestStreamHelper = {
    async assertReadable(...args: unknown[]): Promise<void> {
      logger().debug(`assertReadable(): call`, { testStreamId, args });
      try {
        assertNotDisposed();
        lock();
        try {
          await assertReadable(
            ...(args as Parameters<TestStreamHelperAssertReadable>),
          );
        } finally {
          unlock();
        }
      } catch (e: unknown) {
        fixStackTrace(e as Error, helper.assertReadable);
        throw e;
      }
    },
    // deno-lint-ignore no-explicit-any
    readable(...args: unknown[]): ReadableStream<any> {
      logger().debug(`readable(): call`, { testStreamId, args });
      try {
        assertNotDisposed();
        return createReadable(
          ...(args as Parameters<TestStreamHelperReadable>),
        );
      } catch (e: unknown) {
        fixStackTrace(e as Error, helper.readable);
        throw e;
      }
    },
    async run(...args: unknown[]): Promise<void> {
      logger().debug(`run(): call`, { testStreamId, args });
      try {
        assertNotDisposed();
        lock();
        try {
          await processStreams(...(args as Parameters<TestStreamHelperRun>));
        } finally {
          unlock();
        }
      } catch (e: unknown) {
        if (e instanceof TestStreamError) {
          fixStackTrace(e, helper.run);
        }
        throw e;
      }
    },
  };

  const executeFn = async () => {
    try {
      await fn(helper);
    } finally {
      // Sets the disposed flag immediately after the fn finishes.
      disposed = true;
    }
    if (locked) {
      throw new LeakingAsyncOpsError(
        "Helper function is still running, but `testStream` execution block ends." +
          " This is often caused by calling helper functions without using `await`.",
      );
    }
  };

  const time = new FakeTime();
  return executeFn()
    .finally(() => {
      // Dispose resources.
      for (const runner of readableRunnerMap.values()) {
        runner.dispose();
      }
      time.restore();
    })
    .finally(() => {
      // After dispose, unlock testStream.
      // This block must be separate Promise from the dispose block.
      // Ensures that all resources have been released when testStream settles.
      testStreamLocked = false;
      logger().debug("testStream(): end", { testStreamId });
    });
}

function testStreamDefinition(
  args: TestStreamArgs,
): Required<TestStreamDefinition> {
  let [optOrFn, fn] = args;
  if (typeof optOrFn === "function") {
    fn = optOrFn;
    optOrFn = {};
  } else {
    fn = fn ?? (optOrFn as TestStreamDefinition).fn;
  }
  const {
    tickTime = DEFAULT_TICK_TIME,
    maxTicks = DEFAULT_MAX_TICKS,
  } = optOrFn;

  if (tickTime < 0) {
    throw new RangeError("tickTime cannot go backwards", {
      cause: { tickTime },
    });
  }
  if (tickTime !== Math.floor(tickTime)) {
    throw new TypeError("tickTime should be an integer", {
      cause: { tickTime },
    });
  }

  if (maxTicks <= 0) {
    throw new RangeError("maxTicks cannot be 0 or less", {
      cause: { maxTicks },
    });
  }
  if (maxTicks !== Math.floor(maxTicks)) {
    throw new TypeError("maxTicks should be an integer", {
      cause: { maxTicks },
    });
  }

  return {
    fn,
    tickTime,
    maxTicks,
  };
}

function parseSeries(...streamArgs: CreateStreamArgs): Frame[] {
  const [series, values = {}, error = undefined] = streamArgs;

  if (series.includes("()")) {
    throw new SyntaxError(`Empty group: "${series}"`);
  }
  if (!/^(?:[^()]+|\([^()]+\))*$/.test(series)) {
    throw new SyntaxError(`Unmatched group parentheses: "${series}"`);
  }
  if (series && !/^[^|!#]*. *\)? *$/.test(series)) {
    throw new SyntaxError(`Non-trailing close: "${series}"`);
  }

  const frames: Frame[] = [];
  const seriesChars = [...series];
  let group = false;

  loop:
  for (let count = 0; count < seriesChars.length; ++count) {
    const c = seriesChars[count];

    switch (c) {
      case " ":
        break;
      case "-": {
        frames.push({ type: "tick" });
        break;
      }
      case "|": {
        frames.push({ type: "close" });
        break loop;
      }
      case "!": {
        frames.push({ type: "cancel", value: error });
        break loop;
      }
      case "#": {
        frames.push({ type: "error", value: error });
        break loop;
      }
      case "(": {
        group = true;
        break;
      }
      case ")": {
        group = false;
        frames.push({ type: "tick" });
        break;
      }
      default: {
        const value = values[c] ?? (Object.hasOwn(values, c) ? values[c] : c);
        frames.push({ type: "enqueue", value });
        if (!group) {
          frames.push({ type: "tick" });
        }
        break;
      }
    }
  }

  return frames;
}

function createControllReadable() {
  const abortController = new AbortController();
  let controller!: ReadableStreamDefaultController;
  const readable = new ReadableStream({
    start(con) {
      controller = con;
    },
    cancel(reason) {
      abortController.abort(reason);
    },
  });
  return { readable, controller, cancelSignal: abortController.signal };
}

function createRunnerFromFrames(
  frames: readonly Frame[],
  maxTicks: number,
): Runner {
  const streamId = nextStreamId++;
  logger().debug("createRunnerFromFrames(): call", {
    testStreamId: currentTestStreamId,
    streamId,
    frames,
  });

  if (frames.filter((f) => f.type === "tick").length > maxTicks) {
    throw new MaxTicksExceededError("Ticks exceeded", { cause: { maxTicks } });
  }

  const { readable, controller, cancelSignal } = createControllReadable();
  const log: Frame[] = [];
  let closed = false;
  let done = false;
  let frameIndex = -1;
  let tickCount = 0;

  const addLog = (frame: Frame) => {
    log.push(frame);
    logger().debug("createRunnerFromFrames(): add", {
      testStreamId: currentTestStreamId,
      streamId,
      frame,
    });
  };

  cancelSignal.addEventListener("abort", () => {
    if (!done) {
      closed = done = true;
      addLog({ type: "cancel", value: cancelSignal.reason });
    }
  });

  const tick = (): void => {
    if (done) return;
    while (++frameIndex < frames.length) {
      const { type, value } = frames[frameIndex];
      switch (type) {
        case "enqueue": {
          addLog({ type, value });
          controller.enqueue(value);
          break;
        }
        case "close": {
          closed = true;
          addLog({ type });
          controller.close();
          break;
        }
        case "cancel": {
          closed = true;
          addLog({ type, value });
          controller.close();
          break;
        }
        case "error": {
          closed = true;
          addLog({ type, value });
          controller.error(value);
          break;
        }
        case "tick": {
          return;
        }
      }
    }
    done = true;
  };

  const postTick = (): boolean => {
    const frame = frames[frameIndex];
    if (!closed && (!frame || frame.type === "tick") && tickCount < maxTicks) {
      addLog({ type: "tick" });
      if (++tickCount >= maxTicks) {
        logger().debug("createRunnerFromFrames(): exceeded", {
          testStreamId: currentTestStreamId,
          streamId,
        });
        done = true;
      }
    }
    return !done;
  };

  const correctLog = (): Frame[] => log;

  const dispose = () => {
    if (!closed) {
      controller.close();
      closed = true;
    }
  };

  return { id: streamId, readable, tick, postTick, correctLog, dispose };
}

function createRunnerFromStream<T>(
  source: ReadableStream<T>,
  maxTicks: number,
): Runner<T> {
  const streamId = nextStreamId++;
  logger().debug("createRunnerFromStream(): call", {
    testStreamId: currentTestStreamId,
    streamId,
  });

  const log: Frame[] = [];
  let closed = false;
  let done = false;
  let tickCount = 0;

  const addLog = (frame: Frame) => {
    log.push(frame);
    logger().debug("createRunnerFromStream(): add", {
      testStreamId: currentTestStreamId,
      streamId,
      frame,
    });
  };

  const reader = source.getReader();
  const readable = new ReadableStream<T>({
    start(controller) {
      (async () => {
        while (true) {
          const res = await reader.read();
          if (res.done) {
            if (!done) {
              closed = done = true;
              addLog({ type: "close" });
              controller.close();
            }
            break;
          } else {
            addLog({ type: "enqueue", value: res.value });
            controller.enqueue(res.value);
          }
        }
      })().catch((e) => {
        if (!done) {
          closed = done = true;
          addLog({ type: "error", value: e });
          controller.error(e);
        }
      }).finally(() => {
        reader.releaseLock();
        logger().debug("reader.releaseLock");
      });
    },
    cancel(reason) {
      closed = done = true;
      addLog({ type: "cancel", value: reason });
      return reader.cancel(reason);
    },
  });

  const tick = NOOP;

  const postTick = (): boolean => {
    if (done) return false;
    addLog({ type: "tick" });
    if (++tickCount >= maxTicks) {
      logger().debug("createRunnerFromStream(): exceeded", {
        testStreamId: currentTestStreamId,
        streamId,
      });
      done = true;
    }
    return !done;
  };

  const correctLog = (): Frame[] => log;

  const dispose = () => {
    if (!closed) {
      reader.cancel("testStream disposed");
    }
  };

  return { id: streamId, readable, tick, postTick, correctLog, dispose };
}

function assertFramesEquals(
  actual: readonly Frame[],
  expected: readonly Frame[],
): void {
  // Replace if error is ANY_VALUE.
  const actualLast = actual.at(-1);
  const expectedLast = expected.at(-1);
  if (
    actualLast && expectedLast &&
    (actualLast.type === "cancel" || actualLast.type === "error") &&
    actualLast.type === expectedLast.type && expectedLast.value === ANY_VALUE
  ) {
    expected = [...expected.slice(0, -1), { ...actualLast }];
  }

  // Make diffs easier to read.
  const [actualFrames, expectedFrames] = [actual, expected].map((frames) =>
    frames.map(({ type, value }) =>
      (type === "tick" || type === "close") ? type : { [type]: value }
    )
  );

  try {
    assertEquals(actualFrames, expectedFrames, "\0");
  } catch (e: unknown) {
    // Fix error message.
    throw new AssertionError(
      (e as Error).message.replace(/^.*?\0/, "Stream not matched"),
    );
  }
}

const fixedErrors = new WeakSet();
// deno-lint-ignore no-explicit-any
function fixStackTrace(e: object, ignoreFn: (...args: any[]) => any): void {
  if (!fixedErrors.has(e)) {
    // See: https://v8.dev/docs/stack-trace-api
    Error.captureStackTrace?.(e, ignoreFn);
    fixedErrors.add(e);
  }
}
