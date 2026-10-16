import { describe, expect, it } from 'vitest';
import { describeFailure } from '@/studio/errors';
import { formatDateTime } from '@/studio/format';
import { getStudioTranslator } from '@/studio/messages';

const en = getStudioTranslator('en');
const ar = getStudioTranslator('ar');

describe('describeFailure', () => {
  it('shows a refusal in the catalog wording, not the server English', () => {
    const failure = { code: 'INVALID' as const, message: 'Wrong email or password' };
    expect(describeFailure(en, 'en', failure).message).toBe('Wrong email or password');
    expect(describeFailure(ar, 'ar', failure).message).toBe(ar('error.text.signInFailed'));
    expect(describeFailure(ar, 'ar', failure).message).not.toContain('Wrong');
  });

  it('translates field messages and keeps them under their field', () => {
    const failure = {
      code: 'INVALID' as const,
      message: 'Check the highlighted fields',
      fields: { password: 'This password is too common. Choose one that is harder to guess', code: 'That code is not correct' },
    };
    const described = describeFailure(ar, 'ar', failure);
    expect(described.message).toBe(ar('error.INVALID'));
    expect(described.fields.password).toBe(ar('error.text.passwordCommon'));
    expect(described.fields.code).toBe(ar('error.text.codeWrong'));
  });

  it('falls back to the code label for a text it does not know, except in English', () => {
    const failure = { code: 'CONFLICT' as const, message: 'Some brand-new refusal', fields: { name: 'Another new one' } };
    expect(describeFailure(ar, 'ar', failure).message).toBe(ar('error.CONFLICT'));
    expect(describeFailure(ar, 'ar', failure).fields.name).toBe(ar('error.field'));
    expect(describeFailure(en, 'en', failure).message).toBe('Some brand-new refusal');
    expect(describeFailure(en, 'en', failure).fields.name).toBe('Another new one');
  });

  it('says how long to wait when the server gives a retry time, and keeps that number out of the fields', () => {
    const failure = { code: 'RATE_LIMITED' as const, message: 'Too many attempts. Try again later.', fields: { retryAfterSec: '125' } };
    const described = describeFailure(en, 'en', failure);
    expect(described.message).toBe('Too many attempts. Try again in 3 minutes.');
    expect(described.fields).toEqual({});
    expect(describeFailure(en, 'en', { code: 'RATE_LIMITED', message: 'Too many attempts. Try again later.' }).message).toBe(
      'Too many attempts. Try again later.',
    );
  });

  it('says who changed a row and when for a refused save, and keeps both out of the fields', () => {
    // What the message wraps a person's name in, so the name cannot reorder the words around it: first strong isolate,
    // pop isolate.
    const fsi = String.fromCharCode(0x2068);
    const pdi = String.fromCharCode(0x2069);
    const failure = {
      code: 'CONFLICT' as const,
      message: 'Someone else changed this while you were editing. Reload to see their changes.',
      fields: { changedBy: 'Sam Admin', changedAt: '2026-10-16T16:05:00.000Z' },
    };
    const described = describeFailure(en, 'en', failure);
    // 19:05 in Baghdad (UTC+3).
    expect(described.message).toBe(`Changed by ${fsi}Sam Admin${pdi} on ${formatDateTime(failure.fields.changedAt, 'en')}. Reload to see their changes.`);
    expect(described.message).toMatch(/on Oct 16, 2026, 7:05\sPM\./);
    expect(described.fields).toEqual({});
    expect(describeFailure(ar, 'ar', failure).message).toContain('Sam Admin');
    expect(describeFailure(ar, 'ar', failure).message).not.toContain('Changed');

    // Without a name (the row's history is gone) the sentence says someone else; without a time, the general one stands.
    expect(describeFailure(en, 'en', { ...failure, fields: { changedAt: failure.fields.changedAt } }).message).toMatch(
      /^Changed by someone else on Oct 16, 2026, 7:05\sPM\. Reload to see their changes\.$/,
    );
    expect(describeFailure(en, 'en', { code: 'CONFLICT', message: failure.message }).message).toBe(en('error.CONFLICT'));
  });

  it('shows the generic message for an unexpected failure', () => {
    expect(describeFailure(ar, 'ar', { code: 'INVALID', message: 'Something went wrong' }).message).toBe(ar('error.unexpected'));
  });
});
