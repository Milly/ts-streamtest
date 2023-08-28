import {
  beforeEach,
  describe,
  it,
} from "https://deno.land/std@0.199.0/testing/bdd.ts";
import {
  assertSpyCalls,
  spy,
} from "https://deno.land/std@0.199.0/testing/mock.ts";
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
} from "https://deno.land/std@0.199.0/assert/mod.ts";
import * as log from "https://deno.land/std@0.199.0/log/mod.ts";
import { delay } from "https://deno.land/std@0.199.0/async/delay.ts";
import {
  LeakingAsyncOpsError,
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
        const options = { fn };

        await testStream(options);

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
        const shouldNotCallFn = spy(async () => {});
        const options = { fn: shouldNotCallFn };

        // deno-lint-ignore no-explicit-any
        await testStream(options as any, fn);

        assertSpyCalls(shouldNotCallFn, 0);
        assertSpyCalls(fn, 1);
      });
    });
  });
  describe("TestStreamDefinition", () => {
    describe(".maxTicks", () => {
      it("should close streams at 50 ticks if not specified", async () => {
        let framedStream: ReadableStream<string>;
        let cancelReason: unknown;

        await testStream({
          async fn({ readable, run, assertReadable }) {
            const ticks49 = Array(49 + 1).join("-");
            framedStream = readable(`      ${ticks49}ab|`);
            const framedStreamExpected = ` ${ticks49}a`;
            const actualStreamExpected = ` ${ticks49}-`;

            const actualChunks: string[] = [];
            const actualStream = framedStream.pipeThrough({
              writable: new WritableStream<string>({
                write(chunk) {
                  actualChunks.push(chunk);
                },
              }),
              readable: new ReadableStream({
                cancel(reason) {
                  cancelReason = reason;
                },
              }),
            });

            await run([framedStream, actualStream]);

            assertEquals(actualChunks, ["a"]);
            await assertReadable(framedStream, framedStreamExpected);
            await assertReadable(actualStream, actualStreamExpected);
            assertEquals(framedStream.locked, true);
          },
        });

        assertEquals(framedStream!.locked, false);
        assertEquals(cancelReason, "testStream disposed");
      });
      it("should close streams at the specified number of ticks", async () => {
        let framedStream: ReadableStream<string>;
        let cancelReason: unknown;

        await testStream({
          maxTicks: 30,
          async fn({ readable, run, assertReadable }) {
            const ticks29 = Array(29 + 1).join("-");
            framedStream = readable(`     ${ticks29}ab|`);
            const framedStreamExpected = `${ticks29}a`;
            const actualStreamExpected = `${ticks29}-`;

            const actualChunks: string[] = [];
            const actualStream = framedStream.pipeThrough({
              writable: new WritableStream<string>({
                write(chunk) {
                  actualChunks.push(chunk);
                },
              }),
              readable: new ReadableStream({
                cancel(reason) {
                  cancelReason = reason;
                },
              }),
            });

            await run([framedStream, actualStream]);

            assertEquals(actualChunks, ["a"]);
            await assertReadable(framedStream, framedStreamExpected);
            await assertReadable(actualStream, actualStreamExpected);
            assertEquals(framedStream.locked, true);
          },
        });

        assertEquals(framedStream!.locked, false);
        assertEquals(cancelReason, "testStream disposed");
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
              fn: async ({ run }) => {
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
      await testStream(() => {
        assertThrows(
          () => {
            testStream(async () => {});
          },
          OperationNotPermittedError,
          "`testStream` does not allow concurrent call",
        );
      });
    });
    it("should rejects if calling `assertReadbale` without `await`", async () => {
      await assertRejects(
        () => {
          return testStream(({ assertReadable, readable }) => {
            const actual = readable("a-|");
            assertReadable(actual, "a-|");
          });
        },
        LeakingAsyncOpsError,
        "Helper function is still running",
      );
    });
    it("should rejects if calling `assertReadable` that rejects without `await`", async () => {
      await assertRejects(
        () => {
          return testStream(({ assertReadable, readable }) => {
            const actual = readable("a-|");
            assertReadable(actual, "x-|");
          });
        },
        LeakingAsyncOpsError,
        "Helper function is still running",
      );
    });
    it("should rejects if calling `run` without `await`", async () => {
      await assertRejects(
        () => {
          return testStream(({ run, readable }) => {
            const actual = readable("a-|");
            run([actual]);
          });
        },
        LeakingAsyncOpsError,
        "Helper function is still running",
      );
    });
    it("should rejects if calling `run` that rejects without `await`", async () => {
      await assertRejects(
        () => {
          return testStream(({ run, readable }) => {
            const actual = readable("a-|");
            run([actual], () => {
              throw new MyCustomError();
            });
          });
        },
        LeakingAsyncOpsError,
        "Helper function is still running",
      );
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

        await testStream(({ assertReadable }) => {
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
        it("should matchs `!` to cancel the stream", async () => {
          await testStream(async ({ assertReadable, run }) => {
            const stream = new ReadableStream();

            await run([stream], (stream) => {
              stream.cancel();
            });

            await assertReadable(stream, "!");
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
        it("should matchs any cancel value if not specified", async () => {
          await testStream(async ({ assertReadable, run }) => {
            const stream = new ReadableStream();

            await run([stream], (stream) => {
              stream.cancel(new MyCustomError());
            });

            await assertReadable(stream, "!");
          });
        });
        it("should matchs any error value if not specified", async () => {
          await testStream(async ({ assertReadable }) => {
            const stream = new ReadableStream({
              start(controller) {
                controller.error(new MyCustomError());
              },
            });

            await assertReadable(stream, "#");
          });
        });
        for (const reason of ABORT_REASON_CASES) {
          it(`should matches ${toPrint(reason)} for cancel`, async () => {
            await testStream(async ({ assertReadable, run }) => {
              const stream = new ReadableStream();

              await run([stream], (stream) => {
                stream.cancel(reason);
              });

              await assertReadable(stream, "!", undefined, reason);
            });
          });
          it(`should matches ${toPrint(reason)} for error`, async () => {
            await testStream(async ({ assertReadable }) => {
              const stream = new ReadableStream({
                start(controller) {
                  controller.error(reason);
                },
              });

              await assertReadable(stream, "#", undefined, reason);
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

          await assertReadable(stream, "ab(c!)", undefined, "terminate");
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

          await assertReadable(stream, "abc!", undefined, "terminate");
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

          await assertReadable(transformed, "AB(C!)", {
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

          await assertReadable(transformed, "ABC!", {
            A: "aX",
            B: "bX",
            C: "cX",
          }, "terminate");
        });
      });
      it("should match the stream that uses timer", async () => {
        await testStream(async ({ assertReadable }) => {
          const stream = new ReadableStream<string>({
            async start(controller) {
              controller.enqueue("A");
              await delay(100);
              controller.close();
            },
          });

          await assertReadable(stream, "A|");
        });
      });
      it("should match the stream that uses await before timer", async () => {
        await testStream(async ({ assertReadable }) => {
          const stream = new ReadableStream<string>({
            async start(controller) {
              await Promise.resolve();
              controller.enqueue("A");
              await delay(100);
              controller.close();
            },
          });

          await assertReadable(stream, "A|");
        });
      });
      it("should match the stream that uses `delay(0)` first", async () => {
        await testStream(async ({ assertReadable }) => {
          const stream = new ReadableStream<string>({
            async start(controller) {
              await delay(0);
              controller.enqueue("A");
              await delay(100);
              controller.close();
            },
          });

          await assertReadable(stream, "A|");
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

        await testStream(({ readable }) => {
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
            await testStream(({ readable }) => {
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
            await testStream(({ readable }) => {
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
            "ab!c",
            "a(!b)",
            "ab#c",
            "a(#b)",
            "abc|#",
            "abc|!",
            "abc!|",
            "abc!#",
            "abc#|",
            "abc#!",
          ]
        ) {
          it(`should throws if non-trailing close: ${toPrint(series)}`, async () => {
            await testStream(({ readable }) => {
              assertThrows(
                () => {
                  readable(series);
                },
                SyntaxError,
                "Non-trailing close",
              );
            });
          });
        }
        for (
          const series of [
            "|",
            "abc|",
            "a(b|)",
            "!",
            "abc!",
            "a(b!)",
            "#",
            "abc#",
            "a(b#)",
          ]
        ) {
          it(`should not throws if trailing close: ${toPrint(series)}`, async () => {
            await testStream(({ readable }) => {
              const stream = readable(series);

              assertInstanceOf(stream, ReadableStream);
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
              assertEquals(actual, []);
              await delay(1);
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
              await delay(500);
              assertEquals(actual, []);
              await delay(1);
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
          await testStream(async ({ readable, run, assertReadable }) => {
            const stream = readable("---|");
            const expected = "       ---|";

            stream.pipeTo(new WritableStream());

            await run([], async () => {
              await delay(250);
              assertEquals(stream.locked, true);
              await delay(100);
              assertEquals(stream.locked, false);
            });

            await assertReadable(stream, expected);
          });
        });
        it("should not close the stream without `|`", async () => {
          let stream: ReadableStream<string>;

          await testStream({
            maxTicks: 10,
            async fn({ readable, assertReadable }) {
              stream = readable("---");
              const expected = " ----------";

              stream.pipeTo(new WritableStream());

              await assertReadable(stream, expected);
              assertEquals(stream.locked, true);
            },
          });

          assertEquals(stream!.locked, false);
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
        it("should be undefined for cancel reason if not specified", async () => {
          await testStream(async ({ readable, assertReadable }) => {
            const stream = readable("a-bc!");

            assertInstanceOf(stream, ReadableStream);

            await assertReadable(stream, "a-bc!", undefined, undefined);
          });
        });
        it("should be undefined for error reason if not specified", async () => {
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
        for (const reason of ABORT_REASON_CASES) {
          it(`should be possible to specify ${toPrint(reason)} for cancel`, async () => {
            await testStream(async ({ readable, assertReadable }) => {
              const stream = readable("a-bc!", undefined, reason);

              assertInstanceOf(stream, ReadableStream);

              await assertReadable(stream, "a-bc!", undefined, reason);
            });
          });
          it(`should be possible to specify ${toPrint(reason)} for error`, async () => {
            await testStream(async ({ readable, run }) => {
              const stream = readable("a-bc#", undefined, reason);

              assertInstanceOf(stream, ReadableStream);

              const p = stream.pipeTo(new WritableStream());
              p.catch(() => {});
              await run([]);

              const actual = await assertRejects(() => p);
              assertStrictEquals(actual, reason);
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

        await testStream(({ run }) => {
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
            await Promise.race([p1, Promise.resolve(IS_PENDING)]),
            IS_PENDING,
            "p1 should be resolved after run",
          );
          assertNotStrictEquals(
            await Promise.race([p2, Promise.resolve(IS_PENDING)]),
            IS_PENDING,
            "p2 should be resolved after run",
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
            [stream1, transformed2],
            async (readable1, readable2) => {
              assertFalse(readable1.locked, "readable1 should not be locked");
              assertFalse(readable2.locked, "readable2 should not be locked");

              await Promise.all([
                readable1.pipeTo(writable1),
                readable2.pipeTo(writable2),
              ]);
            },
          );

          assertEquals(actual1, ["a", "b", "c", "d"]);
          assertEquals(actual2, ["dY", "eY", "fY"]);
        });
      });
      it("should fulfilled the long delay in `fn`", async () => {
        await testStream({
          maxTicks: 50,
          async fn({ run }) {
            await run([], async () => {
              await delay(10000);
            });
          },
        });
      });
      it("should fulfilled multiple long delays in `fn`", async () => {
        await testStream({
          maxTicks: 50,
          async fn({ run }) {
            await run([], async () => {
              await delay(10000);
              await delay(10000);
            });
          },
        });
      });
    });
  });
});
