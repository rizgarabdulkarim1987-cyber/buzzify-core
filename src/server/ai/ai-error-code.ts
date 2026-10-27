import { ZodError } from 'zod';
import { StudioError } from '@/server/studio/framework/result';
import { AiEmptyPageError, AiLinkError, AiProviderError, AiInputTooLargeError, AiLimitReachedError, AiNotEnabledError, AiOutputRejectedError, AiRefusedError, AiUnavailableError, AiUnreadableError } from './errors';

/** What a screen is told when an AI operation does not produce an answer. */
export type AiErrorCode = 'aiDisabled' | 'aiLimit' | 'aiUnavailable' | 'aiRefused' | 'ungrounded' | 'unreadable' | 'tooLarge' | 'badLink' | 'emptyPage' | 'invalid' | 'notFound' | 'failed';

export type AiFailure = { ok: false; code: AiErrorCode };

/** Maps an error to a code. An unexpected error is logged by name only (its message could carry content) and answers `failed`. */
export function aiErrorCode(error: unknown): AiErrorCode {
  if (error instanceof AiNotEnabledError) return 'aiDisabled';
  if (error instanceof AiLimitReachedError) return 'aiLimit';
  if (error instanceof AiUnavailableError) {
    console.error('ai unavailable', error.name, error instanceof AiProviderError ? error.detail : error.message);
    return 'aiUnavailable';
  }
  if (error instanceof AiRefusedError) return 'aiRefused';
  if (error instanceof AiOutputRejectedError) return 'ungrounded';
  if (error instanceof AiUnreadableError) return 'unreadable';
  if (error instanceof AiInputTooLargeError) return 'tooLarge';
  if (error instanceof AiLinkError) return 'badLink';
  if (error instanceof AiEmptyPageError) return 'emptyPage';
  if (error instanceof ZodError) return 'invalid';
  if (error instanceof StudioError && error.code === 'NOT_FOUND') return 'notFound';
  if (error instanceof StudioError && error.code === 'INVALID') return 'invalid';
  console.error('ai action failed', error instanceof Error ? error.name : typeof error);
  return 'failed';
}

/** Runs an AI operation and returns its result or the failure code. */
export async function guardedAi<T>(work: () => Promise<T>): Promise<({ ok: true } & T) | AiFailure> {
  try {
    return { ok: true, ...(await work()) };
  } catch (error) {
    return { ok: false, code: aiErrorCode(error) };
  }
}
