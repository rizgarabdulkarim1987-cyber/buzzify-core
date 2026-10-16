import type { z } from 'zod';
import type { PublishIssue } from '@/server/domain/publish-rules';

/**
 * Why a Studio action or query did not run. The Studio shows each in the person's language (`error.*` messages); the
 * English `message` is a fallback and what the logs read.
 */
export type ErrorCode =
  | 'UNAUTHENTICATED'
  | 'TWO_FACTOR_REQUIRED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'INVALID'
  | 'CONFLICT'
  | 'RATE_LIMITED';

export interface StudioFailure {
  code: ErrorCode;
  message: string;
  /** Per-field messages keyed by the field's dotted path (`hours.mon.1`), or the details of a conflict. */
  fields?: Record<string, string>;
  /** What stands in the way of a publish, one entry per problem, for the Studio to list by code in the person's language. */
  issues?: PublishIssue[];
}

/** What every action and query returns to its caller. Plain data, so it crosses the Server Action boundary as it is. */
export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: StudioFailure };

const DEFAULT_MESSAGES: Record<ErrorCode, string> = {
  UNAUTHENTICATED: 'Sign in to continue',
  TWO_FACTOR_REQUIRED: 'Set up two-factor authentication to continue',
  FORBIDDEN: 'You do not have permission to do this',
  NOT_FOUND: 'Not found',
  INVALID: 'Check the highlighted fields',
  CONFLICT: 'Someone else changed this while you were editing. Reload to see their changes.',
  RATE_LIMITED: 'Too many attempts. Try again later.',
};

/** The message an unexpected failure shows: nothing about what went wrong leaves the server. */
export const UNEXPECTED_MESSAGE = 'Something went wrong';

/** An expected refusal, thrown by a handler or a service. The framework turns it into the action's result. */
export class StudioError extends Error {
  readonly code: ErrorCode;
  readonly fields?: Record<string, string>;
  readonly issues?: PublishIssue[];

  constructor(code: ErrorCode, message: string = DEFAULT_MESSAGES[code], fields?: Record<string, string>, issues?: PublishIssue[]) {
    super(message);
    this.name = 'StudioError';
    this.code = code;
    if (fields) this.fields = fields;
    if (issues) this.issues = issues;
  }
}

export function failure(
  code: ErrorCode,
  message: string = DEFAULT_MESSAGES[code],
  fields?: Record<string, string>,
  issues?: PublishIssue[],
): {
  ok: false;
  error: StudioFailure;
} {
  return { ok: false, error: { code, message, ...(fields ? { fields } : {}), ...(issues ? { issues } : {}) } };
}

/**
 * A Zod failure as an `INVALID` result: one message per field, keyed by its dotted path (the first issue wins). An issue
 * about the input as a whole (not an object at all, say) has no path and becomes the message.
 */
export function invalidInput(error: z.ZodError): { ok: false; error: StudioFailure } {
  const fields: Record<string, string> = {};
  let message: string = DEFAULT_MESSAGES.INVALID;
  for (const issue of error.issues) {
    const path = issue.path.map(String).join('.');
    if (path === '') message = issue.message;
    else fields[path] ??= issue.message;
  }
  return failure('INVALID', message, Object.keys(fields).length > 0 ? fields : undefined);
}

/** The result for a thrown `StudioError`, or null for anything else. */
export function expectedFailure(error: unknown): { ok: false; error: StudioFailure } | null {
  return error instanceof StudioError ? failure(error.code, error.message, error.fields, error.issues) : null;
}

/**
 * Describes an unexpected error for the server log: its name, its code and, except for Prisma's errors, its message
 * and stack. Prisma's messages quote the query's arguments, which hold what the person typed, so they are left out;
 * the name, the code and the action's name are enough to find the failure.
 */
export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return `a thrown ${typeof error}`;
  const code = (error as { code?: unknown }).code;
  const label = typeof code === 'string' || typeof code === 'number' ? `${error.name} (${code})` : error.name;
  if (error.name.startsWith('PrismaClient')) return label;
  return `${label}: ${error.message}${error.stack ? `\n${error.stack.split('\n').slice(1).join('\n')}` : ''}`;
}
