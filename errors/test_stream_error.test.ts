import { describe, it } from "https://deno.land/std@0.197.0/testing/bdd.ts";
import {
  assertEquals,
  assertInstanceOf,
} from "https://deno.land/std@0.197.0/assert/mod.ts";
import { TestStreamError } from "./test_stream_error.ts";

describe("TestStreamError", () => {
  it("should be able to instantiate", () => {
    const error = new TestStreamError();

    assertInstanceOf(error, TestStreamError);
  });
  it("should be able to instantiate", () => {
    const error = new TestStreamError();

    assertInstanceOf(error, TestStreamError);
  });
  it("should have a name", () => {
    const error = new TestStreamError();

    assertEquals(error.name, "TestStreamError");
  });
  it("should have a message", () => {
    const error = new TestStreamError();

    assertEquals(error.message, "");
  });
  it("should have a stack", () => {
    const error = new TestStreamError();

    assertEquals(typeof error.stack, "string");
  });
  it("should be able to specify the message", () => {
    const error = new TestStreamError("foo");

    assertEquals(error.message, "foo");
  });
});
