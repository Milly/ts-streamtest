import { describe, it } from "#bdd";
import { CurrentRuntime } from "@cross/runtime";
import { assertInstanceOf, assertMatch } from "@std/assert";
import { assertSpyCalls, stub } from "@std/testing/mock";
import { Logger } from "@std/log";
import { resetBaseTime, setupDebugLogger } from "./logger.ts";

describe("resetBaseTime()", () => {
  it("should reset base time", () => {
    resetBaseTime();
  });
});

if (CurrentRuntime !== "browser") {
  describe("setupDebugLogger()", () => {
    it("should returns debug logger", () => {
      const logger = setupDebugLogger();
      assertInstanceOf(logger, Logger);
    });
    it("should returns debug logger and outputs debug log to console", () => {
      const logger = setupDebugLogger();
      using console_log = stub(console, "log");
      logger.debug("foo");
      assertSpyCalls(console_log, 1);
      assertMatch(
        console_log.calls[0].args[0],
        /^[0-9]+\.[0-9]{3} DEBUG foo :/,
      );
    });
  });
}
