/// <reference lib="dom" />
/// <reference types="npm:@types/mocha" />

const TESTS_SOURCE = "./stdin.js";

const TEST_DONE = "test-done";
export type TestDone = typeof TEST_DONE;

export type TestResult = { errors: number };
export type TestGlobal = { testResult?: TestResult };

declare const mocha: BrowserMocha;

mocha.setup({
  ui: "bdd",
  reporter: "spec",
  timeout: 30_000,
  color: true,
});
mocha.checkLeaks();
await import(TESTS_SOURCE);
(globalThis as { Deno: unknown }).Deno = { noColor: true };
mocha.run((errors) => {
  (globalThis as TestGlobal).testResult = { errors };
  console.log(TEST_DONE);
});
