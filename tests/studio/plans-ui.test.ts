import { describe, expect, it } from 'vitest';
import { getStudioTranslator } from '@/studio/messages';
import { upgradeLink, upgradeMessage } from '@/studio/plans/whatsapp';

const INFO = {
  restaurantId: 'r1',
  restaurantName: 'Zhamitos',
  whatsapp: '9647501234567',
  isOwner: false,
  planNames: { BASIC: 'Basic', PRO: 'Pro', PREMIUM: 'Premium' },
  allowed: [],
  lowest: { 'qr.branded': 'PRO' as const },
  planTabHref: '/studio/restaurants/r1/plan',
};

describe('the upgrade link', () => {
  it('opens a WhatsApp chat with the number and the message encoded', () => {
    expect(upgradeLink('9647501234567', 'Hi & bye')).toBe('https://wa.me/9647501234567?text=Hi%20%26%20bye');
  });

  it('names the restaurant, the feature and the plan, in the reader’s language', () => {
    const en = getStudioTranslator('en');
    expect(upgradeMessage(en, INFO, 'qr.branded')).toBe('Hello, I’d like to add “QR codes in brand colours, with the logo” for Zhamitos. It’s in the Pro plan.');
    const ar = getStudioTranslator('ar');
    const arabic = upgradeMessage(ar, { ...INFO, planNames: { BASIC: 'الأساسية', PRO: 'الاحترافية', PREMIUM: 'المميزة' } }, 'qr.branded');
    expect(arabic).toContain('Zhamitos');
    expect(arabic).toContain('الاحترافية');
  });

  it('leaves the plan out when no plan includes the feature', () => {
    const en = getStudioTranslator('en');
    expect(upgradeMessage(en, { ...INFO, lowest: {} }, 'qr.branded')).toBe('Hello, I’d like to add “QR codes in brand colours, with the logo” for Zhamitos.');
  });
});
