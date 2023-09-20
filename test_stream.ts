/** A library for testing streams.
 * Provides helper functions that make it easier to test streams with various
 * scenarios and assertions.
 *
 * @module
 */

import { assertEquals } from "https://deno.land/std@0.201.0/assert/assert_equals.ts";
import { AssertionError } from "https://deno.land/std@0.201.0/assert/assertion_error.ts";
import { deferred } from "https://deno.land/std@0.201.0/async/deferred.ts";
import { FakeTime } from "https://deno.land/std@0.201.0/testing/time.ts";
import type { Logger } from "https://deno.land/std@0.201.0/log/logger.ts";
import {
  LeakingAsyncOpsError,
  MaxTicksExceededError,
  OperationNotPermittedError,
  TestStreamError,
} from "./errors/mod.ts";

const DEFAULT_TICK_TIME = 100;
const DEFAULT_MAX_TICKS = 50;

const ANY_VALUE = Object.freeze(new (class AnyValue {})());
const NOOP = () => {};

type LogMethods = "debug" | "info" | "warning" | "error" | "critical";
type SimpleLogger = { [K in LogMethods]: Logger[K] };

let logger: SimpleLogger;
setLogger({
  debug: NOOP,
  info: NOOP,
  warning: NOOP,
  error: NOOP,
  critical: NOOP,
});

/**
 * Sets the logger instance for the testStream module.
 *
 * @param newLogger The logger instance to be set.
 */
export function setLogger(newLogger: SimpleLogger): void {
  logger = newLogger;
}

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
   * It should be an integer greater than or equal to 1.
   * If the ticks exceed the specified number, the stream will be aborted.
   *
   * @default 50
   */
  maxTicks?: number;

  /**
   * The number of milliseconds to advance in one tick.
   * It should be an integer greater than or equal to 1.
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
   * Creates an AbortSignal that aborts at the specified timing.
   */
  abort: TestStreamHelperAbort;

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

  /**
   * Creates a `WritableStream` with the specified `series`.
   */
  writable: TestStreamHelperWritable;
}

