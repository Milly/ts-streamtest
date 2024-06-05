/**
 * Provides types for [streamtest][].
 *
 * [streamtest]: https://jsr.io/@milly/streamtest
 *
 * @module
 */

import type { MutableTuple } from "./internal/types.ts";

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
