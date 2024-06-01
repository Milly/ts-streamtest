import { describe, it } from "bdd";
import { testStream } from "@milly/streamtest";
import { UpperCase } from "./upper_case.ts";

describe("UpperCase", () => {
  it("should enqueue upper case", async () => {
    await testStream(async ({ readable, assertReadable }) => {
      const stream = readable("a--b--c--d--|");
      const expectedSeries = " A--B--C--D--|";

      const actual = stream.pipeThrough(new UpperCase());

      await assertReadable(actual, expectedSeries);
    });
  });
});
