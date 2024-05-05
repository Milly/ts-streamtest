import { TestStreamError } from "./test_stream_error.ts";

export class MaxTicksExceededError extends TestStreamError {
  static {
    this.prototype.name = "MaxTicksExceededError";
  }
}
