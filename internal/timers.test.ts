import { afterEach, beforeEach, describe, it } from "#bdd";
import {
  assertEquals,
  assertNotStrictEquals,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "@std/assert";
import { delayImmediate, FakeTime } from "./timers.ts";

describe("delayImmediate()", () => {
  it("should resolves all microtasks", async () => {
    const logs: string[] = [];
    Promise.resolve().then(() => logs.push("foo"));
    Promise.resolve().then(() => logs.push("bar"));
    assertEquals(logs, []);
    await delayImmediate();
    assertEquals(logs, ["foo", "bar"]);
  });
  it("should resolves multiple calls", async () => {
    const logs: string[] = [];
    await Promise.all([
      delayImmediate().then(() => {
        logs.push("a");
        return delayImmediate().then(() => logs.push("d"));
      }),
      delayImmediate().then(() => logs.push("b")),
      delayImmediate().then(() => logs.push("c")),
    ]);
    assertEquals(logs, ["a", "b", "c", "d"]);
  });
});

describe("new FakeTime()", () => {
  const origSetTimeout = setTimeout;
  it("should create instance of `FakeTime`", () => {
    const actual = new FakeTime();
    actual.restore();
  });
  it("should mock `setTimeout`", () => {
    const actual = new FakeTime();
    try {
      assertNotStrictEquals(setTimeout, origSetTimeout);
    } finally {
      actual.restore();
    }
  });
});
describe("FakeTime", () => {
  // deno-lint-ignore no-explicit-any
  let origSetTimeout: (...args: any[]) => unknown;
  let instance: FakeTime;
  beforeEach(() => {
    origSetTimeout = setTimeout;
    instance = new FakeTime();
  });
  afterEach(() => {
    instance[Symbol.dispose]();
  });
  describe(".clock", () => {
    it("should throws if already disposed", () => {
      instance.restore();
      assertThrows(() => instance.clock, TypeError, "disposed");
    });
  });
  describe(".timerCount", () => {
    it("should throws if already disposed", () => {
      instance.restore();
      assertThrows(() => instance.timerCount, TypeError, "disposed");
    });
  });
  describe(".runMicrotasks()", () => {
    it("should resolves microtasks", async () => {
      const logs: string[] = [];
      Promise.resolve().then(() => logs.push("foo"));
      Promise.resolve().then(() => logs.push("bar"));
      assertEquals(logs, []);
      await instance.runMicrotasks();
      assertEquals(logs, ["foo", "bar"]);
    });
    it("should calls queued microtasks", async () => {
      const logs: string[] = [];
      queueMicrotask(() => logs.push("foo"));
      queueMicrotask(() => logs.push("bar"));
      assertEquals(logs, []);
      await instance.runMicrotasks();
      assertEquals(logs, ["foo", "bar"]);
    });
    it("should not calls 0ms timer", async () => {
      const logs: string[] = [];
      setTimeout(() => logs.push("foo"), 0);
      assertEquals(logs, []);
      await instance.runMicrotasks();
      assertEquals(logs, []);
    });
    it("should rejects if already disposed", async () => {
      instance.restore();
      await assertRejects(
        () => instance.runMicrotasks(),
        TypeError,
        "disposed",
      );
    });
  });
  describe(".tick()", () => {
    it("should calls timers", () => {
      const logs: string[] = [];
      setTimeout(() => logs.push("foo"), 100);
      setTimeout(() => logs.push("bar"), 200);
      setTimeout(() => logs.push("baz"), 300);
      instance.tick(50);
      assertEquals(logs, []);
      instance.tick(150);
      assertEquals(logs, ["foo", "bar"]);
    });
    it("should throws if already disposed", () => {
      instance.restore();
      assertThrows(() => instance.tick(0), TypeError, "disposed");
    });
  });
  describe(".next()", () => {
    it("should calls next timer", () => {
      const logs: string[] = [];
      setTimeout(() => logs.push("foo"), 100);
      setTimeout(() => logs.push("bar"), 200);
      setTimeout(() => logs.push("baz"), 300);
      assertEquals(logs, []);
      instance.next();
      assertEquals(logs, ["foo"]);
      instance.next();
      assertEquals(logs, ["foo", "bar"]);
      instance.next();
      assertEquals(logs, ["foo", "bar", "baz"]);
    });
    it("should throws if already disposed", () => {
      instance.restore();
      assertThrows(() => instance.next(), TypeError, "disposed");
    });
  });
  describe(".restore()", () => {
    it("should restore `setTimeout`", () => {
      assertNotStrictEquals(setTimeout, origSetTimeout);
      instance.restore();
      assertStrictEquals(setTimeout, origSetTimeout);
    });
    it("should throws if already disposed", () => {
      instance.restore();
      assertThrows(() => instance.restore(), TypeError, "disposed");
    });
  });
  describe("[@@dispose]()", () => {
    it("should restore `setTimeout`", () => {
      assertNotStrictEquals(setTimeout, origSetTimeout);
      instance[Symbol.dispose]();
      assertStrictEquals(setTimeout, origSetTimeout);
    });
    it("should not throws if already disposed", () => {
      instance.restore();
      instance[Symbol.dispose]();
    });
  });
});
