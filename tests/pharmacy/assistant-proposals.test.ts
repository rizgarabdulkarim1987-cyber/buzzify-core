import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as assistantActions from '@/server/pharmacy/actions/assistant';
import * as assistantQueries from '@/server/pharmacy/queries/assistant';
import { assistantWorld, type AssistantWorld } from './assistant-mock';
import { grant, NOW, person, pharmacy, prisma, resetWorld, useTestDatabase, type Person } from './fixture';
import { build, type Biz } from './reports-world';
import { act, ask, codeOf, dataOf, phCodeOf } from './stock-helpers';

/* eslint-disable @typescript-eslint/no-explicit-any -- results are read off the wire and checked by value */

/** The assistant's proposals (phase 7, task 4; R7-7): a suggestion that is stored, shown, accepted or dismissed, and that creates nothing. */

let w: AssistantWorld;
let u: Biz;

beforeAll(async () => {
  useTestDatabase();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  await resetWorld();
  w = await assistantWorld();
  u = await build('U', false);
}, 180_000);
afterAll(() => {
  vi.useRealTimers();
});

const place = (branchId?: string, restaurantId = w.a.id) => ({ restaurantId, ...(branchId ? { branchId } : {}) });
const transfer = (over: Record<string, unknown> = {}) => ({ kind: 'TRANSFER', fromBranchId: w.b2, toBranchId: w.b1, lines: [{ productId: w.P.id, qty: 1 }], ...over });
const reorder = (over: Record<string, unknown> = {}) => ({ kind: 'REORDER', lines: [{ productId: w.P.id, qty: 100 }], ...over });
const supplierReturn = (over: Record<string, unknown> = {}) => ({ kind: 'SUPPLIER_RETURN', lines: [{ productId: w.P.id, batchId: w.extra.x, qty: 2 }], ...over });
const create = (who: Person, proposal: unknown, branchId?: string, restaurantId = w.a.id) => act(who, assistantActions.proposalCreate, { ...place(branchId, restaurantId), proposal });
const accept = (who: Person, proposalId: string, branchId?: string) => act(who, assistantActions.proposalAccept, { ...place(branchId), proposalId });
const dismiss = (who: Person, proposalId: string, branchId?: string) => act(who, assistantActions.proposalDismiss, { ...place(branchId), proposalId });
const list = (who: Person, input: Record<string, unknown> = {}, restaurantId = w.a.id) => ask(who, assistantQueries.proposals, { restaurantId, ...input });
const counts = async () => ({
  transfers: await prisma().phTransfer.count({ where: { restaurantId: w.a.id } }),
  orders: await prisma().phPurchaseOrder.count({ where: { restaurantId: w.a.id } }),
  supplierReturns: await prisma().phSupplierReturn.count({ where: { restaurantId: w.a.id } }),
  receipts: await prisma().phReceipt.count({ where: { restaurantId: w.a.id } }),
  movements: await prisma().phStockMovement.count({ where: { restaurantId: w.a.id } }),
});

