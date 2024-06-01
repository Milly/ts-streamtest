// @deno-types="@types/sinonjs__fake-timers"
import {
  type FakeMethod,
  install,
  type InstalledClock,
  type NodeClock,
  timers,
} from "@sinonjs/fake-timers";

interface FakeClockJobs {
  jobs?: unknown[];
}

export const delayImmediate: () => Promise<void> = (() => {
  const { port1, port2 } = new MessageChannel();
  port1.start();
  const delayImmediate = () =>
    new Promise<void>((resolve) => {
      port1.addEventListener("message", () => resolve(), { once: true });
      port2.postMessage(null);
    });
  return delayImmediate;
})();

export class FakeTime implements Disposable {
  #clock = install({
    now: Date.now(),
    toFake: Object.keys(timers) as FakeMethod[],
  });
  #origMethods: [FakeMethod, unknown][] = [];

  get clock(): InstalledClock {
    this.#assertDisposed();
    return this.#clock;
  }

  get timerCount(): number {
    this.#assertDisposed();
    return this.#clock.countTimers();
  }

  constructor() {
    // NOTE: In Deno, @sinonjs/fake-timers can not install timer methods to globalThis.
    for (const method of this.#clock.methods) {
      const orig = globalThis[method as keyof typeof globalThis];
      const fake = this.#clock[method as keyof InstalledClock];
      if (method in globalThis && orig !== fake) {
        this.#origMethods.push([method, orig]);
        // deno-lint-ignore no-explicit-any
        (globalThis as any)[method] = fake;
      }
    }
  }

  async runMicrotasks(): Promise<void> {
    this.#assertDisposed();
    for (;;) {
      await delayImmediate();
      if (!((this.#clock as FakeClockJobs)?.jobs?.length)) break;
      (this.#clock as NodeClock).runMicrotasks();
    }
  }

  tick(time: number): void {
    this.#assertDisposed();
    this.#clock.tick(time);
  }

  next(): void {
    this.#assertDisposed();
    this.#clock.next();
  }

  restore(): void {
    this.#assertDisposed();
    for (const [method, orig] of this.#origMethods) {
      // deno-lint-ignore no-explicit-any
      (globalThis as any)[method] = orig;
    }
    this.#clock.uninstall();
    // deno-lint-ignore no-explicit-any
    this.#clock = undefined as any;
  }

  [Symbol.dispose](): void {
    if (this.#clock) {
      this.restore();
    }
  }

  #assertDisposed(): void {
    if (!this.#clock) {
      throw new TypeError("FakeTime is disposed");
    }
  }
}
