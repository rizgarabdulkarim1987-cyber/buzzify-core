/**
 * The rules of the complaints box as pure data and functions: what a guest may write, how often a table may send, and which
 * status moves are allowed.
 */

export const COMPLAINT_CATEGORIES = ['FOOD', 'SERVICE', 'CLEANLINESS', 'PRICE', 'OTHER', 'SUGGESTION'] as const;
export const COMPLAINT_STATUSES = ['NEW', 'IN_PROGRESS', 'RESOLVED'] as const;
export type ComplaintStatusKey = (typeof COMPLAINT_STATUSES)[number];

export const COMPLAINT_RAW_MAX = 4000;
export const COMPLAINT_TEXT_MAX = 1000;
export const CONTACT_NAME_MAX = 80;
export const NOTE_MAX = 1000;

export const COMPLAINT_LIMITS = {
  /** Complaints one table may send in any ten minutes. */
  perTablePer10Minutes: 3,
  /** Complaints one table may send in a day. */
  perTablePerDay: 10,
  /** Complaints one restaurant may receive in any hour. */
  perRestaurantPerHour: 60,
  /** Submissions one address may make to one restaurant in a minute. */
  perIpPerMinute: 10,
} as const;

/** NEW goes to IN_PROGRESS or RESOLVED, IN_PROGRESS to RESOLVED, and a resolved one can be reopened. Nothing returns to NEW. */
export const ALLOWED_MOVES: Record<ComplaintStatusKey, readonly ComplaintStatusKey[]> = {
  NEW: ['IN_PROGRESS', 'RESOLVED'],
  IN_PROGRESS: ['RESOLVED'],
  RESOLVED: ['IN_PROGRESS'],
};

export function canMove(from: ComplaintStatusKey, to: ComplaintStatusKey): boolean {
  return ALLOWED_MOVES[from].includes(to);
}

/**
 * Guest text with bidi embeddings, overrides and isolates and control characters removed (a newline is kept; CRLF becomes
 * one newline), so it cannot reorder the page or hide in a log.
 */
export function cleanGuestText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[‪-‮⁦-⁩​-‏؜⁠﻿]/g, '')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g, '');
}

/** Real content: at least one letter or digit, so spaces, zero-width characters and punctuation alone are refused. */
export const hasContent = (text: string): boolean => /[\p{L}\p{N}]/u.test(text);

/** The first characters of a body for a list row. */
export function excerpt(body: string, max = 140): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${[...flat].slice(0, max).join('')}…`;
}
