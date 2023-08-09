import { describe, it } from "https://deno.land/std@0.197.0/testing/bdd.ts";
import {
  assertEquals,
  assertInstanceOf,
} from "https://deno.land/std@0.197.0/assert/mod.ts";
import { LeakingAsyncOpsError } from "./leaking_async_ops_error.ts";

describe("LeakingAsyncOpsError", () => {
  it("should be able to instantiate", () => {
    const error = new LeakingAsyncOpsError();

    assertInstanceOf(error, LeakingAsyncOpsError);
  });
  it("should be able to instantiate", () => {
    const error = new LeakingAsyncOpsError();

    assertInstanceOf(error, LeakingAsyncOpsError);
  });
  it("should have a name", () => {
    const error = new LeakingAsyncOpsError();

    assertEquals(error.name, "LeakingAsyncOpsError");
  });
  it("should have a message", () => {
    const error = new LeakingAsyncOpsError();

    assertEquals(error.message, "");
  });
  it("should have a stack", () => {
    const error = new LeakingAsyncOpsError();

    assertEquals(typeof error.stack, "string");
  });
  it("should be able to specify the message", () => {
    const error = new LeakingAsyncOpsError("foo");

    assertEquals(error.message, "foo");
  });
});
