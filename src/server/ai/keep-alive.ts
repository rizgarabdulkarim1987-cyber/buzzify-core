/**
 * Wraps a route handler whose work can take minutes (an AI reading). A fast answer goes out untouched. A slow one is sent
 * as a stream that writes a space every few seconds and the real body when it is ready, so a proxy that gives up on a
 * silent connection keeps waiting. Leading spaces are valid JSON whitespace, so the client reads the body as it always did.
 */
const FAST_MS = 1_500;
const BEAT_MS = 8_000;

type Handler<A extends unknown[]> = (...args: A) => Promise<Response>;

export function withKeepAlive<A extends unknown[]>(handler: Handler<A>): Handler<A> {
  return async (...args) => {
    const work = handler(...args);
    const fast = await Promise.race([work, new Promise<null>((resolve) => setTimeout(() => resolve(null), FAST_MS))]);
    if (fast !== null) return fast;

    const encoder = new TextEncoder();
    let beat: ReturnType<typeof setInterval> | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(' '));
        beat = setInterval(() => controller.enqueue(encoder.encode(' ')), BEAT_MS);
        work.then(
          async (response) => {
            clearInterval(beat);
            controller.enqueue(encoder.encode(await response.text()));
            controller.close();
          },
          () => {
            clearInterval(beat);
            controller.enqueue(encoder.encode(JSON.stringify({ error: { message: 'failed' } })));
            controller.close();
          },
        );
      },
      cancel() {
        clearInterval(beat);
      },
    });
    return new Response(stream, { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-accel-buffering': 'no' } });
  };
}
