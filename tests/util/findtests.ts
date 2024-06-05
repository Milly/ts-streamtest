import { glob } from "glob";

export function findTests(): Promise<string[]> {
  return glob("**/*.test.ts", {
    ignore: [
      "node_modules/**",
      "**/findtests.test.ts",
    ],
    posix: true,
  });
}
