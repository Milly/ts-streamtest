import { describe, it } from "@std/testing/bdd";
import { assertEquals, assertInstanceOf } from "@std/assert";
import { MaxTicksExceededError } from "./max_ticks_exceeded_error.ts";

describe("MaxTicksExceededError", () => {
  it("should be able to instantiate", () => {
    const error = new MaxTicksExceededError();

    assertInstanceOf(error, MaxTicksExceededError);
  });
  it("should be able to instantiate", () => {
    const error = new MaxTicksExceededError();

    assertInstanceOf(error, MaxTicksExceededError);
  });
  it("should have a name", () => {
    const error = new MaxTicksExceededError();

    assertEquals(error.name, "MaxTicksExceededError");
  });
  it("should have a message", () => {
    const error = new MaxTicksExceededError();

    assertEquals(error.message, "");
  });
  it("should have a stack", () => {
    const error = new MaxTicksExceededError();

    assertEquals(typeof error.stack, "string");
  });
  it("should be able to specify the message", () => {
    const error = new MaxTicksExceededError("foo");

    assertEquals(error.message, "foo");
  });
});
