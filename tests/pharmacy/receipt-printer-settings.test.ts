import { describe, expect, it } from 'vitest';
import { DEFAULT_WORKSTATION, workstationSettings } from '@/server/domain/pharmacy/print-settings';

const printer = { transport: 'NETWORK', address: '192.168.1.50:9100', paperWidth: 80, cut: true, drawerPin: 2, drawerOnCash: true } as const;
const parse = (receiptPrinter: unknown) => workstationSettings.safeParse({ ...DEFAULT_WORKSTATION, receiptPrinter });

describe('receipt printer settings', () => {
  it('still accepts settings saved before the printer existed', () => {
    expect(workstationSettings.safeParse(DEFAULT_WORKSTATION).success).toBe(true);
  });
  it('accepts a network printer on a private address', () => {
    expect(parse(printer).success).toBe(true);
  });
  it('accepts a printer shared on this PC', () => {
    expect(parse({ ...printer, transport: 'FILE', address: String.raw`\\localhost\XP80`, drawerPin: null }).success).toBe(true);
  });
  it('refuses an address that is not a printer', () => {
    expect(parse({ ...printer, address: '8.8.8.8:9100' }).success).toBe(false);
    expect(parse({ ...printer, transport: 'FILE', address: String.raw`C:\Windows` }).success).toBe(false);
  });
  it('refuses unknown keys and odd paper', () => {
    expect(parse({ ...printer, extra: 1 }).success).toBe(false);
    expect(parse({ ...printer, paperWidth: 70 }).success).toBe(false);
  });
});
