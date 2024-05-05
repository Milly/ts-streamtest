import { TestStreamError } from "./test_stream_error.ts";

export class OperationNotPermittedError extends TestStreamError {
  static {
    this.prototype.name = "OperationNotPermittedError";
  }
}
