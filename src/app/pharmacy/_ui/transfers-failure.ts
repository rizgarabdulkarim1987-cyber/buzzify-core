import type { StudioFailure } from '@/server/studio/framework/result';
import { NETWORK_FAILURE } from '@/studio/settle';

/**
 * A call whose answer never came back (the connection dropped). Edit and cancel carry no idempotency key, so the change may
 * already be saved: the screens refresh and say so, and a conflict that follows on the same screen is read the same way
 * instead of as "someone else changed this".
 */
export const lostAnswer = (failure: StudioFailure): boolean => !failure.fields?.phCode && failure.message === NETWORK_FAILURE;

/** A conflict code: the version moved on or the state is no longer the one the screen showed. */
export const isConflict = (code: string | undefined): boolean => code === 'VERSION_CONFLICT' || code === 'NOT_REQUESTED' || code === 'NOT_SENT';
