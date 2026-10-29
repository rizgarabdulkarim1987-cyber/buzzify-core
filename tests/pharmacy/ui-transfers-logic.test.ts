import { describe, expect, it } from 'vitest';
import { closeStatus, checkReceive, needsLossApproval, planSend, TransferError, type SendBatch } from '@/server/domain/pharmacy/transfers';
import {
  actionFor,
  detailControls,
  draftSignature,
  emptyTransferDraft,
  endsOf,
  isOverridePicks,
  ladderText,
  mayAt,
  proposeSend,
  receiveBreakdown,
  receiveInputOf,
  receiveSignature,
  restOfLine,
  sendInputOf,
  sendSignature,
  statusChip,
  transferInputOf,
  tooManyLines,
  type ReceiveLineDraft,
  type SendStockBatch,
  type TransferDraft,
  type TransferLineDraft,
} from '@/app/pharmacy/_ui/transfers-logic';
import { attemptKeyFor } from '@/app/pharmacy/_ui/purchasing-logic';

const units = [
  { id: 'u0', label: 'Tablet', baseQty: 1 },
  { id: 'u1', label: 'Strip', baseQty: 10 },
  { id: 'u2', label: 'Box', baseQty: 30 },
];
const line = (patch: Partial<TransferLineDraft> = {}): TransferLineDraft => ({ key: 'a', productId: 'p1', productName: 'Paracetamol', productMeta: '500 mg', units, unitId: 'u0', qty: '30', ...patch });
const draft = (patch: Partial<TransferDraft> = {}): TransferDraft => ({ ...emptyTransferDraft('tr-key-1', 'send', 'b1', 'b2'), lines: [line()], ...patch });
const reach = { allBranches: false, branchIds: ['b1'] };

describe('ends of a transfer', () => {
  it('the person sends from their own branch, or asks for stock into it', () => {
    expect(endsOf(draft({ mode: 'send', mineId: 'b1', otherId: 'b2' }))).toEqual({ fromBranchId: 'b1', toBranchId: 'b2' });
    expect(endsOf(draft({ mode: 'request', mineId: 'b1', otherId: 'b2' }))).toEqual({ fromBranchId: 'b2', toBranchId: 'b1' });
  });
});

describe('transferInputOf', () => {
  it('turns typed units into whole base units with the ends in order', () => {
    const built = transferInputOf(draft({ lines: [line({ unitId: 'u2', qty: '2' })] }), reach, 'create');
    expect(built.problems).toEqual({});
    expect(built.input).toEqual({ fromBranchId: 'b1', toBranchId: 'b2', note: '', lines: [{ productId: 'p1', qty: 60 }] });
  });
  it('an update sends only the note and the lines', () => {
    const built = transferInputOf(draft({ note: 'urgent' }), reach, 'update');
    expect(built.input).toEqual({ note: 'urgent', lines: [{ productId: 'p1', qty: 30 }] });
  });
  it('refuses the same branch at both ends', () => {
    const built = transferInputOf(draft({ otherId: 'b1' }), reach, 'create');
    expect(built.input).toBeUndefined();
    expect(built.problems.branches).toBe('same');
  });
  it('refuses a missing end', () => {
    expect(transferInputOf(draft({ otherId: '' }), reach, 'create').problems.branches).toBe('missing');
  });
  it('refuses a branch of mine that is not mine', () => {
    expect(transferInputOf(draft({ mineId: 'b9' }), reach, 'create').problems.branches).toBe('notMine');
    expect(transferInputOf(draft({ mineId: 'b9' }), { allBranches: true, branchIds: [] }, 'create').problems.branches).toBeUndefined();
  });
  it('flags a quantity that is not a whole number of at least one, per line', () => {
    const built = transferInputOf(draft({ lines: [line({ qty: '' }), line({ key: 'b', productId: 'p2', qty: '2.5' }), line({ key: 'c', productId: 'p3', qty: '0' }), line({ key: 'd', productId: 'p4', qty: '3' })] }), reach, 'create');
    expect(built.problems).toMatchObject({ 'lines.0.qty': 'qty', 'lines.1.qty': 'qty', 'lines.2.qty': 'qty' });
    expect(built.problems['lines.3.qty']).toBeUndefined();
  });
  it('reads Arabic-Indic digits', () => {
    expect(transferInputOf(draft({ lines: [line({ qty: '٢٥' })] }), reach, 'create').input?.lines).toEqual([{ productId: 'p1', qty: 25 }]);
  });
  it('flags a product that is on two lines, no lines, and more than 100', () => {
    expect(transferInputOf(draft({ lines: [line(), line({ key: 'b' })] }), reach, 'create').problems['lines.1.productId']).toBe('duplicate');
    expect(transferInputOf(draft({ lines: [] }), reach, 'create').problems.lines).toBe('none');
    const many = Array.from({ length: 101 }, (_, i) => line({ key: `k${i}`, productId: `p${i}` }));
    expect(transferInputOf(draft({ lines: many }), reach, 'create').problems.lines).toBe('tooMany');
    expect(tooManyLines(many.length)).toBe(true);
    expect(tooManyLines(100)).toBe(false);
  });
  it('flags a quantity beyond what the server accepts', () => {
    expect(transferInputOf(draft({ lines: [line({ units: [...units, { id: 'u3', label: 'Pallet', baseQty: 1000 }], unitId: 'u3', qty: '9999999' })] }), reach, 'create').problems['lines.0.qty']).toBe('big');
  });
});

