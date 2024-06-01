import { CurrentRuntime } from "@cross/runtime";
import { ConsoleHandler, getLogger, setup } from "@std/log";
import { setLogger } from "../test_stream.ts";

let baseTime = 0;

export function resetBaseTime(): void {
  baseTime = Date.now();
}

export function setupDebugLogger(): void {
  const inspect = CurrentRuntime === "deno"
    ? Deno.inspect
    : (args: unknown) => JSON.stringify(args, null, 2);
  setup({
    handlers: {
      console: new ConsoleHandler("DEBUG", {
        formatter({ datetime, levelName, msg, args }) {
          return [
            ((datetime.getTime() - baseTime) / 1000).toFixed(3),
            levelName,
            msg,
            ":",
            inspect(args, { colors: true }),
          ].join(" ");
        },
      }),
    },
    loggers: {
      testStream: {
        level: "DEBUG",
        handlers: ["console"],
      },
    },
  });
  setLogger(getLogger("testStream"));
  resetBaseTime();
}
