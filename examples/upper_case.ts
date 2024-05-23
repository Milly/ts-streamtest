/**
 * Example module for [streamtest][]
 *
 * [streamtest]: https://jsr.io/@milly/streamtest
 *
 * @module
 */

/**
 * Transform string chunk to upper case.
 */
export class UpperCase extends TransformStream<string, string> {
  constructor() {
    super({
      transform(chunk, controller) {
        controller.enqueue(chunk.toUpperCase());
      },
    });
  }
}