describe('attempt keys follow the payload', () => {
  it('reuses the key while the request is the same and makes a new one when it changed', () => {
    const d = draft();
    const sig = draftSignature(d);
    const first = attemptKeyFor(d, sig, 'tr', () => 'k-new-1');
    expect(first.clientKey).not.toBe('tr-key-1');
    const again = attemptKeyFor({ ...d, ...first }, sig, 'tr', () => 'k-new-2');
    expect(again.clientKey).toBe(first.clientKey);
    const changed = attemptKeyFor({ ...d, ...first }, draftSignature(draft({ note: 'x' })), 'tr', () => 'k-new-3');
    expect(changed.clientKey).toBe('k-new-3');
  });
  it('the signature ignores line keys and product names but not quantities', () => {
    expect(draftSignature(draft({ lines: [line({ key: 'zzz', productName: 'Other' })] }))).toBe(draftSignature(draft()));
    expect(draftSignature(draft({ lines: [line({ qty: '31' })] }))).not.toBe(draftSignature(draft()));
  });
});

describe('ladderText', () => {
  it('writes a base quantity as the largest units first', () => {
    expect(ladderText(units, 75)).toBe('2 Box + 1 Strip + 5 Tablet');
    expect(ladderText(units, 30)).toBe('1 Box');
    expect(ladderText(units, 7)).toBe('7 Tablet');
    expect(ladderText(units, 0)).toBe('0 Tablet');
  });
  it('falls back to the number alone when there is no ladder', () => {
    expect(ladderText([], 12)).toBe('12');
  });
});

describe('who can do what', () => {
  it('mayAt: an all-branches person reaches every branch, others only their own', () => {
    expect(mayAt({ allBranches: true, branchIds: [] }, 'b7')).toBe(true);
    expect(mayAt(reach, 'b1')).toBe(true);
    expect(mayAt(reach, 'b2')).toBe(false);
  });
  it('actionFor: a requested transfer waits for its sender, a sent one for its receiver', () => {
    expect(actionFor({ status: 'REQUESTED', fromBranchId: 'b1', toBranchId: 'b2' }, reach)).toBe('send');
    expect(actionFor({ status: 'REQUESTED', fromBranchId: 'b2', toBranchId: 'b1' }, reach)).toBeNull();
    expect(actionFor({ status: 'SENT', fromBranchId: 'b2', toBranchId: 'b1' }, reach)).toBe('receive');
    expect(actionFor({ status: 'SENT', fromBranchId: 'b1', toBranchId: 'b2' }, reach)).toBeNull();
    expect(actionFor({ status: 'RECEIVED', fromBranchId: 'b1', toBranchId: 'b1' }, reach)).toBeNull();
  });
  const t = (status: 'REQUESTED' | 'SENT' | 'RECEIVED' | 'PARTIAL' | 'CANCELLED', from = 'b1', to = 'b2') => ({ status, fromBranchId: from, toBranchId: to });
  const base = { reach, writable: true, placeBranchId: 'b1' as string | null, perms: { override: true, reportView: true } };
  it('requested: either end edits and cancels, only the sender sends, and only from a place that sees its stock', () => {
    expect(detailControls(t('REQUESTED'), base)).toMatchObject({ edit: true, cancel: true, send: 'yes', receive: 'no' });
    expect(detailControls(t('REQUESTED', 'b2', 'b1'), base)).toMatchObject({ edit: true, cancel: true, send: 'no' });
    expect(detailControls(t('REQUESTED'), { ...base, placeBranchId: 'b2' }).send).toBe('wrongPlace');
    expect(detailControls(t('REQUESTED'), { ...base, placeBranchId: null }).send).toBe('yes');
    expect(detailControls(t('REQUESTED', 'b2', 'b3'), { ...base, reach: { allBranches: false, branchIds: ['b9'] } })).toMatchObject({ edit: false, cancel: false, send: 'no' });
  });
  it('sent: only the receiver receives, and a sent transfer is never cancelled or edited', () => {
    expect(detailControls(t('SENT', 'b2', 'b1'), base)).toMatchObject({ receive: 'yes', cancel: false, edit: false, send: 'no' });
    expect(detailControls(t('SENT'), base).receive).toBe('no');
  });
  it('a read-only pharmacy or a role without the permission changes nothing but still reads', () => {
    expect(detailControls(t('REQUESTED'), { ...base, writable: false })).toMatchObject({ edit: false, cancel: false, send: 'no', blocked: true });
    expect(detailControls(t('SENT', 'b2', 'b1'), { ...base, writable: false })).toMatchObject({ receive: 'no', blocked: true });
  });
  it('closed transfers have no controls', () => {
    for (const s of ['RECEIVED', 'PARTIAL', 'CANCELLED'] as const) expect(detailControls(t(s), base)).toMatchObject({ edit: false, cancel: false, send: 'no', receive: 'no' });
  });
});

