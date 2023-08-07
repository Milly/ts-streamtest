import {
  beforeEach,
  describe,
  it,
} from "https://deno.land/std@0.197.0/testing/bdd.ts";
import {
  assertSpyCalls,
  spy,
} from "https://deno.land/std@0.197.0/testing/mock.ts";
import {
  assert,
  assertEquals,
  assertFalse,
  assertInstanceOf,
  AssertionError,
  assertMatch,
  assertNotStrictEquals,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "https://deno.land/std@0.197.0/assert/mod.ts";
import * as log from "https://deno.land/std@0.197.0/log/mod.ts";
import { delay } from "https://deno.land/std@0.197.0/async/delay.ts";
import {
  MaxTicksExceededError,
  OperationNotPermittedError,
} from "./errors/mod.ts";
import {
  testStream,
  type TestStreamHelper,
  type TestStreamHelperAssertReadable,
  type TestStreamHelperReadable,
  type TestStreamHelperRun,
} from "./test_stream.ts";

let baseTime = Date.now();
try {
  if (Deno.env.has("TESTLOG")) {
    log.setup({
      handlers: {
        console: new log.handlers.ConsoleHandler("DEBUG", {
          formatter({ datetime, levelName, msg, args }) {
            return [
              ((datetime.getTime() - baseTime) / 1000).toFixed(3),
              levelName,
              msg,
              ":",
              Deno.inspect(args, { colors: true }),
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
  }
} catch (e: unknown) {
  if (!(e instanceof Deno.errors.PermissionDenied)) {
    throw e;
  }
}

class MyCustomError extends Error {
  override name = "MyCustomError";
}

const ABORT_REASON_CASES = [
  "foo",
  42,
  true,
  ["A", 12.3],
  { foo: "bar" },
  null,
  undefined,
  NaN,
] as const;

function toPrint(value: unknown): string {
  if (value == null) return `${value}`;
  if (typeof value === "number" && isNaN(value)) return "NaN";
  return JSON.stringify(value);
}

describe("testStream", () => {
  beforeEach(() => {
    baseTime = Date.now();
  });
  describe("arguments", () => {
    describe("(options)", () => {
      it("should call `options.fn`", async () => {
        const fn = spy(async () => {});

        await testStream({ fn });

        assertSpyCalls(fn, 1);
      });
    });
    describe("(fn)", () => {
      it("should call `fn`", async () => {
        const fn = spy(async () => {});

        await testStream(fn);

        assertSpyCalls(fn, 1);
      });
    });
    describe("(options, fn)", () => {
      it("should call `fn`", async () => {
        const fn = spy(async () => {});

        await testStream({}, fn);

        assertSpyCalls(fn, 1);
      });
      it("should not call `options.fn`", async () => {
        const fn = spy(async () => {});
        const shouldNotCall = spy(async () => {});

        // deno-lint-ignore no-explicit-any
        await testStream({ fn: shouldNotCall } as any, fn);

        assertSpyCalls(shouldNotCall, 0);
        assertSpyCalls(fn, 1);
      });
    });
  });
  describe("TestStreamDefinition", () => {
    describe(".fn", () => {
      it("should call the specified function once", async () => {
        const fn = spy(async () => {});

        await testStream({ fn });

        assertSpyCalls(fn, 1);
      });
    });
    describe(".maxTicks", () => {
      it("should aborts streams at 50 ticks if not specified", async () => {
        await testStream({
          async fn({ readable, run }) {
            const ticks = Array(49 + 1).join("-");
            const stream = readable(ticks + "ab|");

            const actual: string[] = [];
            const writable = new WritableStream<string>({
              write(chunk) {
                actual.push(chunk);
              },
            });

            await run([stream], async (stream) => {
              await assertRejects(
                () => {
                  return stream.pipeTo(writable);
                },
                MaxTicksExceededError,
                "Ticks exceeded",
              );
            });

            assertEquals(actual, ["a"]);
          },
        });
      });
      it("should aborts streams at the specified number of ticks", async () => {
        await testStream({
          maxTicks: 30,
          async fn({ readable, run }) {
            const ticks = Array(29 + 1).join("-");
            const stream = readable(ticks + "ab|");

            const actual: string[] = [];
            const writable = new WritableStream<string>({
              write(chunk) {
                actual.push(chunk);
              },
            });

            await run([stream], async (stream) => {
              await assertRejects(
                () => {
                  return stream.pipeTo(writable);
                },
                MaxTicksExceededError,
                "Ticks exceeded",
              );
            });

            assertEquals(actual, ["a"]);
          },
        });
      });
      it("should throws if 0 is specified", () => {
        assertThrows(
          () => {
            testStream({
              maxTicks: 0,
              async fn() {},
            });
          },
          RangeError,
          "maxTicks cannot be 0 or less",
        );
      });
      it("should throws if a negative value is specified", () => {
        assertThrows(
          () => {
            testStream({
              maxTicks: -1,
              async fn() {},
            });
          },
          RangeError,
          "maxTicks cannot be 0 or less",
        );
      });
      it("should throws if a float value is specified", () => {
        assertThrows(
          () => {
            testStream({
              maxTicks: 30.5,
              async fn() {},
            });
          },
          TypeError,
          "maxTicks should be an integer",
        );
      });
    });
    describe(".tickTime", () => {
      it("should advances 100 milliseconds in one tick if not specified", async () => {
        await testStream({
          async fn({ readable, run }) {
            const stream = readable("----|");
            let timer500Done = false;
            let timer501Done = false;
            setTimeout(() => timer500Done = true, 500);
            setTimeout(() => timer501Done = true, 501);

            await run([stream]);

            assert(timer500Done);
            assertFalse(timer501Done);
          },
        });
      });
      it("should advances the specified number of milliseconds in one tick", async () => {
        await testStream({
          tickTime: 250,
          async fn({ readable, run }) {
            const stream = readable("----|");
            let timer1250Done = false;
            let timer1251Done = false;
            setTimeout(() => timer1250Done = true, 1250);
            setTimeout(() => timer1251Done = true, 1251);

            await run([stream]);

            assert(timer1250Done);
            assertFalse(timer1251Done);
          },
        });
      });
      it("should not advances time if `0` is specified", async () => {
        await testStream({
          tickTime: 0,
          async fn({ readable, run }) {
            const stream = readable("----|");
            let timer0Done = false;
            let timer1Done = false;
            setTimeout(() => timer0Done = true, 0);
            setTimeout(() => timer1Done = true, 1);

            await run([stream]);

            assert(timer0Done, "Timer with `0` should be resolved");
            assertFalse(timer1Done);
          },
        });
      });
      it("should throws if a negative value is specified", () => {
        assertThrows(
          () => {
            testStream({
              tickTime: -1,
              async fn({ run }) {
                await run([]);
              },
            });
          },
          RangeError,
          "tickTime cannot go backwards",
        );
      });
      it("should throws if a float value is specified", () => {
        assertThrows(
          () => {
            testStream({
              tickTime: 0.5,
              async fn() {},
            });
          },
          TypeError,
          "tickTime should be an integer",
        );
      });
    });
  });
  describe("TestStreamFn", () => {
    it("should call the specified function once", async () => {
      const fn = spy(async () => {});

      await testStream(fn);

      assertSpyCalls(fn, 1);
    });
    it("should have TestStreamHelper in the first argument", async () => {
      const fn = spy(async (_helper: TestStreamHelper) => {});

      await testStream(fn);
      const helper = fn.calls[0].args[0];

      assertEquals(typeof helper, "object");
      assertInstanceOf(helper.assertReadable, Function);
      assertInstanceOf(helper.readable, Function);
      assertInstanceOf(helper.run, Function);
      assertEquals(
        Object.keys(helper).sort(),
        [
          "assertReadable",
          "readable",
          "run",
        ] satisfies (keyof TestStreamHelper)[],
      );
    });
    it("should rejects with the error thrown in the specified function", async () => {
      function Bar() {
        throw new MyCustomError();
      }
      const fn = async () => {
        // Push to asynchronous event queue.
        await Promise.resolve();
        Bar();
      };

      const actual = await assertRejects(
        () => {
          return testStream(fn);
        },
        MyCustomError,
      );
      if (actual.stack) {
        assertMatch(actual.stack, /Bar/);
      }
    });
    it("should throws if called within `testStream`", async () => {
      // deno-lint-ignore require-await
      await testStream(async () => {
        assertThrows(
          () => {
            testStream(async () => {});
          },
          OperationNotPermittedError,
          "`testStream` does not allow concurrent call",
        );
      });
    });
  });
  describe("TestStreamHelper", () => {
    describe(".assertReadable", () => {
      it("should throws if called within `run`", async () => {
        await testStream(async ({ assertReadable, run }) => {
          const stream = ReadableStream.from(["a", "b", "c"]);

          await run([], () => {
            assertThrows(
              () => {
                assertReadable(stream, "(abc|)");
              },
              OperationNotPermittedError,
              "Helpers does not allow concurrent call",
            );
          });
        });
      });
      it("should throws if called outside `testStream`", async () => {
        let savedAssertReadable: TestStreamHelperAssertReadable;
        const stream = ReadableStream.from(["a", "b", "c"]);

        // deno-lint-ignore require-await
        await testStream(async ({ assertReadable }) => {
          savedAssertReadable = assertReadable;
        });

        assertThrows(
          () => {
            savedAssertReadable(stream, "(abc|)");
          },
          OperationNotPermittedError,
          "Helpers does not allow call outside `testStream`",
        );
      });
      describe("(actual, expectedSeries, ...)", () => {
        it("should not rejects if actual matches expectedSeries", async () => {
          await testStream(async ({ assertReadable }) => {
            const stream = ReadableStream.from(["a", "b", "c"]);

            const p = assertReadable(stream, "(abc|)");
            const actual = await p.catch((e) => e);

            assertEquals(actual, undefined);
          });
        });
        it("should rejects if actual does not matches expectedSeries", async () => {
          await testStream(async ({ assertReadable }) => {
            const stream = ReadableStream.from(["a", "b", "c", "d"]);

            await assertRejects(
              () => {
                return assertReadable(stream, "(abc|)");
              },
              AssertionError,
              "Stream not matched",
            );
          });
        });
        it("should ignores ` `", async () => {
          await testStream(async ({ assertReadable }) => {
            const stream = new ReadableStream({
              async start(controller) {
                controller.enqueue("a");
                await delay(100);
                controller.enqueue("b");
                await delay(100);
                controller.enqueue("c");
                await delay(100);
                controller.close();
              },
            });

            await assertReadable(stream, "     a  bc |  ");
          });
        });
        it("should matchs `-` to one tick", async () => {
          await testStream(async ({ assertReadable }) => {
            const stream = new ReadableStream({
              async start(controller) {
                await delay(500);
                controller.enqueue("a");
                await delay(300);
                controller.enqueue("b");
                await delay(100);
                controller.enqueue("c");
                await delay(200);
                controller.close();
              },
            });

            await assertReadable(stream, "-----a--bc-|");
          });
        });
        it("should matchs `|` to close the stream", async () => {
          await testStream(async ({ assertReadable }) => {
            const stream = ReadableStream.from([]);

            await assertReadable(stream, "|");
          });
        });
        it("should matchs unclosed stream without `|`", async () => {
          await testStream({
            maxTicks: 5,
            fn: async ({ assertReadable }) => {
              const stream = new ReadableStream();

              await assertReadable(stream, "-----");
            },
          });
        });
        it("should matchs `#` to abort the stream", async () => {
          await testStream(async ({ assertReadable }) => {
            const stream = new ReadableStream({
              start(controller) {
                controller.error();
              },
            });

            await assertReadable(stream, "#");
          });
        });
        it("should matchs any character enqueue and one tick to the stream", async () => {
          await testStream(async ({ assertReadable }) => {
            const stream = new ReadableStream({
              async start(controller) {
                controller.enqueue("a");
                await delay(100);
                controller.enqueue("b");
                await delay(100);
                controller.enqueue("c");
                await delay(100);
                controller.close();
              },
            });

            await assertReadable(stream, "abc|");
          });
        });
        it("should matchs the stream that do not advance ticks within `(...)` and advance one tick after `)`", async () => {
          await testStream(async ({ assertReadable }) => {
            const stream = new ReadableStream({
              async start(controller) {
                controller.enqueue("a");
                await delay(100);
                controller.enqueue("b");
                controller.enqueue("c");
                await delay(100);
                controller.enqueue("d");
                controller.close();
              },
            });

            await assertReadable(stream, "a(bc)(d|)");
          });
        });
      });
      describe("(..., expectedValues, ...)", () => {
        it("should be possible to specify a record with any key and value", async () => {
          await testStream(async ({ assertReadable }) => {
            const stream = ReadableStream.from([
              "foo",
              42,
              true,
              ["A", 12.3],
              { foo: "bar" },
              null,
              undefined,
              NaN,
            ]);

            await assertReadable(stream, "(abcdefgh|)", {
              a: "foo",
              b: 42,
              c: true,
              d: ["A", 12.3],
              e: { foo: "bar" },
              f: null,
              g: undefined,
              h: NaN,
            });
          });
        });
        it("should be possible to specify an empty record", async () => {
          await testStream(async ({ assertReadable }) => {
            const stream = ReadableStream.from(["a", "b", "c"]);

            await assertReadable(stream, "(abc|)", {});
          });
        });
        it("should be possible to specify undefined", async () => {
          await testStream(async ({ assertReadable }) => {
            const stream = ReadableStream.from(["a", "b", "c"]);

            await assertReadable(stream, "(abc|)", undefined);
          });
        });
      });
      describe("(..., expectedError)", () => {
        it("should matchs any value if not specified", async () => {
          await testStream(async ({ assertReadable }) => {
            const stream = new ReadableStream({
              start(controller) {
                controller.error(new MyCustomError());
              },
            });

            await assertReadable(stream, "#");
          });
        });
        for (const error of ABORT_REASON_CASES) {
          it(`should matches ${toPrint(error)}`, async () => {
            await testStream(async ({ assertReadable }) => {
              const stream = new ReadableStream({
                start(controller) {
                  controller.error(error);
                },
              });

              await assertReadable(stream, "#", undefined, error);
            });
          });
        }
      });
      it("should match the stream created by `readable`", async () => {
        await testStream(async ({ assertReadable, readable }) => {
          const stream = readable("abcd|");

          await assertReadable(stream, "abcd|");
        });
      });
      it("should match the stream tansformed from `readable`", async () => {
        await testStream(async ({ assertReadable, readable }) => {
          const stream = readable("abcd|");

          const transformed = stream.pipeThrough(
            new TransformStream({
              transform(chunk, controller) {
                controller.enqueue(`${chunk}X`);
              },
            }),
          );

          await assertReadable(transformed, "ABCD|", {
            A: "aX",
            B: "bX",
            C: "cX",
            D: "dX",
          });
        });
      });
      it("should match the stream processed with `run`", async () => {
        await testStream(async ({ assertReadable, readable, run }) => {
          const stream = readable("abcd|");

          await run([stream], async (stream) => {
            await stream.pipeTo(
              new WritableStream(),
            );
          });

          await assertReadable(stream, "abcd|");
        });
      });
      it("should match the stream aborted with `run`", async () => {
        await testStream(async ({ assertReadable, readable, run }) => {
          const stream = readable("abcd|");

          await run([stream], async (stream) => {
            await stream.pipeTo(
              new WritableStream({
                write(chunk, controller) {
                  if (chunk === "c") {
                    controller.error("terminate");
                  }
                },
              }),
            ).catch(() => {});
          });

          await assertReadable(stream, "ab(c#)", undefined, "terminate");
        });
      });
      it("should match the stream asynchronously aborted with `run`", async () => {
        await testStream(async ({ assertReadable, readable, run }) => {
          const stream = readable("abcd|");

          await run([stream], async (stream) => {
            await stream.pipeTo(
              new WritableStream({
                write(chunk, controller) {
                  if (chunk === "c") {
                    setTimeout(() => controller.error("terminate"), 50);
                  }
                },
              }),
            ).catch(() => {});
          });

          await assertReadable(stream, "abc#", undefined, "terminate");
        });
      });
      it("should match the stream transformed from `readable` and processed with `run`", async () => {
        await testStream(async ({ assertReadable, readable, run }) => {
          const stream = readable("abcd|");

          const transformed = stream.pipeThrough(
            new TransformStream({
              transform(chunk, controller) {
                controller.enqueue(`${chunk}X`);
              },
            }),
          );

          await run([transformed], async (transformed) => {
            await transformed.pipeTo(
              new WritableStream(),
            );
          });

          await assertReadable(transformed, "ABCD|", {
            A: "aX",
            B: "bX",
            C: "cX",
            D: "dX",
          });
        });
      });
      it("should match the stream transformed from `readable` and aborted with `run`", async () => {
        await testStream(async ({ assertReadable, readable, run }) => {
          const stream = readable("abcd|");

          const transformed = stream.pipeThrough(
            new TransformStream({
              transform(chunk, controller) {
                controller.enqueue(`${chunk}X`);
              },
            }),
          );

          await run([transformed], async (transformed) => {
            await transformed.pipeTo(
              new WritableStream({
                write(chunk, controller) {
                  if (chunk === "cX") {
                    controller.error("terminate");
                  }
                },
              }),
            ).catch(() => {});
          });

          await assertReadable(transformed, "AB(C#)", {
            A: "aX",
            B: "bX",
            C: "cX",
          }, "terminate");
        });
      });
      it("should match the stream transformed from `readable` and asynchronously aborted with `run`", async () => {
        await testStream(async ({ assertReadable, readable, run }) => {
          const stream = readable("abcd|");

          const transformed = stream.pipeThrough(
            new TransformStream({
              transform(chunk, controller) {
                controller.enqueue(`${chunk}X`);
              },
            }),
          );

          await run([transformed], async (transformed) => {
            await transformed.pipeTo(
              new WritableStream({
                write(chunk, controller) {
                  if (chunk === "cX") {
                    setTimeout(() => controller.error("terminate"), 50);
                  }
                },
              }),
            ).catch(() => {});
          });

          await assertReadable(transformed, "ABC#", {
            A: "aX",
            B: "bX",
            C: "cX",
          }, "terminate");
        });
      });
    });
    describe(".readable", () => {
      it("should returns a readable stream", async () => {
        await testStream(async ({ readable, run }) => {
          const stream = readable("a-bc|");

          assertInstanceOf(stream, ReadableStream);

          const actual: unknown[] = [];
          stream.pipeTo(
            new WritableStream({
              write(chunk) {
                actual.push(chunk);
              },
            }),
          );
          await run([]);

          assertEquals(actual, ["a", "b", "c"]);
        });
      });
      it("should throws if called within `run`", async () => {
        await testStream(async ({ readable, run }) => {
          await run([], () => {
            assertThrows(
              () => {
                readable("abc|");
              },
              OperationNotPermittedError,
              "Helpers does not allow concurrent call",
            );
          });
        });
      });
      it("should throws if called outside `testStream`", async () => {
        let savedReadable: TestStreamHelperReadable;

        // deno-lint-ignore require-await
        await testStream(async ({ readable }) => {
          savedReadable = readable;
        });

        assertThrows(
          () => {
            savedReadable("abc|");
          },
          OperationNotPermittedError,
          "Helpers does not allow call outside `testStream`",
        );
      });
      describe("(series, ...)", () => {
        it("should be possible to specify an empty string", async () => {
          await testStream(async ({ readable, run }) => {
            const stream = readable("");

            assertInstanceOf(stream, ReadableStream);

            const actual: unknown[] = [];
            stream.pipeTo(
              new WritableStream({
                write(chunk) {
                  actual.push(chunk);
                },
              }),
            );
            await run([]);

            assertEquals(actual, []);
          });
        });
        for (
          const series of [
            "()",
            "abc()|",
          ]
        ) {
          it(`should throws if empty parentheses: ${toPrint(series)}`, async () => {
            // deno-lint-ignore require-await
            await testStream(async ({ readable }) => {
              assertThrows(
                () => {
                  readable(series);
                },
                SyntaxError,
                "Empty group",
              );
            });
          });
        }
        for (
          const series of [
            "(",
            ")",
            "ab(c|",
            "ab)c|",
          ]
        ) {
          it(`should throws if parentheses unmatched: ${toPrint(series)}`, async () => {
            // deno-lint-ignore require-await
            await testStream(async ({ readable }) => {
              assertThrows(
                () => {
                  readable(series);
                },
                SyntaxError,
                "Unmatched group parentheses",
              );
            });
          });
        }
        for (
          const series of [
            "ab|c",
            "a(|b)",
            "ab#c",
            "a(#b)",
            "abc|#",
            "abc#|",
          ]
        ) {
          it(`should throws if non-trailing close or error: ${toPrint(series)}`, async () => {
            // deno-lint-ignore require-await
            await testStream(async ({ readable }) => {
              assertThrows(
                () => {
                  readable(series);
                },
                SyntaxError,
                "Non-trailing close or error",
              );
            });
          });
        }
        it("should ignores ` `", async () => {
          await testStream(async ({ readable, run }) => {
            const stream = readable("   a   b c  |   ");

            const actual: unknown[] = [];
            stream.pipeTo(
              new WritableStream({
                write(chunk) {
                  actual.push(chunk);
                },
              }),
            );

            await run([], async () => {
              await delay(0);
              assertEquals(actual, ["a"]);
              await delay(100);
              assertEquals(actual, ["a", "b"]);
              await delay(100);
              assertEquals(actual, ["a", "b", "c"]);
              await delay(100);
              assertFalse(stream.locked, "Stream should closed");
            });
          });
        });
        it("should advances one tick with `-`", async () => {
          await testStream(async ({ readable, run }) => {
            const stream = readable("-----a--bc-|");

            const actual: unknown[] = [];
            stream.pipeTo(
              new WritableStream({
                write(chunk) {
                  actual.push(chunk);
                },
              }),
            );

            await run([], async () => {
              await delay(0);
              await delay(400);
              assertEquals(actual, []);
              await delay(100);
              assertEquals(actual, ["a"]);
              await delay(200);
              assertEquals(actual, ["a"]);
              await delay(100);
              assertEquals(actual, ["a", "b"]);
              await delay(100);
              assertEquals(actual, ["a", "b", "c"]);
              await delay(100);
              assert(stream.locked, "Stream should not closed");
              await delay(100);
              assertFalse(stream.locked, "Stream should closed");
            });
          });
        });
        it("should close the stream with `|`", async () => {
          await testStream(async ({ readable, run }) => {
            const stream = readable("|");

            stream.pipeTo(new WritableStream());

            await run([], async () => {
              await delay(0);
              assertFalse(stream.locked, "Stream should closed");
            });
          });
        });
        it("should not close the stream without `|`", async () => {
          await testStream(async ({ readable, run }) => {
            const abortController = new AbortController();
            const { signal } = abortController;
            const stream = readable("");

            const p = stream.pipeTo(new WritableStream(), { signal });
            p.catch(() => {});

            await run([], async () => {
              await delay(3000);
              assert(stream.locked, "Stream should not closed");
            });

            abortController.abort();
            await p.catch(() => {});
          });
        });
      });
      describe("(..., values, ...)", () => {
        it("should be possible to specify a record with any key and value", async () => {
          await testStream(async ({ readable, run }) => {
            const stream = readable("abcdefgh|", {
              a: "foo",
              b: 42,
              c: true,
              d: ["A", 12.3],
              e: { foo: "bar" },
              f: null,
              g: undefined,
              h: NaN,
            });

            assertInstanceOf(stream, ReadableStream);

            const actual: unknown[] = [];
            stream.pipeTo(
              new WritableStream({
                write(chunk) {
                  actual.push(chunk);
                },
              }),
            );
            await run([]);

            assertEquals(actual, [
              "foo",
              42,
              true,
              ["A", 12.3],
              { foo: "bar" },
              null,
              undefined,
              NaN,
            ]);
          });
        });
        it("should be possible to specify an empty record", async () => {
          await testStream(async ({ readable, run }) => {
            const stream = readable("a-bc|", {});

            assertInstanceOf(stream, ReadableStream);

            const actual: unknown[] = [];
            stream.pipeTo(
              new WritableStream({
                write(chunk) {
                  actual.push(chunk);
                },
              }),
            );
            await run([]);

            assertEquals(actual, ["a", "b", "c"]);
          });
        });
        it("should be possible to specify undefined", async () => {
          await testStream(async ({ readable, run }) => {
            const stream = readable("a-bc|", undefined);

            assertInstanceOf(stream, ReadableStream);

            const actual: unknown[] = [];
            stream.pipeTo(
              new WritableStream({
                write(chunk) {
                  actual.push(chunk);
                },
              }),
            );
            await run([]);

            assertEquals(actual, ["a", "b", "c"]);
          });
        });
      });
      describe("(..., error)", () => {
        it("should be undefined if not specified", async () => {
          await testStream(async ({ readable, run }) => {
            const stream = readable("a-bc#");

            assertInstanceOf(stream, ReadableStream);

            const p = stream.pipeTo(new WritableStream());
            p.catch(() => {});
            await run([]);

            const actual = await assertRejects(() => p);
            assertStrictEquals(actual, undefined);
          });
        });
        for (const error of ABORT_REASON_CASES) {
          it(`should be possible to specify ${toPrint(error)}`, async () => {
            await testStream(async ({ readable, run }) => {
              const stream = readable("a-bc#", undefined, error);

              assertInstanceOf(stream, ReadableStream);

              const p = stream.pipeTo(new WritableStream());
              p.catch(() => {});
              await run([]);

              const actual = await assertRejects(() => p);
              assertStrictEquals(actual, error);
            });
          });
        }
      });
    });
    describe(".run", () => {
      it("should call the specified function once", async () => {
        await testStream(async ({ run }) => {
          const fn = spy(async () => {});

          await run([], fn);

          assertSpyCalls(fn, 1);
        });
      });
      it("should rejects with the error thrown in the specified function", async () => {
        await testStream(async ({ run }) => {
          function Bar() {
            throw new MyCustomError();
          }
          const fn = async () => {
            // Push to asynchronous event queue.
            await delay(0);
            Bar();
          };

          const actual = await assertRejects(
            () => {
              return run([], fn);
            },
            MyCustomError,
          );
          if (actual.stack) {
            assertMatch(actual.stack, /Bar/);
          }
        });
      });
      it("should throws if called within `run`", async () => {
        await testStream(async ({ run }) => {
          await run([], () => {
            assertThrows(
              () => {
                run([]);
              },
              OperationNotPermittedError,
              "Helpers does not allow concurrent call",
            );
          });
        });
      });
      it("should throws if called outside `testStream`", async () => {
        let savedRun: TestStreamHelperRun;

        // deno-lint-ignore require-await
        await testStream(async ({ run }) => {
          savedRun = run;
        });

        assertThrows(
          () => {
            savedRun([]);
          },
          OperationNotPermittedError,
          "Helpers does not allow call outside `testStream`",
        );
      });
      it("should process the previously generated test streams", async () => {
        await testStream(async ({ readable, run }) => {
          const IS_PENDING = {} as const;
          const stream1 = readable("abc|");
          const stream2 = readable("de|");

          const actual1: string[] = [];
          const p1 = stream1.pipeTo(
            new WritableStream({
              write(chunk) {
                actual1.push(chunk);
              },
            }),
          );
          const actual2: string[] = [];
          const p2 = stream2.pipeTo(
            new WritableStream({
              write(chunk) {
                actual2.push(chunk);
              },
            }),
          );

          await run([/* No specify streams */], async () => {
            assertEquals(
              actual1,
              [],
              "actual1 should be empty at the beginning of the run block",
            );
            assertEquals(
              actual2,
              [],
              "actual2 should be empty at the beginning of the run block",
            );

            assertStrictEquals(
              await Promise.race([p1, p2, Promise.resolve(IS_PENDING)]),
              IS_PENDING,
              "p1, p2 should be pending at the beginning of the run block",
            );
          });

          assertNotStrictEquals(
            await Promise.race([p1, p2, Promise.resolve(IS_PENDING)]),
            IS_PENDING,
            "p1, p2 should be resolved after run",
          );

          assertEquals(actual1, ["a", "b", "c"]);
          assertEquals(actual2, ["d", "e"]);
        });
      });
      it("should process the secondary generated test streams", async () => {
        await testStream(async ({ readable, run }) => {
          const IS_PENDING = {} as const;
          const stream1 = readable("abc|");
          const actual1: string[] = [];
          const p1 = stream1.pipeTo(
            new WritableStream({
              write(chunk) {
                actual1.push(chunk);
              },
            }),
          );

          await run([/* No specify streams */]);

          assertNotStrictEquals(
            await Promise.race([p1, Promise.resolve(IS_PENDING)]),
            IS_PENDING,
            "p1 should be resolved after run",
          );

          assertEquals(actual1, ["a", "b", "c"]);

          const stream2 = readable("de|");
          const actual2: string[] = [];
          const p2 = stream2.pipeTo(
            new WritableStream({
              write(chunk) {
                actual2.push(chunk);
              },
            }),
          );

          await run([/* No specify streams */]);

          assertNotStrictEquals(
            await Promise.race([p2, Promise.resolve(IS_PENDING)]),
            IS_PENDING,
            "p2 should be resolved after run",
          );

          assertEquals(actual2, ["d", "e"]);
        });
      });
      it("should pass the readables of the specified streams to `fn`", async () => {
        await testStream(async ({ readable, run }) => {
          const stream1 = readable("abcd|");
          const stream2 = readable("def|");

          const transformed1 = stream1.pipeThrough(
            new TransformStream({
              transform(chunk, controller) {
                controller.enqueue(`${chunk}X`);
              },
            }),
          );
          const transformed2 = stream2.pipeThrough(
            new TransformStream({
              transform(chunk, controller) {
                controller.enqueue(`${chunk}Y`);
              },
            }),
          );

          const actual1: string[] = [];
          const writable1 = new WritableStream<string>({
            write(chunk) {
              actual1.push(chunk);
            },
          });
          const actual2: string[] = [];
          const writable2 = new WritableStream<string>({
            write(chunk) {
              actual2.push(chunk);
            },
          });

          await run(
            [transformed1, transformed2],
            async (readable1, readable2) => {
              assert(
                transformed1.locked,
                "transformed1 stream should be locked",
              );
              assert(
                transformed2.locked,
                "transformed2 stream should be locked",
              );
              assertFalse(readable1.locked, "readable1 should not be locked");
              assertFalse(readable2.locked, "readable2 should not be locked");

              await Promise.all([
                readable1.pipeTo(writable1),
                readable2.pipeTo(writable2),
              ]);
            },
          );

          assertEquals(actual1, ["aX", "bX", "cX", "dX"]);
          assertEquals(actual2, ["dY", "eY", "fY"]);
        });
      });
    });
  });
});
