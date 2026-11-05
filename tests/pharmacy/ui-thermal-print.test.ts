import { describe, expect, it, vi } from 'vitest';
import { draftOfPrinter, openThermalDrawer, printerOf, printerOfDraft, printThermal, thermalDrawerPlan } from '@/app/pharmacy/_ui/thermal-print';
import { buildReceipt, type StoredSale } from '@/server/domain/pharmacy/receipt';
import { DEFAULT_WORKSTATION, type WorkstationSettings } from '@/server/domain/pharmacy/print-settings';

const sale: StoredSale = {
  number: 'S-1', currency: 'IQD', at: new Date('2026-10-28T14:03:09.000Z'), subtotalMinor: 500n, discountMinor: 0n, roundingMinor: 0n, totalMinor: 500n, paidMinor: 1000n, changeMinor: 500n, cashierName: 'Sara',
  lines: [{ lineNo: 1, name: 'Panadol', strength: '500 mg', qty: 1, unitLabel: 'strip', unitPriceMinor: 500n, discountMinor: 0n, totalMinor: 500n, rxLevel: 'OTC' }],
  payments: [{ method: 'CASH', amountMinor: 1000n }],
};
const receipt = (over: Partial<StoredSale> = {}, copy = false) => buildReceipt({ kind: 'sale', sale: { ...sale, ...over } }, { width: '80', locale: 'en', copy, shop: { name: 'Shop' } });
const ws = (over: Partial<NonNullable<WorkstationSettings['receiptPrinter']>> | null = {}): WorkstationSettings => ({
  ...DEFAULT_WORKSTATION,
  ...(over === null ? {} : { receiptPrinter: { transport: 'NETWORK', address: '10.0.0.5:9100', paperWidth: 80, cut: true, drawerPin: 2, drawerOnCash: true, ...over } }),
});
const render = vi.fn(() => ({ rgba: new Uint8ClampedArray(16 * 8 * 4).fill(255), width: 16, height: 8 }));
function fakeFetch(ok = true) {
  const calls: { url: string; target: string; bytes: number[] }[] = [];
  const impl = (async (url: string, init: { body: string }) => {
    if (!ok) throw new Error('refused');
    const body = JSON.parse(init.body) as { target: string; dataBase64: string };
    calls.push({ url, target: body.target, bytes: [...Buffer.from(body.dataBase64, 'base64')] });
    return { ok: true, status: 200, json: async () => ({}) };
  }) as unknown as typeof fetch;
  return { impl, calls };
}
const KICK = [0x1b, 0x70, 0x00, 0x3c, 0x78];
const has = (bytes: number[], seq: number[]) => bytes.some((_, i) => seq.every((b, j) => bytes[i + j] === b));
const run = (m: ReturnType<typeof receipt>, w: WorkstationSettings, f = fakeFetch()) => printThermal(m, w, { fetchImpl: f.impl, render, bridgeUrl: 'http://127.0.0.1:9101', dir: 'ltr' }).then((result) => ({ result, ...f }));

describe('printerOf', () => {
  it('is null without a configured printer or with an empty address', () => {
    expect(printerOf(ws(null))).toBeNull();
    expect(printerOf(ws({ address: '' }))).toBeNull();
  });
  it('maps the settings to a receipt printer', () => {
    expect(printerOf(ws())).toMatchObject({ role: 'RECEIPT', transport: 'NETWORK', address: '10.0.0.5:9100', paperWidth: 80, cut: true, drawerPin: 2 });
  });
});

describe('printThermal', () => {
  it('prints a cash sale through the bridge and kicks the drawer', async () => {
    const { result, calls } = await run(receipt(), ws());
    expect(result).toEqual({ ok: true });
    expect(calls[0].url).toBe('http://127.0.0.1:9101/print');
    expect(calls[0].target).toBe('tcp://10.0.0.5:9100');
    expect(has(calls[0].bytes, KICK)).toBe(true);
  });
  it.each([
    ['a copy', receipt({}, true), ws()],
    ['a credit-only sale', receipt({ payments: [{ method: 'CREDIT', amountMinor: 500n }] }), ws()],
    ['drawer-on-cash turned off', receipt(), ws({ drawerOnCash: false })],
    ['a printer with no drawer pin', receipt(), ws({ drawerPin: null })],
  ])('does not kick the drawer for %s', async (_name, m, w) => {
    const { result, calls } = await run(m, w);
    expect(result).toEqual({ ok: true });
    expect(has(calls[0].bytes, KICK)).toBe(false);
  });
  it('says there is no thermal printer instead of failing', async () => {
    const { result, calls } = await run(receipt(), ws(null));
    expect(result).toEqual({ ok: false, reason: 'none', message: 'no receipt printer' });
    expect(calls).toHaveLength(0);
  });
  it('turns a dead bridge into a result and never throws', async () => {
    const { result } = await run(receipt(), ws(), fakeFetch(false));
    expect(result).toMatchObject({ ok: false, reason: 'bridge' });
  });
});

describe('thermalDrawerPlan', () => {
  it('opens only for an original cash sale on a printer that has the drawer on', () => {
    expect(thermalDrawerPlan(receipt(), ws())).toBe(true);
    expect(thermalDrawerPlan(receipt({}, true), ws())).toBe(false);
    expect(thermalDrawerPlan(receipt(), ws(null))).toBe(false);
  });
});

describe('openThermalDrawer', () => {
  it('sends the kick with no paper, and refuses when the printer has no drawer', async () => {
    const f = fakeFetch();
    expect(await openThermalDrawer(ws(), { fetchImpl: f.impl, bridgeUrl: 'http://127.0.0.1:9101' })).toEqual({ ok: true });
    expect(f.calls[0].bytes).toEqual(KICK);
    expect(await openThermalDrawer(ws({ drawerPin: null }), { fetchImpl: f.impl })).toMatchObject({ ok: false });
  });
});

describe('printer draft of the settings form', () => {
  it('starts from the defaults, with an empty address, when the workstation has no printer', () => {
    expect(draftOfPrinter(undefined)).toEqual({ transport: 'NETWORK', address: '', paperWidth: '80', cut: true, drawerPin: '2', drawerOnCash: true });
  });
  it('an empty address means "no thermal printer": the key is left out', () => {
    expect(printerOfDraft({ ...draftOfPrinter(undefined) })).toEqual({ ok: true, value: undefined });
  });
  it('a good address becomes the stored printer, numbers and nulls included', () => {
    const draft = { ...draftOfPrinter(undefined), address: ' 192.168.1.50:9100 ', paperWidth: '58' as const, drawerPin: 'none' as const };
    expect(printerOfDraft(draft)).toEqual({ ok: true, value: { transport: 'NETWORK', address: '192.168.1.50:9100', paperWidth: 58, cut: true, drawerPin: null, drawerOnCash: true } });
  });
  it('a bad address is refused', () => {
    expect(printerOfDraft({ ...draftOfPrinter(undefined), address: '8.8.8.8:9100' })).toEqual({ ok: false });
  });
  it('a printer shared on this PC is typed as its share name only', () => {
    const draft = { ...draftOfPrinter(undefined), transport: 'FILE' as const, address: 'XP80' };
    const out = printerOfDraft(draft);
    expect(out).toMatchObject({ ok: true, value: { transport: 'FILE', address: String.raw`\\localhost\XP80` } });
    expect(draftOfPrinter(out.ok ? out.value : undefined).address).toBe('XP80');
  });
  it('round-trips a stored printer', () => {
    const stored = ws().receiptPrinter;
    expect(printerOfDraft(draftOfPrinter(stored))).toEqual({ ok: true, value: stored });
  });
});