describe('statusChip', () => {
  it('every status has a word key and an icon', () => {
    for (const s of ['REQUESTED', 'SENT', 'RECEIVED', 'PARTIAL', 'CANCELLED'] as const) {
      const chip = statusChip(s);
      expect(chip.key).toBe(`pharmacy.transfers.status.${s}`);
      expect(chip.icon).toBeTruthy();
    }
    expect(new Set(['REQUESTED', 'SENT', 'RECEIVED', 'PARTIAL', 'CANCELLED'].map((s) => statusChip(s as 'SENT').icon)).size).toBe(5);
  });
});

// Sending -------------------------------------------------------------------------------------------------------------

const batch = (id: string, expiryDate: string, available: number, patch: Partial<SendStockBatch> = {}): SendStockBatch => ({
  batchId: id,
  productId: 'p1',
  lot: id.toUpperCase(),
  expiryDate,
  expiryPrecision: 'MONTH',
  status: 'ACTIVE',
  available,
  ...patch,
});
const TODAY = '2026-10-31';
const stock = [batch('a', '2027-01-31', 18), batch('b', '2027-06-30', 40), batch('c', '2026-09-30', 9), batch('d', '2028-01-31', 50, { status: 'RECALLED' })];

describe('proposeSend', () => {
  it('takes FEFO from sendable batches and skips expired and recalled ones', () => {
    const out = proposeSend([{ lineId: 'l1', productId: 'p1', requestedQty: 30 }], stock, TODAY);
    expect(out).toEqual([{ lineId: 'l1', productId: 'p1', requestedQty: 30, availableQty: 58, short: false, rows: [{ batchId: 'a', qty: 18 }, { batchId: 'b', qty: 12 }] }]);
  });
  it('a short product is proposed in full from what exists and flagged short', () => {
    const out = proposeSend([{ lineId: 'l1', productId: 'p1', requestedQty: 100 }], stock, TODAY);
    expect(out[0]).toMatchObject({ short: true, availableQty: 58 });
    expect(out[0]!.rows).toEqual([{ batchId: 'a', qty: 18 }, { batchId: 'b', qty: 40 }]);
  });
  it('a product with nothing sendable has no rows', () => {
    const out = proposeSend([{ lineId: 'l1', productId: 'p1', requestedQty: 5 }], [stock[2]!, stock[3]!], TODAY);
    expect(out[0]).toMatchObject({ rows: [], short: true, availableQty: 0 });
  });
  it('agrees with the server rules on a table of cases', () => {
    const cases: [number, SendStockBatch[]][] = [
      [30, stock],
      [18, stock],
      [19, stock],
      [58, stock],
      [1, stock],
      [10, [batch('x', '2027-01-31', 5), batch('y', '2027-01-31', 9)]],
    ];
    for (const [asked, batches] of cases) {
      const ui = proposeSend([{ lineId: 'l1', productId: 'p1', requestedQty: asked }], batches, TODAY)[0]!;
      const domain = planSend({ lines: [{ lineId: 'l1', productId: 'p1', requestedQty: asked }], batches: batches.map(toDomain), today: TODAY });
      expect(ui.rows.map((r) => [r.batchId, r.qty])).toEqual(domain.allocations.map((a) => [a.batchId, a.qty]));
      expect(ui.short).toBe(false);
    }
    expect(() => planSend({ lines: [{ lineId: 'l1', productId: 'p1', requestedQty: 100 }], batches: stock.map(toDomain), today: TODAY })).toThrow(TransferError);
  });
});

