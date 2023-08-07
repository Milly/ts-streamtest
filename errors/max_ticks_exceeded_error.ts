import { TestStreamError } from "./test_stream_error.ts";

export class MaxTicksExceededError extends TestStreamError {
  override name = "MaxTicksExceededError";
}
