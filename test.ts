// deno-lint-ignore-file no-unused-vars require-await

import { assertEquals } from "https://deno.land/std@0.197.0/assert/assert_equals.ts";
import { testStream } from "./test_stream.ts";
import { UpperCase } from "./examples/upper_case.ts";

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

Deno.test("assertReadable", async () => {
  await testStream(async ({ assertReadable, readable }) => {
    const abortReason = new Error("abort");
    const values = {
      A: "foo",
      B: "bar",
      C: "baz",
    } as const;

    const stream = readable("--A--B--C--#", values, abortReason);
    const expectedSeries = " --A--B--C--#";
    const expectedValues = {
      A: "FOO",
      B: "BAR",
      C: "BAZ",
    };

    const actual = stream.pipeThrough(new UpperCase());

    await assertReadable(actual, expectedSeries, expectedValues, abortReason);
  });
});

Deno.test("run", async () => {
  await testStream(async ({ run, readable }) => {
    const stream = readable("--a--b--c--|");

    const actual = stream.pipeThrough(new UpperCase());

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
