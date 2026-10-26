import type { ActionResult } from '@/server/studio/framework/result';

/**
 * The text of a call that never got an answer (the connection dropped, the server restarted). Translated through
 * SERVER_TEXT like any server text. Ported from Business Core (src/admin/settle.ts).
 */
export const NETWORK_FAILURE = 'The connection failed before an answer came back. Nothing you typed is lost: try again.';

/**
 * Runs a Server Action call and turns a rejected call into a failure instead of an error thrown to the page's error
 * boundary. The form or dialog that made the call then stays open with what was typed, so a retry sends the same values,
 * a payment's idempotency key among them, and the server records it once.
 *
 * The Studio has no `UNEXPECTED` code: an unexpected failure is answered as `INVALID` with its own sentence, as the
 * framework does for an error it did not expect (`UNEXPECTED_MESSAGE`).
 */
export async function settle<T>(call: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await call();
  } catch {
    return { ok: false, error: { code: 'INVALID', message: NETWORK_FAILURE } };
  }
}