describe('making a proposal', () => {
  it('stores a transfer in the branch the goods leave, with ids and quantities only', async () => {
    const made = dataOf(await create(w.owner, transfer())) as any;
    expect(made).toMatchObject({ kind: 'TRANSFER', branchId: w.b2, lines: 1 });
    const row = await prisma().phAiProposal.findUniqueOrThrow({ where: { id: made.id } });
    expect(row).toMatchObject({ restaurantId: w.a.id, branchId: w.b2, kind: 'TRANSFER', status: 'PROPOSED', createdById: w.owner.userId, decidedAt: null });
    expect(row.payload).toEqual({ fromBranchId: w.b2, toBranchId: w.b1, lines: [{ productId: w.P.id, qty: 1 }] });
  });

  it('stores a reorder and a supplier return in the place’s branch, which they must name', async () => {
    const r = dataOf(await create(w.owner, reorder(), w.b1)) as any;
    expect(r).toMatchObject({ kind: 'REORDER', branchId: w.b1 });
    const s = dataOf(await create(w.owner, supplierReturn(), w.b2)) as any;
    expect(s).toMatchObject({ kind: 'SUPPLIER_RETURN', branchId: w.b2 });
    expect(codeOf(await create(w.owner, reorder()))).toBe('INVALID');
  });

  it('refuses anything but ids and quantities, and every id that is not the business’s own', async () => {
    expect(codeOf(await create(w.owner, transfer({ note: 'a free-text note' })))).toBe('INVALID');
    expect(codeOf(await create(w.owner, transfer({ lines: [{ productId: w.P.id, qty: 1, patientName: 'Layla' }] })))).toBe('INVALID');
    expect(codeOf(await create(w.owner, transfer({ lines: [{ productId: w.P.id, qty: 0 }] })))).toBe('INVALID');
    expect(codeOf(await create(w.owner, { kind: 'SELL', lines: [] }))).toBe('INVALID');
    expect(codeOf(await create(w.owner, transfer({ fromBranchId: w.b1, toBranchId: w.b1 })))).toBe('INVALID');
    expect(codeOf(await create(w.owner, transfer({ lines: [{ productId: u.P.id, qty: 1 }] })))).toBe('NOT_FOUND');
    expect(codeOf(await create(w.owner, transfer({ toBranchId: u.b1 })))).toBe('NOT_FOUND');
    expect(codeOf(await create(w.owner, supplierReturn({ lines: [{ productId: w.Q.id, batchId: w.extra.x, qty: 1 }] }), w.b2))).toBe('NOT_FOUND');
    expect(codeOf(await create(w.owner, supplierReturn({ lines: [{ productId: w.P.id, batchId: u.ids.pb1!, qty: 1 }] }), w.b2))).toBe('NOT_FOUND');
    expect(phCodeOf(await create(w.owner, transfer(), u.b1, u.a.id))).toBe('FORBIDDEN');
  });

  it('needs ai.use and the permission of the draft it hands over to', async () => {
    // Transfer: transfer.manage. Reorder / supplier return: purchase.manage.
    expect(codeOf(await create(w.cashier1, reorder(), w.b1))).toBe('FORBIDDEN');
    expect(codeOf(await create(w.stockP, reorder(), w.b1))).toBe('FORBIDDEN'); // no ai.use
    expect(codeOf(await create(w.accountant, reorder(), w.b1))).toBe('FORBIDDEN'); // no ai.use
    expect(codeOf(await create(w.pharmacist, reorder(), w.b1))).toBe('FORBIDDEN'); // ai.use, no purchase.manage
    expect(codeOf(await create(w.pic, reorder(), w.b1))).toBe('OK'); // ai.use + purchase.manage
    expect(codeOf(await create(w.pic, supplierReturn(), w.b2))).toBe('OK');
    expect(codeOf(await create(w.pic, transfer()))).toBe('FORBIDDEN'); // no transfer.manage
    expect(codeOf(await create(w.manager1, transfer({ fromBranchId: w.b1, toBranchId: w.b2 })))).toBe('OK');
    const support = await person('supportP', { superAdmin: true });
    await grant(support, w.a.id, { scopes: ['catalog.read', 'stock.read'] });
    expect(codeOf(await create(support, reorder(), w.b1))).toBe('FORBIDDEN');
  });

  it('keeps a person of branch 1 away from goods leaving branch 2', async () => {
    expect(codeOf(await create(w.manager1, transfer()))).toBe('FORBIDDEN');
    expect(codeOf(await create(w.manager1, reorder(), w.b2))).toBe('FORBIDDEN');
  });

  it('audits the kind, the branch and the number of lines, and nothing of the payload', async () => {
    const made = dataOf(await create(w.owner, transfer())) as any;
    const row = await prisma().auditLog.findFirstOrThrow({ where: { restaurantId: w.a.id, action: 'ph.assistant.proposal.create', entityId: made.id } });
    expect(row.changes).toEqual({ kind: { before: null, after: 'TRANSFER' }, branchId: { before: null, after: w.b2 }, lines: { before: null, after: 1 } });
    expect(JSON.stringify(row.changes)).not.toContain(w.P.id);
  });
});

describe('listing', () => {
  it('shows a person the proposals of their own branches, newest first, filtered by status', async () => {
    const all = dataOf(await list(w.owner)) as any[];
    expect(all.length).toBeGreaterThan(3);
    expect(all.map((p) => p.createdAt)).toEqual([...all.map((p) => p.createdAt)].sort().reverse());
    const mineOnly = dataOf(await list(w.manager1)) as any[];
    expect(mineOnly.length).toBeGreaterThan(0);
    expect(mineOnly.every((p) => p.branchId === w.b1)).toBe(true);
    expect(mineOnly.length).toBeLessThan(all.length);
    expect((dataOf(await list(w.owner, { status: 'ACCEPTED' })) as any[]).every((p) => p.status === 'ACCEPTED')).toBe(true);
  });

  it('is for ai.use holders only, and shows another business nothing of these', async () => {
    expect(codeOf(await list(w.cashier1))).toBe('FORBIDDEN');
    expect(codeOf(await list(w.stockP))).toBe('FORBIDDEN');
    expect(dataOf(await list(u.owner, {}, u.a.id))).toEqual([]);
    expect(codeOf(await list(u.owner, {}, w.a.id))).toBe('FORBIDDEN');
  });
});

