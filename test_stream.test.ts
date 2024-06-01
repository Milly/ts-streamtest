import { beforeEach, describe, it } from "bdd";
import { assertSpyCalls, spy } from "@std/testing/mock";
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
} from "@std/assert";
import { delay } from "@std/async/delay";
import { hasEnv } from "@cross/env";
import {
  LeakingAsyncOpsError,
  MaxTicksExceededError,
  OperationNotPermittedError,
} from "./errors/mod.ts";
import type {
  TestStreamHelper,
  TestStreamHelperAbort,
  TestStreamHelperAssertReadable,
  TestStreamHelperReadable,
  TestStreamHelperRun,
  TestStreamHelperWritable,
} from "./types.ts";
import { deferred } from "./deferred.ts";
import { resetBaseTime, setupDebugLogger } from "./testutil/logger.ts";
import { setLogger, testStream } from "./test_stream.ts";

try {
  if (hasEnv("TESTLOG")) {
    setLogger(setupDebugLogger());
  }
} catch {
  // Permission denied to get environment vars, do nothing.
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

function pipeToChunks(
  stream: ReadableStream<unknown>,
  chunks: unknown[] = [],
): { chunks: unknown[]; completed: Promise<void> } {
  const completed = stream.pipeTo(
    new WritableStream({
      write(chunk) {
        chunks.push(chunk);
      },
    }),
  );
  return { chunks, completed };
}

describe("testStream", () => {
  beforeEach(() => {
    resetBaseTime();
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
        let helperStream: ReadableStream<string>;
        let nativeStreamCancelReason: unknown;

        await testStream({
          async fn({ readable, run, assertReadable }) {
            const ticks49 = Array(49 + 1).join("-");
            helperStream = readable(`     ${ticks49}a`);
            const helperStreamExpected = `${ticks49}a`;
            const nativeStreamExpected = `${ticks49}-`;

            const nativeStream = new ReadableStream({
              cancel(reason) {
                nativeStreamCancelReason = reason;
              },
            });
            const { chunks } = pipeToChunks(helperStream);

            await run([helperStream, nativeStream], async () => {
              await delay(10000);
            });

            assertEquals(chunks, ["a"]);
            await assertReadable(helperStream, helperStreamExpected);
            await assertReadable(nativeStream, nativeStreamExpected);
            assertEquals(helperStream.locked, true);
          },
        });

        assertEquals(helperStream!.locked, false);
        assertEquals(nativeStreamCancelReason, "testStream disposed");
      });
      it("should close streams at the specified number of ticks", async () => {
        let helperStream: ReadableStream<string>;
        let nativeStreamCancelReason: unknown;

        await testStream({
          maxTicks: 30,
          async fn({ readable, run, assertReadable }) {
            const ticks29 = Array(29 + 1).join("-");
            helperStream = readable(`     ${ticks29}a`);
            const helperStreamExpected = `${ticks29}a`;
            const nativeStreamExpected = `${ticks29}-`;

            const nativeStream = new ReadableStream({
              cancel(reason) {
                nativeStreamCancelReason = reason;
              },
            });
            const { chunks } = pipeToChunks(helperStream);

            await run([helperStream, nativeStream], async () => {
              await delay(10000);
            });

            assertEquals(chunks, ["a"]);
            await assertReadable(helperStream, helperStreamExpected);
            await assertReadable(nativeStream, nativeStreamExpected);
            assertEquals(helperStream.locked, true);
          },
        });

        assertEquals(helperStream!.locked, false);
        assertEquals(nativeStreamCancelReason, "testStream disposed");
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
          "maxTicks should be 1 or more",
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
          "maxTicks should be 1 or more",
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
            const start = Date.now();

            await run([stream]);

            assertEquals(Date.now() - start, 100 * 5);
          },
        });
      });
      it("should advances the specified number of milliseconds in one tick", async () => {
        await testStream({
          tickTime: 250,
          async fn({ readable, run }) {
            const stream = readable("----|");
            const start = Date.now();

            await run([stream]);

            assertEquals(Date.now() - start, 250 * 5);
          },
        });
      });
      it("should throws if 0 is specified", () => {
        assertThrows(
          () => {
            testStream({
              tickTime: 0,
              fn: async ({ run }) => {
                await run([]);
              },
            });
          },
          RangeError,
          "tickTime should be 1 or more",
        );
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
          "tickTime should be 1 or more",
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
          "abort",
          "assertReadable",
          "readable",
          "run",
          "writable",
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
        async () => {
          await testStream(fn);
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
        async () => {
          await testStream(({ assertReadable, readable }) => {
            const actual = readable("a-|");
            /* no await */ assertReadable(actual, "a-|");
          });
        },
        LeakingAsyncOpsError,
        "Helper function is still running",
      );
    });
    it("should rejects if calling `run` without `await`", async () => {
      await assertRejects(
        async () => {
          await testStream(({ run }) => {
            /* no await */ run([]);
          });
        },
        LeakingAsyncOpsError,
        "Helper function is still running",
      );
    });
  });
  describe("TestStreamHelper", () => {
    describe(".abort", () => {
      it("should returns an AbortSignal", async () => {
        await testStream(({ abort }) => {
          const signal = abort("----!");

          assertInstanceOf(signal, AbortSignal);
        });
      });
      it("should throws if called outside `testStream`", async () => {
        let savedAbort: TestStreamHelperAbort;

        await testStream(({ abort }) => {
          savedAbort = abort;
        });

        assertThrows(
          () => {
            savedAbort("---|");
          },
          OperationNotPermittedError,
          "Helpers does not allow call outside `testStream`",
        );
      });
      describe("(series, ...)", () => {
        it("should be possible to specify an empty string", async () => {
          await testStream(({ abort }) => {
            const stream = abort("");

            assertInstanceOf(stream, AbortSignal);
          });
        });
        for (
          const series of [
            "|", // `readable` close
            "#", // `readable` error
            "a", // `readable` enqueue
            "()", // `readable` group
            "<", // `writable` backpressure
            ">", // `writable` backpressure
            "$", // reserved
            "%", // reserved
            "`", // reserved
            "~", // reserved
          ]
        ) {
          it(`should throws if contains invalid character: ${toPrint(series)}`, async () => {
            await testStream(({ abort }) => {
              assertThrows(
                () => {
                  abort(series);
                },
                SyntaxError,
                "Invalid character",
              );
            });
          });
        }
        it(`should throws if non-trailing abort`, async () => {
          await testStream(({ abort }) => {
            assertThrows(
              () => {
                abort("--!-");
              },
              SyntaxError,
              "Non-trailing close",
            );
          });
        });
        for (
          const series of [
            "!",
            "---!",
          ]
        ) {
          it(`should not throws if trailing abort: ${toPrint(series)}`, async () => {
            await testStream(({ abort }) => {
              const stream = abort(series);

              assertInstanceOf(stream, AbortSignal);
            });
          });
        }
        it("should ignores ` `", async () => {
          await testStream(async ({ abort, run }) => {
            const signal = abort("   -   - -  !   ", "break");

            await run([], async () => {
              await delay(300 - 1);
              assertFalse(signal.aborted);
              await delay(2);
              assert(signal.aborted);
            });
          });
        });
        it("should advances one tick with `-` and aborts with `!`", async () => {
          await testStream(async ({ abort, run }) => {
            const signal = abort("-----!", "break");

            await run([], async () => {
              await delay(500 - 1);
              assertFalse(signal.aborted);
              await delay(2);
              assert(signal.aborted);
            });
          });
        });
        it("should not aborts the signal without `!`", async () => {
          let signal!: AbortSignal;

          await testStream({
            maxTicks: 10,
            async fn({ abort, run }) {
              signal = abort("---", "break");

              await run([], async () => {
                await delay(10000);
              });
            },
          });

          assertFalse(signal.aborted);
        });
        it("should throws if ticks longer than `maxTicks`", async () => {
          await testStream({
            maxTicks: 5,
            fn({ abort }) {
              assertThrows(
                () => {
                  abort("------");
                },
                MaxTicksExceededError,
                "Ticks exceeded",
              );
            },
          });
        });
      });
      describe("(..., error)", () => {
        it("should be DOMException for abort reason if not specified", async () => {
          await testStream(async ({ abort, run }) => {
            const signal = abort("---!");

            await run([]);

            assert(signal.aborted);
            assertInstanceOf(signal.reason, DOMException);
          });
        });
        it("should be DOMException for abort reason if specify undefined", async () => {
          await testStream(async ({ abort, run }) => {
            const signal = abort("---!", undefined);

            await run([]);

            assert(signal.aborted);
            assertInstanceOf(signal.reason, DOMException);
          });
        });
        for (const reason of ABORT_REASON_CASES) {
          if (reason === undefined) continue;
          it(`should be possible to specify ${toPrint(reason)} for abort`, async () => {
            await testStream(async ({ abort, run }) => {
              const signal = abort("----!", reason);

              await run([]);

              assert(signal.aborted);
              assertEquals(signal.reason, reason);
            });
          });
        }
      });
    });
    describe(".assertReadable", () => {
      it("should rejects if called within `run`", async () => {
        await testStream(async ({ assertReadable, run }) => {
          const stream = ReadableStream.from(["a", "b", "c"]);

          await run([], async () => {
            await assertRejects(
              async () => {
                await assertReadable(stream, "(abc|)");
              },
              OperationNotPermittedError,
              "Helpers does not allow concurrent call",
            );
          });
        });
      });
      it("should rejects if called outside `testStream`", async () => {
        let savedAssertReadable: TestStreamHelperAssertReadable;
        const stream = ReadableStream.from(["a", "b", "c"]);

        await testStream(({ assertReadable }) => {
          savedAssertReadable = assertReadable;
        });

        await assertRejects(
          async () => {
            await savedAssertReadable(stream, "(abc|)");
          },
          OperationNotPermittedError,
          "Helpers does not allow call outside `testStream`",
        );
      });
      describe("(actual, expectedSeries, ...)", () => {
        for (
          const expectedSeries of [
            "<", // `writable` backpressure
            ">", // `writable` backpressure
            "$", // reserved
            "%", // reserved
            "`", // reserved
            "~", // reserved
          ]
        ) {
          it(`should rejects if \`expectedSeries\` contains reserved character: ${toPrint(expectedSeries)}`, async () => {
            await testStream(async ({ assertReadable }) => {
              const stream = new ReadableStream();
              await assertRejects(
                async () => {
                  await assertReadable(stream, expectedSeries);
                },
                SyntaxError,
                "Invalid character",
              );
            });
          });
        }
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
              async () => {
                await assertReadable(stream, "(abc|)");
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
        it("should matches `-` to one tick", async () => {
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
        it("should matches `|` to close the stream", async () => {
          await testStream(async ({ assertReadable }) => {
            const stream = ReadableStream.from([]);

            await assertReadable(stream, "|");
          });
        });
        it("should matches unclosed stream without `|`", async () => {
          await testStream({
            maxTicks: 5,
            async fn({ assertReadable }) {
              const stream = new ReadableStream();

              await assertReadable(stream, "-----");
            },
          });
        });
        it("should matches `!` to cancel the stream", async () => {
          await testStream(async ({ assertReadable, run }) => {
            const stream = new ReadableStream();

            await run([stream], (stream) => {
              stream.cancel();
            });

            await assertReadable(stream, "!");
          });
        });
        it("should matches `#` to abort the stream", async () => {
          await testStream(async ({ assertReadable }) => {
            const stream = new ReadableStream({
              start(controller) {
                controller.error();
              },
            });

            await assertReadable(stream, "#");
          });
        });
        it("should matches any character enqueue and one tick to the stream", async () => {
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
        it("should matches the stream that do not advance ticks within `(...)` and advance one tick after `)`", async () => {
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
        it("should rejects if ticks longer than `maxTicks`", async () => {
          await testStream({
            maxTicks: 5,
            async fn({ assertReadable }) {
              const stream = new ReadableStream();

              await assertRejects(
                async () => {
                  await assertReadable(stream, "------");
                },
                MaxTicksExceededError,
                "Ticks exceeded",
              );
            },
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
        it("should matches any cancel value if not specified", async () => {
          await testStream(async ({ assertReadable, run }) => {
            const stream = new ReadableStream();

            await run([stream], (stream) => {
              stream.cancel(new MyCustomError());
            });

            await assertReadable(stream, "!");
          });
        });
        it("should matches any error value if not specified", async () => {
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
          it(`should matches the stream cancelled: ${toPrint(reason)}`, async () => {
            await testStream(async ({ assertReadable, run }) => {
              const stream = new ReadableStream();

              await run([stream], (stream) => {
                stream.cancel(reason);
              });

              await assertReadable(stream, "!", undefined, reason);
            });
          });
          it(`should matches the stream errored: ${toPrint(reason)}`, async () => {
            await testStream(async ({ assertReadable }) => {
              const stream = new ReadableStream({
                start(controller) {
                  controller.error(reason);
                },
              });

              await assertReadable(stream, "#", undefined, reason);
            });
          });
          it(`should matches the stream created with \`readable\` and cancelled: ${toPrint(reason)}`, async () => {
            await testStream(
              async ({ readable, abort, run, assertReadable }) => {
                const stream = readable("--a---b---|");
                const expected = "       --a--!";
                const signal = abort("   -----!");

                await run([stream], async (stream) => {
                  const reader = stream.getReader();
                  signal.addEventListener("abort", () => {
                    reader.cancel(reason);
                  }, { once: true });
                  for (;;) {
                    const { done } = await reader.read();
                    if (done) break;
                  }
                });

                await assertReadable(stream, expected, {}, reason);
              },
            );
          });
        }
      });
      it("should matches the stream created with `readable`", async () => {
        await testStream(async ({ assertReadable, readable }) => {
          const stream = readable("abcd|");

          await assertReadable(stream, "abcd|");
        });
      });
      it("should matches the stream tansformed from `readable`", async () => {
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
      it("should matches the stream processed with `run`", async () => {
        await testStream(async ({ assertReadable, readable, run }) => {
          const stream = readable("abcd|");

          await run([stream], async (stream) => {
            await stream.pipeTo(new WritableStream());
          });

          await assertReadable(stream, "abcd|");
        });
      });
      it("should matches the stream aborted with `run`", async () => {
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
      it("should matches the stream asynchronously aborted with `run`", async () => {
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
      it("should matches the stream transformed from `readable` and processed with `run`", async () => {
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
            await transformed.pipeTo(new WritableStream());
          });

          await assertReadable(transformed, "ABCD|", {
            A: "aX",
            B: "bX",
            C: "cX",
            D: "dX",
          });
        });
      });
      it("should matches the stream transformed from `readable` and aborted with `run`", async () => {
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
      it("should matches the stream transformed from `readable` and asynchronously aborted with `run`", async () => {
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
      it("should matches the stream that uses timer", async () => {
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
      it("should matches the stream that uses await before timer", async () => {
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
      it("should matches the stream that uses `delay(0)` first", async () => {
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

          const { chunks } = pipeToChunks(stream);
          await run([]);

          assertEquals(chunks, ["a", "b", "c"]);
        });
      });
      it("should returns a readable stream inside `run`", async () => {
        await testStream(async ({ readable, run }) => {
          const createStream = () => readable("x---y---z|");
          const chunks: unknown[] = [];

          await run([], async () => {
            await delay(200);
            const stream = createStream();
            assertInstanceOf(stream, ReadableStream);
            pipeToChunks(stream, chunks);
          });

          assertEquals(chunks, ["x", "y", "z"]);
        });
      });
      it("should returns a readable stream inside and outside `run`", async () => {
        await testStream(async ({ readable, run }) => {
          const stream1 = readable("          a---b---c|");
          const createStream2 = () => readable("x---y---z|");
          const createStream3 = () => readable("           3-5-7|");

          // stream1 created outside `run`
          const { chunks } = pipeToChunks(stream1);

          // stream3 created asynchronously outside `run`
          delay(1300).then(() => {
            pipeToChunks(createStream3(), chunks);
          });

          await run([], async () => {
            // stream2 created asynchronously inside `run`
            await delay(200);
            pipeToChunks(createStream2(), chunks);
          });

          assertEquals(chunks, ["a", "x", "b", "y", "c", "z", "3", "5", "7"]);
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

            const { chunks } = pipeToChunks(stream);
            await run([]);

            assertEquals(chunks, []);
          });
        });
        for (
          const series of [
            "<", // `writable` backpressure
            ">", // `writable` backpressure
            "$", // reserved
            "%", // reserved
            "`", // reserved
            "~", // reserved
          ]
        ) {
          it(`should throws if contains reserved character: ${toPrint(series)}`, async () => {
            await testStream(({ readable }) => {
              assertThrows(
                () => {
                  readable(series);
                },
                SyntaxError,
                "Invalid character",
              );
            });
          });
        }
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

            const { chunks } = pipeToChunks(stream);

            await run([], async () => {
              assertEquals(chunks, []);
              await delay(0);
              assertEquals(chunks, ["a"]);

              await delay(100 - 1);
              assertEquals(chunks, ["a"]);
              await delay(1);
              assertEquals(chunks, ["a", "b"]);

              await delay(100 - 1);
              assertEquals(chunks, ["a", "b"]);
              await delay(1);
              assertEquals(chunks, ["a", "b", "c"]);

              await delay(100 - 1);
              assert(stream.locked, "Stream should not closed");
              await delay(2);
              assertFalse(stream.locked, "Stream should closed");
            });
          });
        });
        it("should advances one tick with `-`", async () => {
          await testStream(async ({ readable, run }) => {
            const stream = readable("-----a--bc-|");

            const { chunks } = pipeToChunks(stream);

            await run([], async () => {
              await delay(500 - 1);
              assertEquals(chunks, []);
              await delay(1);
              assertEquals(chunks, ["a"]);

              await delay(300 - 1);
              assertEquals(chunks, ["a"]);
              await delay(1);
              assertEquals(chunks, ["a", "b"]);

              await delay(100 - 1);
              assertEquals(chunks, ["a", "b"]);
              await delay(1);
              assertEquals(chunks, ["a", "b", "c"]);

              await delay(200 - 1);
              assert(stream.locked, "Stream should not closed");
              await delay(2);
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
              await delay(300 - 1);
              assertEquals(stream.locked, true);
              await delay(2);
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
        it("should throws if ticks longer than `maxTicks`", async () => {
          await testStream({
            maxTicks: 5,
            fn({ readable }) {
              assertThrows(
                () => {
                  readable("------");
                },
                MaxTicksExceededError,
                "Ticks exceeded",
              );
            },
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

            const { chunks } = pipeToChunks(stream);
            await run([]);

            assertEquals(chunks, [
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

            const { chunks } = pipeToChunks(stream);
            await run([]);

            assertEquals(chunks, ["a", "b", "c"]);
          });
        });
        it("should be possible to specify undefined", async () => {
          await testStream(async ({ readable, run }) => {
            const stream = readable("a-bc|", undefined);

            assertInstanceOf(stream, ReadableStream);

            const { chunks } = pipeToChunks(stream);
            await run([]);

            assertEquals(chunks, ["a", "b", "c"]);
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
          it(`should be possible to specify for cancel: ${toPrint(reason)}`, async () => {
            await testStream(async ({ readable, assertReadable }) => {
              const stream = readable("a-bc!", undefined, reason);

              assertInstanceOf(stream, ReadableStream);

              await assertReadable(stream, "a-bc!", undefined, reason);
            });
          });
          it(`should be possible to specify for error: ${toPrint(reason)}`, async () => {
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
            async () => {
              await run([], fn);
            },
            MyCustomError,
          );
          if (actual.stack) {
            assertMatch(actual.stack, /Bar/);
          }
        });
      });
      it("should rejects if called within `run`", async () => {
        await testStream(async ({ run }) => {
          await run([], async () => {
            await assertRejects(
              async () => {
                await run([]);
              },
              OperationNotPermittedError,
              "Helpers does not allow concurrent call",
            );
          });
        });
      });
      it("should rejects if called outside `testStream`", async () => {
        let savedRun: TestStreamHelperRun;

        await testStream(({ run }) => {
          savedRun = run;
        });

        await assertRejects(
          async () => {
            await savedRun([]);
          },
          OperationNotPermittedError,
          "Helpers does not allow call outside `testStream`",
        );
      });
      it("should process the previously generated test streams", async () => {
        await testStream(async ({ readable, run }) => {
          const IS_PENDING = {} as const;
          const stream1 = readable("abc|");
          const stream2 = readable("AB|");

          const chunks: unknown[] = [];
          const { completed: p1 } = pipeToChunks(stream1, chunks);
          const { completed: p2 } = pipeToChunks(stream2, chunks);

          await run([/* No specify streams */], async () => {
            assertEquals(
              chunks,
              [],
              "chunks should be empty at the beginning of the run block",
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

          assertEquals(chunks, ["a", "A", "b", "B", "c"]);
        });
      });
      it("should process the secondary generated test streams", async () => {
        await testStream(async ({ readable, run }) => {
          const IS_PENDING = {} as const;
          const stream1 = readable("abc|");
          const { chunks: chunks1, completed: p1 } = pipeToChunks(stream1);

          await run([/* No specify streams */]);

          assertNotStrictEquals(
            await Promise.race([p1, Promise.resolve(IS_PENDING)]),
            IS_PENDING,
            "p1 should be resolved after run",
          );
          assertEquals(chunks1, ["a", "b", "c"]);

          const stream2 = readable("AB|");
          const { chunks: chunks2, completed: p2 } = pipeToChunks(stream2);

          await run([/* No specify streams */]);

          assertNotStrictEquals(
            await Promise.race([p2, Promise.resolve(IS_PENDING)]),
            IS_PENDING,
            "p2 should be resolved after run",
          );

          assertEquals(chunks2, ["A", "B"]);
        });
      });
      it("should pass the readables of the specified streams to `fn`", async () => {
        await testStream(async ({ readable, run }) => {
          const chunks: unknown[] = [];
          const stream1 = readable("ab(cd|)");
          const stream2 = readable("A(BC|)");

          const transformed2 = stream2.pipeThrough(
            new TransformStream({
              transform(chunk, controller) {
                controller.enqueue(chunk + "!");
              },
            }),
          );

          await run(
            [stream1, transformed2],
            async (readable1, readable2) => {
              assertFalse(readable1.locked, "readable1 should not be locked");
              assertFalse(readable2.locked, "readable2 should not be locked");

              await Promise.all([
                pipeToChunks(readable1, chunks).completed,
                pipeToChunks(readable2, chunks).completed,
              ]);
            },
          );

          assertEquals(chunks, ["a", "A!", "b", "B!", "C!", "c", "d"]);
        });
      });
      it("should be pass throughs backpressure to the specified streams", async () => {
        await testStream(async ({ writable, run, assertReadable }) => {
          let chunkCount = 0;
          let ready = deferred<void>();
          const timer = setInterval(() => ready.resolve(), 200);
          const stream = new ReadableStream<number>({
            async pull(controller) {
              await ready.promise;
              ready = deferred();
              ++chunkCount;
              controller.enqueue(chunkCount);
            },
            cancel(reason) {
              clearInterval(timer);
              ready.reject(reason);
            },
          }, { highWaterMark: 0 });

          const values = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5 };
          // stream:             --1-2-3-4-5-6-7-...
          const expected = "     --1-2----34-5!";
          const dest = writable("---<----->---#");

          await run([stream], async (stream) => {
            stream.pipeTo(dest).catch(() => {});

            await delay(1);
            assertEquals(chunkCount, 0);

            await delay(200);
            assertEquals(chunkCount, 1);

            await delay(200);
            assertEquals(chunkCount, 2);

            await delay(200);
            assertEquals(chunkCount, 2);

            await delay(200);
            assertEquals(chunkCount, 2);

            await delay(100 - 2);
            assertEquals(chunkCount, 2);

            await delay(2);
            assertEquals(chunkCount, 3);

            await delay(100);
            assertEquals(chunkCount, 4);

            await delay(200);
            assertEquals(chunkCount, 5);
          });

          await assertReadable(stream, expected, values);
        });
      });
      it("should be pass throughs backpressure to the stream created with `readable`", async () => {
        await testStream(
          async ({ readable, writable, run, assertReadable }) => {
            const stream = readable("1-2-3   -4-5-6-7-(8|)");
            const dest = writable("  <--->   --<--------->      -----");
            const expected = "       1---(23)-4-5--------(678|)";
            // Apply backpressure ---^----------^
            // Release backpressure -----^---------------^

            await run([], () => {
              stream.pipeTo(dest);
            });

            await assertReadable(stream, expected);
          },
        );
      });
      it("should not advances time inside `fn` without delay", async () => {
        await testStream({
          tickTime: 100,
          maxTicks: 50,
          async fn({ run }) {
            const start = Date.now();
            const times: number[] = [];

            await run([], () => {
              times.push(Date.now() - start);
            });

            assertEquals(times, [0]);
          },
        });
      });
      it("should not rejects if called without await", async () => {
        let runPromise!: Promise<void>;
        await testStream(({ run, readable }) => {
          const stream = readable("a-|");

          runPromise = run([stream]);
        }).catch(() => {
          // Ignore LeakingAsyncOpsError
        });

        // runPromise should not rejects.
        await runPromise;
      });
      it("should not rejects if called without await and `testStream` block is disposed reader is resolved", async () => {
        let runPromise!: Promise<void>;
        await testStream(async ({ run, readable }) => {
          const stream = readable("a-|");

          const nextWaiter = deferred<void>();

          runPromise = run([stream], async () => {
            const reader = stream.getReader();
            try {
              await reader.read();
              nextWaiter.resolve();
            } finally {
              reader.releaseLock();
            }
          });

          await nextWaiter.promise;
        }).catch(() => {
          // Ignore LeakingAsyncOpsError
        });

        // runPromise should not rejects.
        await runPromise;
      });
      for (
        const [name, t] of [
          ["0", 0],
          ["less than `tickTime`", 42],
          ["same as `tickTime`", 100],
          ["a multiple of `tickTime`", 200],
          ["not a multiple of `tickTime`", 563],
          ["same as `tickTime * maxTicks`", 100 * 50],
          ["more than `tickTime * maxTicks`", 100 * 50 + 398],
        ] as const
      ) {
        it(`should advances time with \`delay\` inside \`fn\`: ${name}`, async () => {
          await testStream({
            tickTime: 100,
            maxTicks: 50,
            async fn({ run }) {
              const start = Date.now();
              const actual: number[] = [];

              await run([], async () => {
                await delay(t);
                actual.push(Date.now() - start);
              });

              assertEquals(actual, [t]);
            },
          });
        });
        it(`should advances time with \`setTimeout\` before \`fn\`: ${name}`, async () => {
          await testStream({
            tickTime: 100,
            maxTicks: 50,
            async fn({ run }) {
              const start = Date.now();
              const actual: number[] = [];

              setTimeout(() => {
                actual.push(Date.now() - start);
              }, t);

              await run([]);

              assertEquals(actual, [t]);
            },
          });
        });
        it(`should not advances time with \`setTimeout\` after \`fn\`: ${name}`, async () => {
          await testStream({
            tickTime: 100,
            maxTicks: 50,
            async fn({ run }) {
              const start = Date.now();
              const actual: number[] = [];

              await run([]);

              setTimeout(() => {
                actual.push(Date.now() - start);
              }, t);

              assertEquals(actual, []);
            },
          });
        });
        it(`should not rejects, if called without await and \`testStream\` block is disposed after delay: ${name}`, async () => {
          let runPromise!: Promise<void>;
          await testStream({
            tickTime: 100,
            maxTicks: 50,
            async fn({ run, readable }) {
              const stream = readable("--a--");

              runPromise = run([stream]);

              // Use await, which adds microtasks.
              await delay(t);
            },
          }).catch(() => {
            // Ignore LeakingAsyncOpsError
          });

          // runPromise should not rejects.
          await runPromise;
        });
        it(`should not rejects, if called without await and \`testStream\` block is disposed after delay without microtasks: ${name}`, async () => {
          let runPromise!: Promise<void>;
          await testStream({
            tickTime: 100,
            maxTicks: 50,
            fn({ run, readable }) {
              const stream = readable("--a--");

              runPromise = run([stream]);

              // Returns a delay Promise directly, which avoids additional microtasks.
              return delay(t);
            },
          }).catch(() => {
            // Ignore LeakingAsyncOpsError
          });

          // runPromise should not rejects.
          await runPromise;
        });
      }
    });
    describe(".writable", () => {
      it("should returns a writable stream", async () => {
        await testStream(({ writable }) => {
          const stream = writable("-----");

          assertInstanceOf(stream, WritableStream);
        });
      });
      it("should returns a writable stream inside `run`", async () => {
        await testStream(async ({ writable, run }) => {
          const createStream = () => writable("---");

          await run([], async () => {
            await delay(200);
            const stream = createStream();
            assertInstanceOf(stream, WritableStream);
          });
        });
      });
      it("should returns a writable stream inside and outside `run`", async () => {
        await testStream(async ({ writable, run }) => {
          const createStream1 = () => writable("---");
          const createStream2 = () => writable("----");
          const createStream3 = () => writable("-----");

          // stream1 created outside `run`
          const stream1 = createStream1();

          // stream3 created asynchronously outside `run`
          let stream3;
          delay(1300).then(() => {
            stream3 = createStream3();
          });

          let stream2;
          await run([], async () => {
            // stream2 created asynchronously inside `run`
            await delay(200);
            stream2 = createStream2();
          });

          assertInstanceOf(stream1, WritableStream);
          assertInstanceOf(stream2, WritableStream);
          assertInstanceOf(stream3, WritableStream);
        });
      });
      it("should throws if called outside `testStream`", async () => {
        let savedWritable: TestStreamHelperWritable;

        await testStream(({ writable }) => {
          savedWritable = writable;
        });

        assertThrows(
          () => {
            savedWritable("---");
          },
          OperationNotPermittedError,
          "Helpers does not allow call outside `testStream`",
        );
      });
      describe("(series, ...)", () => {
        it("should be possible to not specify", async () => {
          await testStream(({ writable }) => {
            const stream = writable();

            assertInstanceOf(stream, WritableStream);
          });
        });
        it("should be possible to specify an empty string", async () => {
          await testStream(({ writable }) => {
            const stream = writable("");

            assertInstanceOf(stream, WritableStream);
          });
        });
        for (
          const series of [
            "|", // `readable` close
            "!", // `readable` cancel
            "a", // `readable` enqueue
            "()", // `readable` group
            "$", // reserved
            "%", // reserved
            "`", // reserved
            "~", // reserved
          ]
        ) {
          it(`should throws if contains invalid character: ${toPrint(series)}`, async () => {
            await testStream(({ writable }) => {
              assertThrows(
                () => {
                  writable(series);
                },
                SyntaxError,
                "Invalid character",
              );
            });
          });
        }
        for (
          const series of [
            "<<",
            "<--<",
            "<><---<",
          ]
        ) {
          it(`should throws if backpressure already applied: ${toPrint(series)}`, async () => {
            await testStream(({ writable }) => {
              assertThrows(
                () => {
                  writable(series);
                },
                SyntaxError,
                "Backpressure already applied",
              );
            });
          });
        }
        for (
          const series of [
            ">",
            "-->",
            "<>-<-->->",
          ]
        ) {
          it(`should throws if backpressure already released: ${toPrint(series)}`, async () => {
            await testStream(({ writable }) => {
              assertThrows(
                () => {
                  writable(series);
                },
                SyntaxError,
                "Backpressure already released",
              );
            });
          });
        }
        for (
          const series of [
            "--#-",
            "--#<",
          ]
        ) {
          it(`should throws if non-trailing error: ${toPrint(series)}`, async () => {
            await testStream(({ writable }) => {
              assertThrows(
                () => {
                  writable(series);
                },
                SyntaxError,
                "Non-trailing close",
              );
            });
          });
        }
        for (
          const series of [
            "#",
            "---#",
          ]
        ) {
          it(`should not throws if trailing error: ${toPrint(series)}`, async () => {
            await testStream(({ writable }) => {
              const stream = writable(series);

              assertInstanceOf(stream, WritableStream);
            });
          });
        }
        it("should ignores ` `", async () => {
          const IS_PENDING = {} as const;
          await testStream(async ({ writable, run }) => {
            const source = new ReadableStream();
            const stream = writable("   -   - -  #   ", "error");

            await run([source], async (source) => {
              const p = source.pipeTo(stream);
              p.catch(() => {});

              await delay(300 - 1);
              assertStrictEquals(
                await Promise.race([p, Promise.resolve(IS_PENDING)]),
                IS_PENDING,
                "p should not fulfilled before 3 ticks",
              );

              await delay(2);
              const reason = await assertRejects(
                () => Promise.race([p, Promise.resolve(IS_PENDING)]),
              );
              assertEquals(reason, "error");
            });
          });
        });
        it("should advances one tick with `-`", async () => {
          const IS_PENDING = {} as const;
          await testStream(async ({ writable, run }) => {
            const source = new ReadableStream();
            const stream = writable("-----#", "error");

            await run([source], async (source) => {
              const p = source.pipeTo(stream);
              p.catch(() => {});

              await delay(500 - 1);
              assertStrictEquals(
                await Promise.race([p, Promise.resolve(IS_PENDING)]),
                IS_PENDING,
                "p should not fulfilled before 3 ticks",
              );

              await delay(2);
              const reason = await assertRejects(
                () => Promise.race([p, Promise.resolve(IS_PENDING)]),
              );
              assertEquals(reason, "error");
            });
          });
        });
        it("should not close the stream without `#`", async () => {
          const IS_PENDING = {} as const;
          let stream: WritableStream<string>;
          let streamClosed: Promise<void>;

          await testStream({
            maxTicks: 10,
            async fn({ writable, run }) {
              const source = new ReadableStream();
              stream = writable("---");

              await run([source], (source) => {
                streamClosed = source.pipeTo(stream);
              });

              assertEquals(stream.locked, true);
              assertStrictEquals(
                await Promise.race([streamClosed, IS_PENDING]),
                IS_PENDING,
                "streamClosed should not fulfilled",
              );
            },
          });

          assertEquals(stream!.locked, false);
          const stramCloseReason = await assertRejects(
            () => Promise.race([streamClosed, IS_PENDING]),
          );
          assertEquals(stramCloseReason, "testStream disposed");
        });
        it("should applies backpressure with `<`", async () => {
          await testStream(async ({ writable, run }) => {
            let chunkCount = 0;
            let ready = deferred<void>();
            const timer = setInterval(() => ready.resolve(), 200);
            const source = new ReadableStream<number>({
              async pull(controller) {
                await ready.promise;
                ready = deferred();
                ++chunkCount;
                controller.enqueue(chunkCount);
              },
              cancel(reason) {
                clearInterval(timer);
                ready.reject(reason);
              },
            }, { highWaterMark: 0 });

            // source:               --1-2-3-4-...
            // expected:             --1-2----!
            const stream = writable("---<-----#");

            await run([], async () => {
              source.pipeTo(stream).catch(() => {});

              await delay(1);
              assertEquals(chunkCount, 0);

              await delay(200);
              assertEquals(chunkCount, 1);

              await delay(200);
              assertEquals(chunkCount, 2);

              await delay(200);
              assertEquals(chunkCount, 2);

              await delay(200);
              assertEquals(chunkCount, 2);
            });
          });
        });
        it("should release backpressure with `>`", async () => {
          await testStream(async ({ writable, run }) => {
            let chunkCount = 0;
            let ready = deferred<void>();
            const timer = setInterval(() => ready.resolve(), 200);
            const source = new ReadableStream<number>({
              async pull(controller) {
                await ready.promise;
                ready = deferred();
                ++chunkCount;
                controller.enqueue(chunkCount);
              },
              cancel(reason) {
                clearInterval(timer);
                ready.reject(reason);
              },
            }, { highWaterMark: 0 });

            // source:               --1-2-3-4-5-6-...
            // expected:             --1-2----34-5!
            const stream = writable("---<----->---#");

            await run([], async () => {
              source.pipeTo(stream).catch(() => {});

              await delay(1);
              assertEquals(chunkCount, 0);

              await delay(200);
              assertEquals(chunkCount, 1);

              await delay(200);
              assertEquals(chunkCount, 2);

              await delay(200);
              assertEquals(chunkCount, 2);

              await delay(200);
              assertEquals(chunkCount, 2);

              await delay(100 - 2);
              assertEquals(chunkCount, 2);

              await delay(2);
              assertEquals(chunkCount, 3);

              await delay(100);
              assertEquals(chunkCount, 4);

              await delay(200);
              assertEquals(chunkCount, 5);
            });
          });
        });
        it("should throws if ticks longer than `maxTicks`", async () => {
          await testStream({
            maxTicks: 5,
            fn({ writable }) {
              assertThrows(
                () => {
                  writable("------");
                },
                MaxTicksExceededError,
                "Ticks exceeded",
              );
            },
          });
        });
      });
      describe("(..., error)", () => {
        it("should be undefined for error reason if not specified", async () => {
          await testStream(async ({ writable, run }) => {
            const source = new ReadableStream();
            const stream = writable("----#");

            const p = source.pipeTo(stream);
            p.catch(() => {});
            await run([]);

            const actual = await assertRejects(() => p);
            assertStrictEquals(actual, undefined);
          });
        });
        for (const reason of ABORT_REASON_CASES) {
          it(`should be possible to specify for error: ${toPrint(reason)}`, async () => {
            await testStream(async ({ writable, run }) => {
              const source = new ReadableStream();
              const stream = writable("----#", reason);

              const p = source.pipeTo(stream);
              p.catch(() => {});
              await run([]);

              const actual = await assertRejects(() => p);
              assertStrictEquals(actual, reason);
            });
          });
        }
      });
      it("should be able to write chunks from the source", async () => {
        const IS_PENDING = {} as const;
        await testStream(async ({ writable, run }) => {
          const actual: string[] = [];
          const sourceChunks = ["a", "b", "c"];
          const source = new ReadableStream({
            pull(controller) {
              const chunk = sourceChunks.shift();
              if (chunk) {
                controller.enqueue(chunk);
                actual.push(chunk);
              } else {
                controller.close();
                actual.push("|");
              }
            },
          }, { highWaterMark: 0 });

          const stream = writable();

          await run([], () => {
            source.pipeTo(stream);
          });

          assertNotStrictEquals(
            await Promise.race([stream.getWriter().closed, IS_PENDING]),
            IS_PENDING,
          );
          assertEquals(actual, ["a", "b", "c", "|"]);
        });
      });
      it("should closes if the source closed", async () => {
        const IS_PENDING = {} as const;
        await testStream({
          tickTime: 100,
          async fn({ writable, run }) {
            const source = new ReadableStream({
              start(controller) {
                setTimeout(() => {
                  controller.close();
                }, 150);
              },
            });

            const stream = writable();

            await run([], async () => {
              const start = Date.now();
              await source.pipeTo(stream);
              assertEquals(Date.now() - start, 150);
            });

            assertNotStrictEquals(
              await Promise.race([stream.getWriter().closed, IS_PENDING]),
              IS_PENDING,
            );
          },
        });
      });
      it("should aborts if the source aborted", async () => {
        const IS_PENDING = {} as const;
        await testStream({
          tickTime: 100,
          async fn({ writable, run }) {
            const source = new ReadableStream({
              start(controller) {
                setTimeout(() => {
                  controller.error("abort");
                }, 150);
              },
            });

            const stream = writable();

            await run([], async () => {
              const start = Date.now();
              await source.pipeTo(stream).catch(() => {});
              assertEquals(Date.now() - start, 150);
            });

            const abortReason = await assertRejects(
              async () => {
                await Promise.race([stream.getWriter().closed, IS_PENDING]);
              },
            );
            assertEquals(abortReason, "abort");
          },
        });
      });
    });
  });
});