/** Represents the `abort` function of the test stream helper. */
export interface TestStreamHelperAbort {
  /**
   * Creates an AbortSignal that aborts at the specified timing.
   *
   * The following characters are available in the `series`:
   *
   * - `\x20`  : Space is ignored. Used to align columns.
   * - `-`     : Advance 1 tick.
   * - `!`     : Abort the signal with the specified `error` as a reason.
   *
   * Example: `abort("  -----!", "cancelled")`
   *
   * 1. Waits 5 ticks.
   * 2. Aborts the signal with the reason "cancelled".
   *
   * @param series The string representing the timing of abort.
   * @param [reason] The value that replaces the abort reason. Defaults to `DOMException`.
   * @returns An AbortSignal that aborts at the specified timing.
   * @throws {SyntaxError} `series` is invalid format.
   */
  (series: string, reason?: unknown): AbortSignal;
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
   * - `!`     : Cancel the stream with the specified `error` as a reason..
   * - `#`     : Abort the stream with the specified `error` as a reason.
   * - `(...)` : Groups characters. It does not advance ticks inside.
   *             After closing `)`, advance 1 tick.
   * - Characters with keys in `values` will have their values enqueued to
   *   the stream. Then advance 1 tick.
   * - Other characters are enqueued into the stream as a single character.
   *   Then advance 1 tick.
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

/** Represents the `writable` function of the test stream helper. */
export interface TestStreamHelperWritable {
  /**
   * Creates a `WritableStream` with the specified `series`.
   *
   * The following characters are available in the `series`:
   *
   * - `\x20`  : Space is ignored. Used to align columns.
   * - `-`     : Advance 1 tick.
   * - `#`     : Abort the stream with the specified `error` as a reason.
   * - `<`     : Apply backpressure. Then advance 1 tick.
   * - `>`     : Release backpressure. Then advance 1 tick.
   *
   * Example: `writable("  ---<-->--#", "error")`
   *
   * 1. Waits 3 ticks.
   * 2. Apply backpressure. Flags the stream is not ready for writing.
   * 3. Waits 3 ticks.
   * 4. Release backpressure. Notify the data source that the stream is ready for writing.
   * 5. Waits 3 ticks.
   * 6. Abort the stream with "error".
   *
   * @template T The chunk type of the stream.
   * @param series The string representing the progress of the WritableStream.
   * @param [error] The value that replaces the reason when the stream aborts.
   * @returns The created WritableStream.
   * @throws {SyntaxError} `series` is invalid format.
   */
  // deno-lint-ignore no-explicit-any
  <T = any>(
    series?: string,
    error?: unknown,
  ): WritableStream<T>;
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

type FrameType =
  | "tick"
  | "enqueue"
  | "close"
  | "cancel"
  | "error"
  | "backpressure";

type Runner = {
  id: number;

  /**
   * Process one tick.
   */
  tick(): void;

  /**
   * Post-process after a tick.
   *
   * @returns `true` if it done, `false` if it continues.
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

// deno-lint-ignore no-explicit-any
type ReadableRunner<T = any> = Runner & {
  readable: ReadableStream<T>;
};

// deno-lint-ignore no-explicit-any
type WritableRunner<T = any> = Runner & {
  writable: WritableStream<T>;
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
  logger.debug("testStream(): start", { testStreamId: currentTestStreamId });

  const { fn, tickTime, maxTicks } = testStreamDefinition(args);

  if (testStreamLocked) {
    throw new OperationNotPermittedError(
      "`testStream` does not allow concurrent call",
    );
  }
  testStreamLocked = true;

  const streamRunnerMap = new Map<
    ReadableStream | WritableStream,
    ReadableRunner | WritableRunner
  >();
  const activeRunners = new Set<Runner>();
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

  /** Returns a readable for the specified frames. */
  const createReadableFromFrame = (frames: Frame[]): ReadableStream => {
    const runner = createReadableRunnerFromFrames(frames, maxTicks);
    streamRunnerMap.set(runner.readable, runner);
    activeRunners.add(runner);
    return runner.readable;
  };

  /** Returns a writable for the specified frames. */
  const createWritableFromFrame = (frames: Frame[]): WritableStream => {
    const runner = createWritableRunnerFromFrames(frames, maxTicks);
    streamRunnerMap.set(runner.writable, runner);
    activeRunners.add(runner);
    return runner.writable;
  };

  /** Returns a runner for the specified stream. */
  const getRunner = <T>(stream: ReadableStream<T>): ReadableRunner<T> => {
    const runner = streamRunnerMap.get(stream) as ReadableRunner<T>;
    if (runner) return runner;
    const newRunner = createReadableRunnerFromStream(stream, maxTicks);
    streamRunnerMap.set(stream, newRunner);
    activeRunners.add(newRunner);
    return newRunner;
  };

  /** Process all ticks. */
  const processAllTicks = async (): Promise<void> => {
    // This function runs in an asynchronous event loop.
    // Should always check whether the execution block has been disposed.
    while (!disposed && activeRunners.size > 0) {
      const processedRunners = new Set<Runner>();

      logger.debug("processAllTicks(): tick", { testStreamId });
      do {
        for (const runner of activeRunners) {
          if (!processedRunners.has(runner)) {
            runner.tick();
            processedRunners.add(runner);
          }
        }
        await time.tickAsync(0);
        if (disposed) return;
        await time.runMicrotasks();
        if (disposed) return;
      } while (processedRunners.size < activeRunners.size);

      logger.debug("processAllTicks(): postTick", { testStreamId });
      for (const runner of processedRunners) {
        if (runner.postTick()) {
          activeRunners.delete(runner);
        }
      }

      // Advances timer events in sequence until the next tick.
      let untilNext = true;
      fakeSetTimeout(() => untilNext = false, tickTime);
      do {
        // Do not use `nextAsync()` to avoid microtasks after `next`.
        await time.runMicrotasks();
        time.next();
        if (disposed) return;
      } while (untilNext);
    }
  };

  /** `readable` helper. */
  const createReadable: TestStreamHelperReadable = (
    ...streamArgs: CreateStreamArgs
  ): ReadableStream => {
    const frames = parseReadableSeries(...streamArgs);
    return createReadableFromFrame(frames);
  };

  /** `writable` helper. */
  const createWritable: TestStreamHelperWritable = (
    series = "",
    error?: unknown,
  ): WritableStream => {
    const frames = parseWritableSeries(series, error);
    return createWritableFromFrame(frames);
  };

  /** `abort` helper. */
  const createSignal: TestStreamHelperAbort = (
    series: string,
    reason?: unknown,
  ): AbortSignal => {
    const frames = parseSignalSeries(series, reason);
    const abortController = new AbortController();
    createReadableFromFrame(frames)
      .pipeTo(new WritableStream())
      .catch((reason) => abortController.abort(reason));
    return abortController.signal;
  };

  /** `run` helper. */
  const processStreams: TestStreamHelperRun = async <
    T extends readonly ReadableStream[],
  >(
    streams: T,
    fn?: TestStreamHelperRunFn<T>,
  ): Promise<void> => {
    logger.debug("processStreams(): start", { testStreamId });

    // Register runners.
    const wrappedStreams = streams.map((s) =>
      getRunner(s).readable
    ) as MutableTuple<T>;

    let fnContinue = false;
    const fnRunner = fn
      ? async () => {
        logger.debug("processStreams(): fn: start", { testStreamId });
        fnContinue = true;
        try {
          await fn(...wrappedStreams);
        } finally {
          fnContinue = false;
        }
        logger.debug("processStreams(): fn: end", { testStreamId });
      }
      : NOOP;

    const ticksRunner = async () => {
      do {
        await processAllTicks();
        if (disposed) return;
        // Do not use `nextAsync()` to avoid microtasks after `next`.
        await time.runMicrotasks();
        if (disposed) return;
      } while (time.next() || fnContinue || activeRunners.size > 0);
    };

    await time.runMicrotasks();
    await Promise.all([fnRunner(), ticksRunner()]);

    logger.debug("processStreams(): end", { testStreamId });
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

    const expectedFrames = parseReadableSeries(series, values, error);
    const expected = createReadableFromFrame(expectedFrames);
    await processStreams([actual, expected], (actual, expected) => {
      actual.pipeTo(new WritableStream()).catch(NOOP);
      expected.pipeTo(new WritableStream()).catch(NOOP);
    });
    if (disposed) return;

    const actualLog = getRunner(actual).correctLog();
    const expectedLog = getRunner(expected).correctLog();
    assertFramesEquals(actualLog, expectedLog);
  };

  const helper: TestStreamHelper = {
    abort(...args: unknown[]): AbortSignal {
      logger.debug(`abort(): call`, { testStreamId, args });
      try {
        assertNotDisposed();
        return createSignal(...(args as Parameters<TestStreamHelperAbort>));
      } catch (e: unknown) {
        fixStackTrace(e as Error, helper.abort);
        throw e;
      }
    },
    async assertReadable(...args: unknown[]): Promise<void> {
      logger.debug(`assertReadable(): call`, { testStreamId, args });
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
      logger.debug(`readable(): call`, { testStreamId, args });
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
      logger.debug(`run(): call`, { testStreamId, args });
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
    // deno-lint-ignore no-explicit-any
    writable(...args: unknown[]): WritableStream<any> {
      logger.debug(`writable(): call`, { testStreamId, args });
      try {
        assertNotDisposed();
        return createWritable(
          ...(args as Parameters<TestStreamHelperWritable>),
        );
      } catch (e: unknown) {
        fixStackTrace(e as Error, helper.writable);
        throw e;
      }
    },
  };

  const executeFn = async () => {
    logger.debug("testStream(): fn: start", { testStreamId });
    try {
      await fn(helper);
    } finally {
      // Sets the disposed flag immediately after the fn finishes.
      disposed = true;
      logger.debug("testStream(): fn: end", { testStreamId, locked });
    }
    if (locked) {
      throw new LeakingAsyncOpsError(
        "Helper function is still running, but `testStream` execution block ends." +
          " This is often caused by calling helper functions without using `await`.",
      );
    }
  };

  const time = new FakeTime();
  const fakeSetTimeout = setTimeout;
  return executeFn()
    .finally(() => {
      // Dispose resources.
      for (const runner of streamRunnerMap.values()) {
        runner.dispose();
      }
      time.restore();
    })
    .finally(() => {
      // After dispose, unlock testStream.
      // This block must be separate Promise from the dispose block.
      // Ensures that all resources have been released when testStream settles.
      testStreamLocked = false;
      logger.debug("testStream(): end", { testStreamId });
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

  if (tickTime <= 0) {
    throw new RangeError("tickTime should be 1 or more", {
      cause: { tickTime },
    });
  }
  if (tickTime !== Math.floor(tickTime)) {
    throw new TypeError("tickTime should be an integer", {
      cause: { tickTime },
    });
  }

  if (maxTicks <= 0) {
    throw new RangeError("maxTicks should be 1 or more", {
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
  let backpressure = false;

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
      case "<": {
        if (backpressure) {
          throw new SyntaxError(`Backpressure already applied: ${series}`);
        }
        backpressure = true;
        frames.push({ type: "backpressure", value: true });
        frames.push({ type: "tick" });
        break;
      }
      case ">": {
        if (!backpressure) {
          throw new SyntaxError(`Backpressure already released: ${series}`);
        }
        backpressure = false;
        frames.push({ type: "backpressure", value: false });
        frames.push({ type: "tick" });
        break;
      }
      default: {
        // Symbols other than alphabets and numbers in ASCII are reserved.
        if (/^[\0-\x2f\x3a-\x40\x5b-\x60\x7b-\x7f]$/.test(c)) {
          throw new SyntaxError(`Invalid character: "${series}"`);
        }
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

function parseReadableSeries(...streamArgs: CreateStreamArgs): Frame[] {
  const [series] = streamArgs;
  if (/[<>]/.test(series)) {
    throw new SyntaxError(`Invalid character: "${series}"`);
  }
  return parseSeries(...streamArgs);
}

function parseWritableSeries(series: string, error?: unknown): Frame[] {
  if (/[^-#<> ]/.test(series)) {
    throw new SyntaxError(`Invalid character: "${series}"`);
  }
  return parseSeries(series, {}, error);
}

function parseSignalSeries(series: string, reason?: unknown): Frame[] {
  if (/[^-! ]/.test(series)) {
    throw new SyntaxError(`Invalid character: "${series}"`);
  }
  series = series.replace("!", "#");
  return parseSeries(series, {}, reason);
}

function createControllReadable() {
  let onCancelCallbacks: ((reason: unknown) => void)[] = [];
  const onCancel = (callback: (reason: unknown) => void): void => {
    onCancelCallbacks.push(callback);
  };
  let controller!: ReadableStreamDefaultController;
  const readable = new ReadableStream({
    start(con) {
      controller = con;
    },
    cancel(reason) {
      for (const callback of onCancelCallbacks) {
        callback(reason);
      }
    },
  }, { highWaterMark: 0 });
  const dispose = () => {
    controller?.error("ReadableStream disposed");
    // deno-lint-ignore no-explicit-any
    controller = onCancelCallbacks = null as any;
  };
  return { readable, controller, onCancel, dispose };
}

function createReadableRunnerFromFrames(
  frames: readonly Frame[],
  maxTicks: number,
): ReadableRunner {
  const streamId = nextStreamId++;
  logger.debug("createReadableRunnerFromFrames(): call", {
    testStreamId: currentTestStreamId,
    streamId,
    frames,
  });

  if (frames.filter((f) => f.type === "tick").length > maxTicks) {
    throw new MaxTicksExceededError("Ticks exceeded", { cause: { maxTicks } });
  }

  const readable = createControllReadable();
  const log: Frame[] = [];
  let closed = false;
  let done = false;
  let frameIndex = -1;
  let tickCount = 0;

  const addLog = (frame: Frame) => {
    log.push(frame);
    logger.debug("createReadableRunnerFromFrames(): add", {
      testStreamId: currentTestStreamId,
      streamId,
      frame,
    });
  };

  readable.onCancel((reason) => {
    if (!done) {
      closed = done = true;
      addLog({ type: "cancel", value: reason });
    }
  });

  const tick = (): void => {
    if (done || closed) return;
    while (++frameIndex < frames.length) {
      const { type, value } = frames[frameIndex];
      switch (type) {
        case "enqueue": {
          addLog({ type, value });
          readable.controller.enqueue(value);
          break;
        }
        case "close": {
          closed = true;
          addLog({ type });
          readable.controller.close();
          break;
        }
        case "cancel": {
          closed = true;
          addLog({ type, value });
          readable.controller.close();
          break;
        }
        case "error": {
          closed = true;
          addLog({ type, value });
          readable.controller.error(value);
          break;
        }
        case "tick": {
          return;
        }
      }
    }
  };

  const postTick = (): boolean => {
    if (done || closed) return true;
    const frame = frames[frameIndex];
    if ((!frame || frame.type === "tick") && tickCount < maxTicks) {
      addLog({ type: "tick" });
      if (++tickCount >= maxTicks) {
        logger.debug("createReadableRunnerFromFrames(): exceeded", {
          testStreamId: currentTestStreamId,
          streamId,
        });
        done = true;
      }
    }
    return done || closed;
  };

  const correctLog = (): Frame[] => log;

  const dispose = () => {
    if (!closed) {
      closed = true;
      readable.controller.close();
    }
    readable.dispose();
  };

  return {
    id: streamId,
    readable: readable.readable,
    tick,
    postTick,
    correctLog,
    dispose,
  };
}

function createReadableRunnerFromStream<T>(
  source: ReadableStream<T>,
  maxTicks: number,
): ReadableRunner<T> {
  const streamId = nextStreamId++;
  logger.debug("createReadableRunnerFromStream(): call", {
    testStreamId: currentTestStreamId,
    streamId,
  });

  const log: Frame[] = [];
  let closed = false;
  let done = false;
  let tickCount = 0;
  let reading = deferred<void>();
  reading.resolve();

  const addLog = (frame: Frame) => {
    log.push(frame);
    logger.debug("createReadableRunnerFromStream(): add", {
      testStreamId: currentTestStreamId,
      streamId,
      frame,
    });
  };

  let readableController: ReadableStreamDefaultController;
  const readable = new ReadableStream<T>({
    start(controller) {
      readableController = controller;
    },
    async pull(controller) {
      reading = deferred();
      try {
        const res = await reader.read();
        if (!res.done) {
          addLog({ type: "enqueue", value: res.value });
          controller.enqueue(res.value);
        }
      } finally {
        reading.resolve();
      }
    },
    cancel(reason) {
      if (!closed) {
        closed = done = true;
        addLog({ type: "cancel", value: reason });
        return reader.cancel(reason);
      }
    },
  }, { highWaterMark: 0 });

  let reader = source.getReader();
  reader.closed.then(
    async () => {
      if (!closed) {
        await reading;
        closed = done = true;
        addLog({ type: "close" });
        readableController.close();
      }
    },
    (reason) => {
      if (!closed) {
        closed = done = true;
        addLog({ type: "error", value: reason });
        readableController.error(reason);
      }
    },
  ).finally(() => {
    reader?.releaseLock();
  });

  const tick = NOOP;

  const postTick = (): boolean => {
    if (done) return true;
    addLog({ type: "tick" });
    if (++tickCount >= maxTicks) {
      logger.debug("createReadableRunnerFromStream(): exceeded", {
        testStreamId: currentTestStreamId,
        streamId,
      });
      done = true;
    }
    return done;
  };

  const correctLog = (): Frame[] => log;

  const dispose = () => {
    if (!closed) {
      closed = done = true;
      reader.cancel("testStream disposed");
      reader.releaseLock();
    }
    // deno-lint-ignore no-explicit-any
    readableController = reader = null as any;
  };

  return { id: streamId, readable, tick, postTick, correctLog, dispose };
}

function createWritableRunnerFromFrames(
  frames: readonly Frame[],
  maxTicks: number,
): WritableRunner {
  const streamId = nextStreamId++;
  logger.debug("createWritableRunnerFromFrames(): call", {
    testStreamId: currentTestStreamId,
    streamId,
    frames,
  });

  if (frames.filter((f) => f.type === "tick").length > maxTicks) {
    throw new MaxTicksExceededError("Ticks exceeded", { cause: { maxTicks } });
  }

  const log: Frame[] = [];
  let closed = false;
  let done = false;
  let frameIndex = -1;
  let tickCount = 0;
  let ready = deferred<void>();
  ready.resolve();

  let writableController: WritableStreamDefaultController;
  const writable = new WritableStream({
    start(controller) {
      writableController = controller;
    },
    write(value) {
      logger.debug("createWritableRunnerFromFrames(): write", {
        testStreamId: currentTestStreamId,
        streamId,
        ready: ready.state,
      });
      addLog({ type: "enqueue", value });
      return ready;
    },
    close() {
      closed = done = true;
      addLog({ type: "close" });
    },
    abort(reason) {
      closed = done = true;
      addLog({ type: "error", value: reason });
    },
  }, { highWaterMark: 1 });

  const addLog = (frame: Frame) => {
    log.push(frame);
    logger.debug("createWritableRunnerFromFrames(): add", {
      testStreamId: currentTestStreamId,
      streamId,
      frame,
    });
  };

  const tick = (): void => {
    if (done || closed) return;
    while (++frameIndex < frames.length) {
      const { type, value } = frames[frameIndex];
      switch (type) {
        case "backpressure": {
          logger.debug("createWritableRunnerFromFrames(): backpressure", {
            testStreamId: currentTestStreamId,
            streamId,
            apply: value,
          });
          if (value) {
            ready = deferred();
          } else {
            ready.resolve();
          }
          break;
        }
        case "error": {
          closed = done = true;
          addLog({ type, value });
          ready.reject(value);
          writableController.error(value);
          break;
        }
        case "tick": {
          return;
        }
      }
    }
  };

  const postTick = (): boolean => {
    if (done || closed) return true;
    const frame = frames[frameIndex];
    if ((!frame || frame.type === "tick") && tickCount < maxTicks) {
      addLog({ type: "tick" });
      if (++tickCount >= maxTicks) {
        logger.debug("createWritableRunnerFromFrames(): exceeded", {
          testStreamId: currentTestStreamId,
          streamId,
        });
        done = true;
      }
    }
    return done || closed;
  };

  const correctLog = (): Frame[] => log;

  const dispose = () => {
    if (!closed) {
      closed = true;
      writableController.error("testStream disposed");
    }
    // deno-lint-ignore no-explicit-any
    writableController = null as any;
  };

  return {
    id: streamId,
    tick,
    postTick,
    correctLog,
    dispose,
    writable,
  };
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
