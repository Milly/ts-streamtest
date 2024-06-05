export type PromiseState = "fulfilled" | "rejected" | "pending";
export type Deferred<T> = PromiseWithResolvers<T> & { state: PromiseState };

export function deferred<T>(): Deferred<T> {
  // NOTE: Do not use `Promise.withResolvers()` because old node environment.
  let resolve: (value: T | PromiseLike<T>) => void;
  let reject: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  let state: PromiseState = "pending";
  return {
    promise,
    resolve(value) {
      state = "fulfilled";
      resolve(value);
    },
    reject(reason) {
      state = "rejected";
      reject(reason);
    },
    get state() {
      return state;
    },
  };
}
