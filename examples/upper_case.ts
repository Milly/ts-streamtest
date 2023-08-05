export class UpperCase extends TransformStream<string, string> {
  constructor() {
    super({
      transform(chunk, controller) {
        controller.enqueue(chunk.toUpperCase());
      },
    });
  }
}
