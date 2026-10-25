import { describe, expect, it } from 'vitest';
import { ACCUSATION_WORDS } from '@/server/ai/grounding';
import { AI_TOOLS } from '@/server/ai/tools';
import { ALERT_THRESHOLDS } from '@/server/ai/alerts';
import ar from '@/studio/messages/pos-ai/ar';
import ckb from '@/studio/messages/pos-ai/ckb';
import en from '@/studio/messages/pos-ai/en';

const LOCALES = { en, ar, ckb } as const;
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();

describe('the AI messages', () => {
  it('have the same keys in English, Arabic and Sorani, with the same placeholders in each', () => {
    const keys = Object.keys(en).sort();
    expect(Object.keys(ar).sort()).toEqual(keys);
    expect(Object.keys(ckb).sort()).toEqual(keys);
    for (const key of keys) {
      expect(placeholders(ar[key]!), key).toEqual(placeholders(en[key]!));
      expect(placeholders(ckb[key]!), key).toEqual(placeholders(en[key]!));
      expect(ar[key]!.trim(), key).not.toBe('');
      expect(ckb[key]!.trim(), key).not.toBe('');
    }
  });

  it('say nothing a person could take as an accusation, in any language', () => {
    for (const [locale, tree] of Object.entries(LOCALES)) {
      for (const [key, text] of Object.entries(tree)) {
        const lower = text.toLowerCase();
        for (const word of ACCUSATION_WORDS) expect(lower.includes(word), `${locale} ${key} contains "${word}"`).toBe(false);
      }
    }
  });

  it('describe every alert as worth reviewing', () => {
    const phrase = { en: 'Worth reviewing', ar: 'تستحق المراجعة', ckb: 'شایەنی پێداچوونەوەیە' } as const;
    for (const [locale, tree] of Object.entries(LOCALES)) {
      const alerts = Object.entries(tree).filter(([key]) => /^pos\.ai\.alerts\.(cashDifference|highDiscounts|manyCancels|blankCancelReasons|refunds|outsideShiftCancels)$/.test(key));
      expect(alerts, locale).toHaveLength(6);
      for (const [key, text] of alerts) expect(text, `${locale} ${key}`).toContain(phrase[locale as keyof typeof phrase]);
    }
  });

  it('name every error code, every tool, every summary period and every language the screens can show', () => {
    const needed = [
      ...['aiDisabled', 'aiLimit', 'aiUnavailable', 'aiRefused', 'ungrounded', 'unreadable', 'tooLarge', 'invalid', 'notFound', 'failed'].map((c) => `pos.ai.error.${c}`),
      ...AI_TOOLS.map((tool) => `pos.ai.method.${tool.name}`),
      ...['DAILY', 'WEEKLY', 'MONTHLY'].map((k) => `pos.ai.summary.kind.${k}`),
      ...['ar', 'ckb', 'en', 'other'].map((l) => `pos.ai.language.${l}`),
      ...['ask', 'summary', 'alerts', 'supply', 'complaints', 'package'].map((s) => `pos.ai.tab.${s}`),
      'activity.action.pos.ai.package',
      'activity.action.pos.ai.complaint.label',
      'activity.entity.PosAiPackage',
      'pos.nav.ai',
    ];
    for (const key of needed) expect(Object.keys(en), key).toContain(key);
  });

  it('keep the thresholds of the alert rules as plain numbers the copy does not repeat', () => {
    for (const value of Object.values(ALERT_THRESHOLDS)) expect(Number.isFinite(value)).toBe(true);
    for (const text of Object.values(en)) expect(text).not.toContain('5000');
  });
});
