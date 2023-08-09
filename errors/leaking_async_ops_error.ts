import { TestStreamError } from "./test_stream_error.ts";

export class LeakingAsyncOpsError extends TestStreamError {
  override name = "LeakingAsyncOpsError";
}
