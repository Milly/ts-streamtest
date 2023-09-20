# streamtest

[![license:MIT](https://img.shields.io/github/license/Milly/deno-streamtest)](LICENSE)
[![deno land](http://img.shields.io/badge/available%20on-deno.land/x-lightgrey.svg?logo=deno)](https://deno.land/x/streamtest)
[![Test](https://github.com/Milly/deno-streamtest/workflows/Test/badge.svg)](https://github.com/Milly/deno-streamtest/actions?query=workflow%3ATest)
[![codecov](https://codecov.io/gh/Milly/deno-streamtest/branch/master/graph/badge.svg?token=81L4DWDPIJ)](https://codecov.io/gh/Milly/deno-streamtest)

**streamtest** is a library for testing streams in [Deno](https://deno.land/).
Provides helper functions that make it easier to test streams with various
scenarios and assertions.

Inspired by the test helpers in [RxJS](https://rxjs.dev/).

## Define stream scenarios

A simple string `series` can be used to define values to be enqueued into a
stream and events such as closes and errors.

### Series for ReadableStream

This can be used with the `readable` or `assertReadable` helpers.

#### Series format

The following characters are available in the `series`:

- `\x20` : Space is ignored. Used to align columns.
- `-` : Advance 1 tick.
- `|` : Close the stream.
- `!` : Cancel the stream.
- `#` : Abort the stream.
- `(...)` : Groups characters. It does not advance ticks inside. After closing
  `)`, advance 1 tick.
- Characters with keys in `values` will have their values enqueued to the
  stream, and then advance 1 tick.
- Other characters are enqueued into the stream as a single character, and then
  advance 1 tick.

#### Example

- Series: `"  ---A--B(CD)--|"`
- Values: `{ A: "foo" }`

1. Waits 3 ticks.
2. "foo" is enqueued and waits 1 tick.
3. Waits 2 ticks.
4. "B" is enqueued and waits 1 tick.
5. "C" is enqueued, "D" is enqueued and waits 1 tick.
6. Waits 2 ticks.
7. Close the stream.

### Series for WritableStream

This can be used with the `writable` helper.

#### Series format

The following characters are available in the `series`:

- `\x20` : Space is ignored. Used to align columns.
- `-` : Advance 1 tick.
- `#` : Abort the stream.
- `<` : Apply backpressure. Then advance 1 tick.
- `>` : Release backpressure. Then advance 1 tick.

#### Example

- Series: `"  --- <-- >-- #  "`

1. Waits 3 ticks.
2. Apply backpressure. Flags the stream is not ready for writing.
3. Waits 3 ticks.
4. Release backpressure. Notify the data source that the stream is ready for
   writing.
5. Waits 3 ticks.
6. Abort the stream.

### Series for AbortSignal

This can be used with the `abort` helper.

#### Series format

The following characters are available in the `series`:

- `\x20` : Space is ignored. Used to align columns.
- `-` : Advance 1 tick.
- `!` : Abort the signal.

#### Example

- Series: `"  ----- !  "`

1. Waits 5 ticks.
2. Aborts the signal.

## API Reference

### `testStream`

Define a block to test streams. `TestStreamHelper` is passed to the function
specified for `testStream`, which has helper functions available only within
that function.

```typescript
import {
  testStream,
  type TestStreamHelper,
} from "https://deno.land/x/streamtest/test_stream.ts";

Deno.test("MyTransformer", async () => {
  await testStream(async (helper: TestStreamHelper) => {
    // ... test logic using helper.assertReadable, helper.readable, and helper.run ...
  });
});
```

### `readable` helper

Creates a `ReadableStream` with the specified `series`.

```typescript
import { testStream } from "https://deno.land/x/streamtest/test_stream.ts";

Deno.test("readable", async () => {
  await testStream(async ({ readable }) => {
    const abortReason = new Error("abort");
    const values = {
      A: "foo",
      B: "bar",
      C: "baz",
    } as const;

    // "a" ..sleep.. "b" ..sleep.. "c" ..sleep.. close
    const characterStream = readable("a--b--c--|");

    // ..sleep.. "foo" ..sleep.. "bar" ..sleep.. "baz" and close
    const stringStream = readable("   --A--B--(C|)", values);

    // "0" ..sleep.. "1" ..sleep.. "2" ..sleep.. abort
    const errorStream = readable("    012#", undefined, abortReason);

    // Now you can use the `*Stream` in your test logic.
  });
});
```

### `writable` helper

Creates a `WritableStream` with the specified `series`.

```typescript
import { testStream } from "https://deno.land/x/streamtest/test_stream.ts";

Deno.test("writable", async () => {
  await testStream(async ({ writable, readable, run, assertReadable }) => {
    const abortReason = new Error("abort");

    const dest = writable("  -----<------------- >  --#", abortReason);
    //     Backpressure range ____^^^^^^^^^^^^^^      ^
    //                    Aborts the dest stream ____/

    const source = readable("---a---b---c---d--- -  -----|");

    const intermediate = source.pipeThrough(new TransformStream());
    const expected = "       ---a---b-----------(cd)--!";
    //       Apply backpressure ____^            ^^
    // Release backpressure and emits "c", "d" _/

    await run([intermediate], async (intermediate) => {
      intermediate.pipeTo(dest).catch(() => {});
    });

    await assertReadable(intermediate, expected, {}, abortReason);
  });
});
```

### `assertReadable` helper

Asserts that the readable stream matches the specified `series`.

```typescript
import { testStream } from "https://deno.land/x/streamtest/test_stream.ts";
import { UpperCase } from "https://deno.land/x/streamtest/examples/upper_case.ts";

Deno.test("assertReadable", async () => {
  await testStream(async ({ assertReadable, readable }) => {
    const abortReason = new Error("abort");
    const values = {
      A: "foo",
      B: "bar",
      C: "baz",
    } as const;

    const source = readable("--A--B--C--#", values, abortReason);
    const expectedSeries = " --A--B--C--#";
    const expectedValues = {
      A: "FOO",
      B: "BAR",
      C: "BAZ",
    };

    const actual = source.pipeThrough(new UpperCase());

    await assertReadable(actual, expectedSeries, expectedValues, abortReason);
  });
});
```

### `abort` helper

Creates a `AbortSignal` with the specified `series`.

```typescript
import { assertEquals } from "https://deno.land/std/assert/assert_equals.ts";
import { testStream } from "https://deno.land/x/streamtest/test_stream.ts";
import { delay } from "https://deno.land/std/async/delay.ts";

Deno.test("readable", async () => {
  await testStream(async ({ abort, run }) => {
    const abortReason = new Error("abort");

    // ..sleep 3 ticks.. abort with `abortReason`
    const signal = abort("---!", abortReason);

    await run([], async () => {
      await delay(300 - 1);
      assertEquals(signal.aborted, false);

      await delay(2);
      assertEquals(signal.aborted, true);
      assertEquals(signal.reason, abortReason);
    });
  });
});
```

### `run` helper

Process the test streams inside the `run` block.

```typescript
import { assertEquals } from "https://deno.land/std/assert/assert_equals.ts";
import { testStream } from "https://deno.land/x/streamtest/test_stream.ts";
import { UpperCase } from "https://deno.land/x/streamtest/examples/upper_case.ts";

Deno.test("run", async () => {
  await testStream(async ({ run, readable }) => {
    const source = readable("--a--b--c--|");

    const actual = source.pipeThrough(new UpperCase());

    await run([actual], async (actual) => {
      const reader = actual.getReader();

      assertEquals(await reader.read(), { value: "A", done: false });
      assertEquals(await reader.read(), { value: "B", done: false });
      assertEquals(await reader.read(), { value: "C", done: false });
      assertEquals(await reader.read(), { value: undefined, done: true });

      reader.releaseLock();
    });
  });
});
```

## License

This library is licensed under the MIT License. See the [LICENSE](./LICENSE)
file for details.
