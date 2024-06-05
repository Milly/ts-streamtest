import { describe, it } from "#bdd";
import { assertArrayIncludes } from "@std/assert";
import { findTests } from "./findtests.ts";

describe("findTest()", () => {
  it("should resolves test file paths", async () => {
    const actual = await findTests();
    assertArrayIncludes(actual, [
      "test_stream.test.ts",
    ]);
  });
});
