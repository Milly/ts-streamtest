/// <reference lib="dom" />
/// <reference types="npm:@types/mocha" />

declare global {
  interface Window {
    mocha: BrowserMocha;
  }
}

const TESTS_SOURCE = "./stdin.js";

const TEST_DONE = "test-done";
export type TestDone = typeof TEST_DONE;

export type TestResult = { errors: number };
export type TestGlobal = { testResult?: TestResult };

let errors = 0;
try {
  mocha.setup({
    ui: "bdd",
    reporter: "spec",
    timeout: 30_000,
    color: true,
  });
  mocha.checkLeaks();

  await import(TESTS_SOURCE);

  errors = await new Promise<number>((resolve) => {
    mocha.run((errors) => resolve(errors));
  });
} catch (e: unknown) {
  console.log(`Error on setup:`, e);
  errors = 1;
} finally {
  (globalThis as TestGlobal).testResult = { errors };
  console.log(TEST_DONE);
}