function toDomain(b: SendStockBatch): SendBatch {
  return { id: b.batchId, productId: b.productId, lot: b.lot, expiryDate: b.expiryDate, expiryPrecision: b.expiryPrecision, status: b.status, available: b.available };
}

describe('isOverridePicks (the same call as the server)', () => {
  it('matches planSend on picks that follow FEFO, skip it, or split a batch', () => {
    const cases: [string, { batchId: string; qty: number }[]][] = [
      ['fefo', [{ batchId: 'a', qty: 18 }, { batchId: 'b', qty: 12 }]],
      ['later batch only', [{ batchId: 'b', qty: 30 }]],
      ['less than fefo from the first', [{ batchId: 'a', qty: 10 }, { batchId: 'b', qty: 12 }]],
      ['first only', [{ batchId: 'a', qty: 10 }]],
      ['all of first and nothing more', [{ batchId: 'a', qty: 18 }]],
      ['zero rows', [{ batchId: 'a', qty: 0 }, { batchId: 'b', qty: 0 }]],
    ];
    for (const [name, rows] of cases) {
      const picks = rows.map((r) => ({ lineId: 'l1', ...r }));
      const total = rows.reduce((s, r) => s + r.qty, 0);
      if (total === 0) continue;
      const domain = planSend({ lines: [{ lineId: 'l1', productId: 'p1', requestedQty: 30 }], batches: stock.map(toDomain), picks, today: TODAY });
      expect(isOverridePicks(rows, stock, TODAY), name).toBe(domain.override);
    }
  });
  it('batches that expire the same day are no override', () => {
    const tie = [batch('x', '2027-01-31', 5), batch('y', '2027-01-31', 9)];
    expect(isOverridePicks([{ batchId: 'y', qty: 4 }], tie, TODAY)).toBe(false);
  });
});

