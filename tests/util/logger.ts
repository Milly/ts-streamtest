import { CurrentRuntime } from "@cross/runtime";
import { ConsoleHandler, getLogger, type Logger, setup } from "@std/log";

let baseTime = 0;

export function resetBaseTime(): void {
  baseTime = Date.now();
}

export function setupDebugLogger(): Logger {
  const fallback = {
    inspect: (args: unknown) => JSON.stringify(args, null, 2),
  };
  const { inspect } = CurrentRuntime === "deno" ? Deno : fallback;
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
  resetBaseTime();
  return getLogger("testStream");
}
