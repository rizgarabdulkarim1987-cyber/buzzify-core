import { describe, expect, it } from 'vitest';
import { DEFAULT_QR_STYLE, parseQrStyle, qrStyleProblem, qrTargetUrl } from '@/server/domain/qr';

describe('qrTargetUrl', () => {
  it('opens the menu, or the table, and names the code', () => {
    expect(qrTargetUrl('https://menu.buzzify.me', 'atelier', { id: 'qr1', tableNumber: null })).toBe('https://menu.buzzify.me/atelier?qr=qr1');
    expect(qrTargetUrl('https://menu.buzzify.me', 'atelier', { id: 'qr2', tableNumber: 12 })).toBe('https://menu.buzzify.me/atelier/t/12?qr=qr2');
  });
});

describe('QR styles', () => {
  it('reads a stored style, with the defaults for what is missing or wrong', () => {
    expect(parseQrStyle({})).toEqual(DEFAULT_QR_STYLE);
    expect(parseQrStyle(null)).toEqual({ foreground: '#000000', background: '#FFFFFF', logo: false, frameText: '' });
    expect(parseQrStyle({ foreground: '#1B1A19', logo: true, frameText: 'Menu', background: 'red' })).toEqual({
      foreground: '#1B1A19',
      background: '#FFFFFF',
      logo: true,
      frameText: 'Menu',
    });
  });

  it('refuses a code that scanners may not read', () => {
    expect(qrStyleProblem(DEFAULT_QR_STYLE)).toBeNull();
    expect(qrStyleProblem({ ...DEFAULT_QR_STYLE, foreground: '#777777' })).toBe('LOW_CONTRAST');
    expect(qrStyleProblem({ ...DEFAULT_QR_STYLE, foreground: '#FFFFFF', background: '#000000' })).toBe('INVERTED');
    expect(qrStyleProblem({ ...DEFAULT_QR_STYLE, frameText: 'x'.repeat(41) })).toBe('FRAME_TOO_LONG');
    expect(qrStyleProblem({ ...DEFAULT_QR_STYLE, frameText: 'x'.repeat(40) })).toBeNull();
  });
});