describe('sendInputOf', () => {
  const proposal = proposeSend([{ lineId: 'l1', productId: 'p1', requestedQty: 30 }], stock, TODAY);
  it('sends every row with its quantity as explicit picks', () => {
    const out = sendInputOf({ transferId: 't1', version: 4, proposal, edits: {}, stock, today: TODAY, canOverride: false });
    expect(out.problems).toEqual({});
    expect(out.input).toEqual({ transferId: 't1', version: 4, picks: [{ lineId: 'l1', batchId: 'a', qty: 18 }, { lineId: 'l1', batchId: 'b', qty: 12 }] });
  });
  it('an edit lowers a row, never above the batch or the request', () => {
    const out = sendInputOf({ transferId: 't1', version: 4, proposal, edits: { 'l1|b': '5' }, stock, today: TODAY, canOverride: false });
    expect(out.input?.picks).toEqual([{ lineId: 'l1', batchId: 'a', qty: 18 }, { lineId: 'l1', batchId: 'b', qty: 5 }]);
    const over = sendInputOf({ transferId: 't1', version: 4, proposal, edits: { 'l1|a': '99' }, stock, today: TODAY, canOverride: false });
    expect(over.problems['l1|a']).toBe('overBatch');
    const overLine = sendInputOf({ transferId: 't1', version: 4, proposal, edits: { 'l1|b': '40' }, stock, today: TODAY, canOverride: false });
    expect(overLine.problems.l1).toBe('overRequested');
    const bad = sendInputOf({ transferId: 't1', version: 4, proposal, edits: { 'l1|a': 'x' }, stock, today: TODAY, canOverride: false });
    expect(bad.problems['l1|a']).toBe('qty');
  });
  it('lowering an earlier batch while a later one is used is out of order and needs the override', () => {
    const edits = { 'l1|a': '10' };
    const no = sendInputOf({ transferId: 't1', version: 4, proposal, edits, stock, today: TODAY, canOverride: false });
    expect(no.input).toBeUndefined();
    expect(no.problems.override).toBe('needed');
    expect(no.overridden).toBe(true);
    const yes = sendInputOf({ transferId: 't1', version: 4, proposal, edits, stock, today: TODAY, canOverride: true });
    expect(yes.input?.picks).toBeDefined();
    expect(yes.overridden).toBe(true);
  });
  it('sending nothing at all is refused, and a fully zeroed line keeps one zero pick so it is not filled FEFO', () => {
    const none = sendInputOf({ transferId: 't1', version: 4, proposal, edits: { 'l1|a': '0', 'l1|b': '0' }, stock, today: TODAY, canOverride: true });
    expect(none.problems.nothing).toBe('nothing');
    const two = proposeSend([{ lineId: 'l1', productId: 'p1', requestedQty: 30 }, { lineId: 'l2', productId: 'p2', requestedQty: 5 }], [...stock, batch('z', '2027-03-31', 9, { productId: 'p2' })], TODAY);
    const out = sendInputOf({ transferId: 't1', version: 4, proposal: two, edits: { 'l2|z': '0' }, stock: [...stock, batch('z', '2027-03-31', 9, { productId: 'p2' })], today: TODAY, canOverride: false });
    expect(out.input?.picks).toContainEqual({ lineId: 'l2', batchId: 'z', qty: 0 });
  });
  it('a line with no sendable batch blocks the send with its own problem', () => {
    const empty = proposeSend([{ lineId: 'l1', productId: 'p1', requestedQty: 5 }], [stock[3]!], TODAY);
    const out = sendInputOf({ transferId: 't1', version: 4, proposal: empty, edits: {}, stock: [stock[3]!], today: TODAY, canOverride: true });
    expect(out.problems.l1).toBe('noStock');
    expect(out.input).toBeUndefined();
  });
  it('the send signature changes with the picks, not with the version', () => {
    const a = sendSignature('t1', [{ lineId: 'l1', batchId: 'a', qty: 18 }]);
    expect(sendSignature('t1', [{ lineId: 'l1', batchId: 'a', qty: 18 }])).toBe(a);
    expect(sendSignature('t1', [{ lineId: 'l1', batchId: 'a', qty: 17 }])).not.toBe(a);
  });
});

// Receiving -----------------------------------------------------------------------------------------------------------

const rl = (patch: Partial<ReceiveLineDraft> = {}): ReceiveLineDraft => ({ lineId: 'l1', sentQty: 18, received: '18', damaged: '0', lost: '0', lostReason: '', quarantine: false, ...patch });

