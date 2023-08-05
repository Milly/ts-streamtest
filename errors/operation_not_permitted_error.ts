import { TestStreamError } from "./test_stream_error.ts";

export class OperationNotPermittedError extends TestStreamError {
  override name = "OperationNotPermittedError";
}
