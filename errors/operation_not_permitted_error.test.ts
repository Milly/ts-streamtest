import { describe, it } from "bdd";
import { assertEquals, assertInstanceOf } from "@std/assert";
import { OperationNotPermittedError } from "./operation_not_permitted_error.ts";

describe("OperationNotPermittedError", () => {
  it("should be able to instantiate", () => {
    const error = new OperationNotPermittedError();

    assertInstanceOf(error, OperationNotPermittedError);
  });
  it("should be able to instantiate", () => {
    const error = new OperationNotPermittedError();

    assertInstanceOf(error, OperationNotPermittedError);
  });
  it("should have a name", () => {
    const error = new OperationNotPermittedError();

    assertEquals(error.name, "OperationNotPermittedError");
  });
  it("should have a static name", () => {
    assertEquals(OperationNotPermittedError.name, "OperationNotPermittedError");
  });
  it("should have a message", () => {
    const error = new OperationNotPermittedError();

    assertEquals(error.message, "");
  });
  it("should have a stack", () => {
    const error = new OperationNotPermittedError();

    assertEquals(typeof error.stack, "string");
  });
  it("should be able to specify the message", () => {
    const error = new OperationNotPermittedError("foo");

    assertEquals(error.message, "foo");
  });
});