describe('receiveBreakdown: where each unit goes', () => {
  it('everything received goes to available', () => {
    expect(receiveBreakdown(rl(), false)).toMatchObject({ ok: true, unaccounted: 0, goes: { available: 18, quarantine: 0, damaged: 0, lost: 0 } });
  });
  it('the quarantine toggle, or an expired batch, sends the received units to quarantine', () => {
    expect(receiveBreakdown(rl({ quarantine: true }), false).goes).toEqual({ available: 0, quarantine: 18, damaged: 0, lost: 0 });
    expect(receiveBreakdown(rl(), true).goes).toEqual({ available: 0, quarantine: 18, damaged: 0, lost: 0 });
  });
  it('25 received and 5 lost of 30 leaves nothing unaccounted and needs a reason', () => {
    const r = receiveBreakdown(rl({ sentQty: 30, received: '25', lost: '5' }), false);
    expect(r).toMatchObject({ unaccounted: 0, goes: { available: 25, lost: 5 }, needsReason: true, ok: false });
    expect(receiveBreakdown(rl({ sentQty: 30, received: '25', lost: '5', lostReason: 'LOST' }), false).ok).toBe(true);
  });
  it('states the shortfall while units are not yet placed, and the excess', () => {
    expect(receiveBreakdown(rl({ received: '10' }), false)).toMatchObject({ unaccounted: 8, ok: false, goes: { available: 10 } });
    expect(receiveBreakdown(rl({ received: '20' }), false)).toMatchObject({ unaccounted: -2, ok: false });
  });
  it('a typo is not a number', () => {
    expect(receiveBreakdown(rl({ received: '1x' }), false)).toMatchObject({ ok: false, invalid: true });
    expect(receiveBreakdown(rl({ damaged: '' }), false).goes.damaged).toBe(0);
  });
  it('restOfLine puts the missing units in lost', () => {
    expect(restOfLine(rl({ received: '10' }))).toMatchObject({ lost: '8', lostReason: 'LOST', received: '10' });
    expect(restOfLine(rl())).toMatchObject({ lost: '0' });
  });
  it('agrees with the server rules on a table of cases (checkReceive, closeStatus, needsLossApproval)', () => {
    const table: { sent: number; r: number; d: number; l: number; reason?: 'LOST' | 'OTHER'; code?: string }[] = [
      { sent: 30, r: 30, d: 0, l: 0 },
      { sent: 30, r: 25, d: 0, l: 5, reason: 'LOST' },
      { sent: 30, r: 25, d: 0, l: 5, code: 'REASON_REQUIRED' },
      { sent: 30, r: 20, d: 10, l: 0 },
      { sent: 30, r: 0, d: 0, l: 30, reason: 'OTHER' },
      { sent: 30, r: 29, d: 0, l: 0, code: 'UNACCOUNTED' },
      { sent: 30, r: 31, d: 0, l: 0, code: 'OVER_SENT' },
      { sent: 30, r: 20, d: 10, l: 5, code: 'OVER_SENT' },
      { sent: 1, r: 0, d: 1, l: 0 },
      { sent: 500, r: 0, d: 0, l: 0, code: 'UNACCOUNTED' },
    ];
    for (const c of table) {
      const line = rl({ sentQty: c.sent, received: String(c.r), damaged: String(c.d), lost: String(c.l), lostReason: c.reason ?? '' });
      const ui = receiveBreakdown(line, false);
      let serverCode: string | null = null;
      try {
        checkReceive([{ lineId: 'l1', sentQty: c.sent, receivedQty: c.r, damagedQty: c.d, lostQty: c.l, lostReason: c.reason ?? null, quarantine: false }]);
      } catch (error) {
        serverCode = (error as TransferError).code;
      }
      expect(serverCode, JSON.stringify(c)).toBe(c.code ?? null);
      expect(ui.ok, JSON.stringify(c)).toBe(serverCode === null);
      if (serverCode === 'UNACCOUNTED') expect(ui.unaccounted).toBeGreaterThan(0);
      if (serverCode === 'OVER_SENT') expect(ui.unaccounted).toBeLessThan(0);
      if (serverCode === 'REASON_REQUIRED') expect(ui.needsReason).toBe(true);
      if (!serverCode) {
        const counted = { sentQty: c.sent, receivedQty: c.r, damagedQty: c.d, lostQty: c.l };
        const result = receiveInputOf({ transferId: 't1', version: 2, clientKey: 'k', lines: [line] });
        expect(result.status).toBe(closeStatus([counted]));
        expect(result.needsReportView).toBe(needsLossApproval([counted]));
      }
    }
  });
});

describe('receiveInputOf', () => {
  it('sends one entry per sent line with whole numbers and the reason only when something was lost', () => {
    const out = receiveInputOf({
      transferId: 't1',
      version: 3,
      clientKey: 'tr-recv-1',
      lines: [rl({ lineId: 'l1', sentQty: 18, received: '18', lostReason: 'LOST' }), rl({ lineId: 'l2', sentQty: 12, received: '7', lost: '5', lostReason: 'LOST', quarantine: true })],
    });
    expect(out.problems).toEqual({});
    expect(out.input).toEqual({
      transferId: 't1',
      version: 3,
      clientKey: 'tr-recv-1',
      lines: [
        { lineId: 'l1', receivedQty: 18, damagedQty: 0, lostQty: 0, quarantine: false },
        { lineId: 'l2', receivedQty: 7, damagedQty: 0, lostQty: 5, lostReason: 'LOST', quarantine: true },
      ],
    });
    expect(out.status).toBe('PARTIAL');
    expect(out.needsReportView).toBe(true);
  });
  it('names the line that is not right', () => {
    const out = receiveInputOf({ transferId: 't1', version: 3, clientKey: 'k', lines: [rl(), rl({ lineId: 'l2', received: '3' })] });
    expect(out.input).toBeUndefined();
    expect(out.problems).toEqual({ l2: 'unaccounted' });
  });
  it('the receive signature changes with any figure', () => {
    const a = receiveSignature('t1', [rl()]);
    expect(receiveSignature('t1', [rl()])).toBe(a);
    expect(receiveSignature('t1', [rl({ quarantine: true })])).not.toBe(a);
    expect(receiveSignature('t1', [rl({ received: '17', damaged: '1' })])).not.toBe(a);
  });
});
