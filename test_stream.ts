/** A library for testing streams.
 * Provides helper functions that make it easier to test streams with various
 * scenarios and assertions.
 *
 * @module
 */

import { assertEquals } from "https://deno.land/std@0.197.0/assert/assert_equals.ts";
import { AssertionError } from "https://deno.land/std@0.197.0/assert/assertion_error.ts";
import { FakeTime } from "https://deno.land/std@0.197.0/testing/time.ts";
import { getLogger } from "https://deno.land/std@0.197.0/log/mod.ts";
import {
  MaxTicksExceededError,
  OperationNotPermittedError,
} from "./errors/mod.ts";

function logger() {
  return getLogger("testStream");
}

const DEFAULT_TICK_TIME = 100;
const DEFAULT_MAX_TICKS = 50;

const ANY_VALUE = Object.freeze(new (class AnyValue {})());

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
  (helper: TestStreamHelper): Promise<void>;
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

type FrameType = "tick" | "enqueue" | "close" | "error";

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

  const lock = <T>(fn: () => T): T => {
    if (disposed) {
      throw new OperationNotPermittedError(
        "Helpers does not allow call outside `testStream`",
      );
    }
    if (locked) {
      throw new OperationNotPermittedError(
        "Helpers does not allow concurrent call",
      );
    }
    locked = true;
    try {
      const p = fn();
      if (p instanceof Promise) {
        return p.finally(() => locked = false) as T;
      } else {
        locked = false;
        return p;
      }
    } catch (e: unknown) {
      locked = false;
      throw e;
    }
  };

  /** Returns a readable for the specified stream arguments. */
  const createStream = (...streamArgs: CreateStreamArgs): ReadableStream => {
    const frames = parseSeries(...streamArgs);
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
    logger().debug("processAllTicks(): start", { testStreamId });

    // This function runs in an asynchronous event loop.
    // Should always check whether the execution block has been disposed.
    while (!disposed) {
      logger().debug("processAllTicks(): tick", { testStreamId });
      const runners = [...readableRunnerMap.values()];

      for (const runner of runners) {
        runner.tick();
      }
      await time.runMicrotasks();

      // Abort when the execution block is disposed.
      if (disposed) break;

      logger().debug("processAllTicks(): postTick", { testStreamId });
      const results = runners.map((runner) => runner.postTick());
      await time.tickAsync(tickTime);
      await time.runMicrotasks();

      if (!results.includes(true)) break;
    }

    logger().debug("processAllTicks(): end", { testStreamId, disposed });
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
    const [series, values, error] = streamArgs;
    return createStream(series, values, error);
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

    if (fn) {
      let fnContinue = true;
      const fnRunner = async () => {
        await time.runMicrotasks();
        logger().debug("processStreams(): fn: start", { testStreamId });
        await fn(...wrappedStreams);
        logger().debug("processStreams(): fn: end", { testStreamId });
        fnContinue = false;
      };

      const ticksRunner = async () => {
        await time.runMicrotasks();
        await processAllTicks();
        while (fnContinue && !disposed && await time.nextAsync());
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
    logger().debug("assertReadable(): call", { testStreamId, streamArgs });
    const expected = createStream(...streamArgs);

    await processStreams([actual, expected]);

    assertFramesEquals(
      getRunner(actual).correctLog(),
      getRunner(expected).correctLog(),
    );
  };

  // deno-lint-ignore no-explicit-any
  const helperMethod = <T extends (...args: any[]) => any>(
    fn: T,
    name: string,
  ): T => {
    const obj = {
      [name](...args: Parameters<T>) {
        return lock(() => fn(...args));
      },
    };
    return obj[name] as T;
  };

  const helper: TestStreamHelper = {
    assertReadable: helperMethod(assertReadable, "assertReadable"),
    readable: helperMethod(createReadable, "readable"),
    run: helperMethod(processStreams, "run"),
  };

  const execute = async () => {
    try {
      await fn(helper);
    } finally {
      disposed = true;
      logger().debug("testStream(): end", { testStreamId });
    }
  };

  const time = new FakeTime();
  return execute()
    .finally(() => time.runAllAsync())
    .finally(() => time.restore())
    .finally(() => testStreamLocked = false);
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
  const [series, values = {}] = streamArgs;

  // Use ANY_VALUE if the 3rd argument is unspecified.
  // Otherwise use the value of it. This is to allow undefined.
  const error = streamArgs.length < 3 ? ANY_VALUE : streamArgs[2];

  if (series.includes("()")) {
    throw new SyntaxError(`Empty group: "${series}"`);
  }
  if (!/^(?:[^()]+|\([^()]+\))*$/.test(series)) {
    throw new SyntaxError(`Unmatched group parentheses: "${series}"`);
  }
  if (series && !/^[^#|]*. *\)? *$/.test(series)) {
    throw new SyntaxError(`Non-trailing close or error: "${series}"`);
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

  const { readable, controller, cancelSignal } = createControllReadable();
  const log: Frame[] = [];
  let done = false;
  let frameIndex = 0;
  let tickCount = 0;

  const addLog = (frame: Frame) => {
    log.push(frame);
    logger().debug("createRunnerFromFrames(): add", {
      testStreamId: currentTestStreamId,
      streamId,
      frame,
    });
  };

  const tick = (): void => {
    if (done) return;
    if (cancelSignal.aborted) {
      addLog({ type: "error", value: cancelSignal.reason });
      done = true;
      return;
    }
    while (frames[frameIndex]?.type === "enqueue") {
      const { type, value } = frames[frameIndex++];
      addLog({ type, value });
      controller.enqueue(value);
    }
    if (frameIndex >= frames.length) {
      done = true;
      return;
    } else {
      const { type, value } = frames[frameIndex++];
      switch (type) {
        case "tick": {
          addLog({ type });
          if (++tickCount >= maxTicks) {
            logger().debug("createRunnerFromFrames(): exceeded", {
              testStreamId: currentTestStreamId,
              streamId,
            });
            controller.error(
              new MaxTicksExceededError("Ticks exceeded", {
                cause: { maxTicks },
              }),
            );
            done = true;
          }
          break;
        }
        case "close": {
          addLog({ type });
          controller.close();
          done = true;
          break;
        }
        case "error": {
          addLog({ type, value });
          controller.error(value);
          done = true;
          break;
        }
      }
      return;
    }
  };

  const postTick = (): boolean => {
    if (done) return false;
    if (cancelSignal.aborted) {
      if (log.at(-1)?.type === "tick") {
        log.pop();
      }
      addLog({ type: "error", value: cancelSignal.reason });
      done = true;
      return false;
    }
    return !done;
  };

  const correctLog = (): Frame[] => log;

  return { id: streamId, readable, tick, postTick, correctLog };
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

  const abortController = new AbortController();
  const { signal } = abortController;
  const log: Frame[] = [];
  let done = false;
  let closed = false;
  let tickCount = 0;

  const addLog = (frame: Frame) => {
    log.push(frame);
    logger().debug("createRunnerFromStream(): add", {
      testStreamId: currentTestStreamId,
      streamId,
      frame,
    });
  };

  const readable = new ReadableStream<T>({
    start(controller) {
      source.pipeTo(
        new WritableStream<T>({
          write(chunk) {
            addLog({ type: "enqueue", value: chunk });
            controller.enqueue(chunk);
          },
          close() {
            closed = true;
            done = true;
            addLog({ type: "close" });
            controller.close();
          },
        }),
        { signal },
      ).catch((e) => {
        if (!closed && !(e instanceof MaxTicksExceededError)) {
          done = true;
          addLog({ type: "error", value: e });
          controller.error(e);
        }
      });
    },
    cancel(reason) {
      abortController.abort(reason);
    },
  });

  const tick = (): void => {
  };

  const postTick = (): boolean => {
    if (done) return false;
    addLog({ type: "tick" });
    if (++tickCount >= maxTicks) {
      logger().debug("createRunnerFromStream(): exceeded", {
        testStreamId: currentTestStreamId,
        streamId,
      });
      abortController.abort(
        new MaxTicksExceededError("Ticks exceeded", { cause: { maxTicks } }),
      );
      done = true;
    }
    return !done;
  };

  const correctLog = (): Frame[] => log;

  return { id: streamId, readable, tick, postTick, correctLog };
}

function assertFramesEquals(
  actual: readonly Frame[],
  expected: readonly Frame[],
): void {
  // Replace if error is ANY_VALUE.
  const actualLast = actual.at(-1);
  const expectedLast = expected.at(-1);
  if (
    actualLast?.type === "error" &&
    expectedLast?.type === "error" && expectedLast.value === ANY_VALUE
  ) {
    expected = [
      ...expected.slice(0, -1),
      { type: "error", value: actualLast.value },
    ];
  }

  // Make diffs easier to read.
  const [actualFrames, expectedFrames] = [actual, expected].map((frames) =>
    frames.map(({ type, value }) =>
      (type === "enqueue" || type === "error") ? { [type]: value } : type
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
