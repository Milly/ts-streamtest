/**
 * Like `ReadableStream.from([...])`
 */
export function from<T>(ary: T[]): ReadableStream<T> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of ary) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
}
