import { glob } from "glob";

export function findTests(): Promise<string[]> {
  return glob("**/*.test.ts", {
    ignore: "node_modules/**",
    posix: true,
  });
}
