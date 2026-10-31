import { describe, expect, it } from 'vitest';
import { whatsappDigits } from '@/server/domain/whatsapp';

describe('the WhatsApp number of a restaurant', () => {
  it('keeps the digits of an international number, with or without a plus or a 00 prefix', () => {
    expect(whatsappDigits('+964 750 123 4567')).toBe('9647501234567');
    expect(whatsappDigits('00964 750 123 4567')).toBe('9647501234567');
    expect(whatsappDigits('(964) 750-1234567')).toBe('9647501234567');
  });

  it('gives nothing for what cannot be a number', () => {
    expect(whatsappDigits('')).toBeNull();
    expect(whatsappDigits(null)).toBeNull();
    expect(whatsappDigits('call us')).toBeNull();
    expect(whatsappDigits('12345')).toBeNull();
    expect(whatsappDigits('1'.repeat(16))).toBeNull();
  });
});
