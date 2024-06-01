export type MutableTuple<T extends readonly unknown[]> =
  // deno-lint-ignore no-explicit-any
  ((...args: T) => any) extends ((...args: infer U) => any) ? U : never;