describe('deciding', () => {
  it('dismisses a proposal once, and a decided proposal cannot be decided again', async () => {
    const made = dataOf(await create(w.owner, reorder(), w.b1)) as any;
    const done = dataOf(await dismiss(w.owner, made.id)) as any;
    expect(done).toMatchObject({ id: made.id, status: 'DISMISSED', kind: 'REORDER', branchId: w.b1 });
    const row = await prisma().phAiProposal.findUniqueOrThrow({ where: { id: made.id } });
    expect(row.status).toBe('DISMISSED');
    expect(row.decidedAt).not.toBeNull();
    expect(phCodeOf(await dismiss(w.owner, made.id))).toBe('PROPOSAL_DECIDED');
    expect(phCodeOf(await accept(w.owner, made.id))).toBe('PROPOSAL_DECIDED');
    expect((await prisma().phAiProposal.findUniqueOrThrow({ where: { id: made.id } })).status).toBe('DISMISSED');
  });

  it('accepts a transfer and hands back the data for the transfer request draft, creating nothing', async () => {
    const made = dataOf(await create(w.owner, transfer({ lines: [{ productId: w.P.id, qty: 1 }, { productId: w.Q.id, qty: 4 }] }))) as any;
    const before = await counts();
    const done = dataOf(await accept(w.owner, made.id)) as any;
    expect(done).toMatchObject({ id: made.id, status: 'ACCEPTED', kind: 'TRANSFER' });
    expect(done.prefill).toEqual({ draft: 'TRANSFER_REQUEST', branchId: w.b2, fromBranchId: w.b2, toBranchId: w.b1, lines: [{ productId: w.P.id, qty: 1 }, { productId: w.Q.id, qty: 4 }] });
    expect(await counts()).toEqual(before);
    const row = await prisma().phAiProposal.findUniqueOrThrow({ where: { id: made.id } });
    expect(row).toMatchObject({ status: 'ACCEPTED' });
    expect(row.decidedAt).not.toBeNull();
    expect(phCodeOf(await accept(w.owner, made.id))).toBe('PROPOSAL_DECIDED');
  });

  it('hands back a purchase order draft for a reorder and a supplier return draft for a return, creating nothing', async () => {
    const r = dataOf(await create(w.owner, reorder(), w.b1)) as any;
    const s = dataOf(await create(w.owner, supplierReturn(), w.b2)) as any;
    const before = await counts();
    expect((dataOf(await accept(w.owner, r.id)) as any).prefill).toEqual({ draft: 'PURCHASE_ORDER', branchId: w.b1, lines: [{ productId: w.P.id, qty: 100 }] });
    expect((dataOf(await accept(w.owner, s.id)) as any).prefill).toEqual({ draft: 'SUPPLIER_RETURN', branchId: w.b2, lines: [{ productId: w.P.id, batchId: w.extra.x, qty: 2 }] });
    expect(await counts()).toEqual(before);
  });

  it('lets exactly one of two simultaneous accepts win', async () => {
    const made = dataOf(await create(w.owner, reorder(), w.b1)) as any;
    const results = await Promise.all([accept(w.owner, made.id), accept(w.manager1, made.id), dismiss(w.owner, made.id)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok).every((r) => !r.ok && r.error.fields?.phCode === 'PROPOSAL_DECIDED')).toBe(true);
  });

  it('keeps the decision to people who may use the draft: a pharmacist, a cashier, another branch, another business', async () => {
    const made = dataOf(await create(w.owner, transfer())) as any; // leaves branch 2
    expect(codeOf(await accept(w.cashier1, made.id))).toBe('FORBIDDEN');
    const atBranch1 = dataOf(await create(w.owner, reorder(), w.b1)) as any;
    expect(codeOf(await accept(w.pharmacist, atBranch1.id))).toBe('FORBIDDEN'); // ai.use, but no purchase.manage
    expect(codeOf(await dismiss(w.stockP, made.id))).toBe('FORBIDDEN');
    expect(codeOf(await accept(w.manager1, made.id))).toBe('NOT_FOUND'); // branch 2 is not theirs
    expect(codeOf(await accept(u.owner, made.id, undefined))).toBe('FORBIDDEN');
    expect(codeOf(await act(u.owner, assistantActions.proposalAccept, { restaurantId: u.a.id, proposalId: made.id }))).toBe('NOT_FOUND');
    expect((await prisma().phAiProposal.findUniqueOrThrow({ where: { id: made.id } })).status).toBe('PROPOSED');
  });

  it('audits the status change and the kind, and nothing of the lines', async () => {
    const made = dataOf(await create(w.owner, reorder(), w.b1)) as any;
    await accept(w.owner, made.id);
    const row = await prisma().auditLog.findFirstOrThrow({ where: { restaurantId: w.a.id, action: 'ph.assistant.proposal.accept', entityId: made.id } });
    expect(row.changes).toEqual({ status: { before: 'PROPOSED', after: 'ACCEPTED' }, kind: { before: null, after: 'REORDER' }, lines: { before: null, after: 1 } });
  });
});

describe('while the pharmacy is read-only', () => {
  it('lists proposals but makes and decides none', async () => {
    const ro = await pharmacy('ROP', { subscription: 'EXPIRED', periodEndsInDays: -5, graceDays: 1, branches: 1 });
    const owner = await person('ownerROP', { membership: [ro.id, 'OWNER'] });
    expect(dataOf(await ask(owner, assistantQueries.proposals, { restaurantId: ro.id }))).toEqual([]);
    expect(codeOf(await act(owner, assistantActions.proposalCreate, { restaurantId: ro.id, branchId: ro.branchId, proposal: { kind: 'REORDER', lines: [{ productId: 'x', qty: 1 }] } }))).toBe('FORBIDDEN');
  });
});
