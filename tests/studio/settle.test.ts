import { describe, expect, it } from 'vitest';
import type { ActionResult } from '@/server/studio/framework/result';
import { describeFailure } from '@/studio/errors';
import { getStudioTranslator, STUDIO_MESSAGES } from '@/studio/messages';
import { NETWORK_FAILURE, settle } from '@/studio/settle';

/** Ported from Business Core (tests/admin/settle.test.ts). */
describe('settle', () => {
  it('turns a rejected call into a failure, and a retry sends the same idempotency key', async () => {
    const key = crypto.randomUUID();
    const sent: string[] = [];
    let attempt = 0;
    const submit = async (idempotencyKey: string): Promise<ActionResult<{ paymentId: string }>> => {
      sent.push(idempotencyKey);
      attempt += 1;
      if (attempt === 1) throw new TypeError('Failed to fetch');
      return { ok: true, data: { paymentId: 'p1' } };
    };

    const first = await settle(() => submit(key));
    expect(first).toEqual({ ok: false, error: { code: 'INVALID', message: NETWORK_FAILURE } });

    const second = await settle(() => submit(key));
    expect(second).toEqual({ ok: true, data: { paymentId: 'p1' } });
    expect(sent).toEqual([key, key]);
  });

  it('passes an answered refusal through unchanged', async () => {
    const refusal = { ok: false as const, error: { code: 'CONFLICT' as const, message: 'x' } };
    expect(await settle(async () => refusal)).toBe(refusal);
  });

  it.each(['en', 'ar', 'ckb'] as const)('says the connection failed in %s', (locale) => {
    const described = describeFailure(getStudioTranslator(locale), locale, { code: 'INVALID', message: NETWORK_FAILURE });
    expect(described.message).toBe(STUDIO_MESSAGES[locale]['error.network']);
  });
});
