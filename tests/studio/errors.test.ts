import { describe, expect, it } from 'vitest';
import { describeFailure } from '@/studio/errors';
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

  it('shows the generic message for an unexpected failure', () => {
    expect(describeFailure(ar, 'ar', { code: 'INVALID', message: 'Something went wrong' }).message).toBe(ar('error.unexpected'));
  });
});
