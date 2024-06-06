import { assertExists } from "@std/assert";

const FILES = ["README.md"];

for (const file of FILES) {
  Deno.test(file, async (t) => {
    for await (const { subject, codeBlock } of findCodeBlocks(file)) {
      await t.step(subject, async (t) => {
        await t.step("should importable", async () => {
          const mod = await evalCode(codeBlock);
          assertExists(mod);
        });
      });
    }
  });
}

for (const file of FILES) {
  for await (const { codeBlock } of findCodeBlocks(file)) {
    await evalCode(codeBlock);
  }
}

async function* findCodeBlocks(file: string) {
  const decoder = new TextDecoder("utf-8");
  const markdown = decoder.decode(await Deno.readFile(file));
  const codeReg = /^```(?:typescript|ts)\n(.*?)```/dgms;
  let lastIndex = 0;
  for (const { 1: codeBlock, indices } of markdown.matchAll(codeReg)) {
    const [start, end] = indices![0];
    const prevSection = "\n" + markdown.slice(lastIndex, start);
    const subjectMatch = prevSection.match(/.*\n(#+ [^\n]+)/s);
    const { 1: subject } = { 1: "UNKNOWN", ...subjectMatch };
    lastIndex = end;
    yield { subject, codeBlock };
  }
}

async function evalCode(code: string): Promise<unknown> {
  const blob = new Blob([code], { type: "text/typescript" });
  const url = URL.createObjectURL(blob);
  try {
    return await import(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}
