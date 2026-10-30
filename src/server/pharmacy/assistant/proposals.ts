import { z } from 'zod';
import type { ScopedClient, ScopedTx } from '@/server/data/tenant-db';
import { PROPOSAL_PERMISSION, proposalInput, type ProposalInput } from '@/server/domain/pharmacy/assistant-domain';
import { canPh } from '@/server/domain/pharmacy/permissions';
import { StudioError } from '@/server/studio/framework/result';
import type { PhActor } from '../actor';
import { assertStaff } from '../receipts';

/**
 * What the assistant suggested (R7-7): a PROPOSAL, never an action. This file is the only writer of `PhAiProposal` (enforcement),
 * and it writes nothing else: accepting marks the proposal ACCEPTED and hands back the data to pre-fill the EXISTING transfer
 * request or purchase order draft; the person then creates that draft themselves through the existing screens and actions, which
 * check their own permissions again. The payload holds product ids, batch ids, branch ids and quantities, nothing else (the
 * strict shapes in assistant-domain.ts); no patient, customer or prescription data can be stored.
 */

export { proposalInput };
export const proposalListInput = z.object({ status: z.enum(['PROPOSED', 'ACCEPTED', 'DISMISSED']).optional(), take: z.number().int().min(1).max(100).default(50) }).strict();
export const proposalIdInput = z.object({ proposalId: z.string().min(1).max(64) }).strict();

type Tx = ScopedTx;

function mayHandle(ph: PhActor, kind: ProposalInput['kind']): void {
  assertStaff(ph);
  if (!canPh(ph.role!, 'ai.use') || !canPh(ph.role!, PROPOSAL_PERMISSION[kind])) throw new StudioError('FORBIDDEN');
}

const reach = (ph: PhActor, branchId: string) => ph.allBranches || ph.branchIds.includes(branchId);

export interface ProposalCreated {
  id: string;
  kind: ProposalInput['kind'];
  branchId: string;
  lines: number;
}

/** Makes a proposal in the place's branch (a transfer: in the branch the goods leave). Products, batches and branches are checked to be this business's. */
export async function createProposal(tx: Tx, args: { ph: PhActor; branchId: string | undefined; input: unknown }): Promise<ProposalCreated> {
  const parsed = proposalInput.safeParse(args.input);
  if (!parsed.success) throw new StudioError('INVALID', 'Check the highlighted fields');
  const input = parsed.data;
  const { ph } = args;
  mayHandle(ph, input.kind);

  const branchId = input.kind === 'TRANSFER' ? input.fromBranchId : args.branchId;
  if (!branchId) throw new StudioError('INVALID', 'Choose the branch', { branchId: 'Choose the branch' });
  if (!reach(ph, branchId)) throw new StudioError('FORBIDDEN');
  if (input.kind === 'TRANSFER') {
    if (input.fromBranchId === input.toBranchId) throw new StudioError('INVALID', 'Check the highlighted fields', { toBranchId: 'Choose a different branch' });
    const target = await tx.branch.count({ where: { id: input.toBranchId } });
    if (target !== 1) throw new StudioError('NOT_FOUND');
  }
  const productIds = [...new Set(input.lines.map((l) => l.productId))];
  if ((await tx.phProduct.count({ where: { id: { in: productIds } } })) !== productIds.length) throw new StudioError('NOT_FOUND');
  if (input.kind === 'SUPPLIER_RETURN') {
    for (const line of input.lines) {
      if ((await tx.phBatch.count({ where: { id: line.batchId, productId: line.productId } })) !== 1) throw new StudioError('NOT_FOUND');
    }
  }
  const { kind, ...payload } = input;
  const made = await tx.phAiProposal.create({
    data: { restaurantId: ph.restaurantId, branchId, kind, payload, createdById: ph.userId },
    select: { id: true },
  });
  return { id: made.id, kind, branchId, lines: input.lines.length };
}

export interface ProposalView {
  id: string;
  kind: ProposalInput['kind'];
  status: 'PROPOSED' | 'ACCEPTED' | 'DISMISSED';
  branchId: string;
  createdAt: string;
  decidedAt: string | null;
  payload: unknown;
}

/** The proposals of the person's branches, newest first. */
export async function listProposals(scoped: ScopedClient, ph: PhActor, input: z.infer<typeof proposalListInput>): Promise<ProposalView[]> {
  assertStaff(ph);
  const rows = await scoped.phAiProposal.findMany({
    where: { ...(input.status ? { status: input.status } : {}) },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: input.take,
  });
  return rows.map((r) => ({ id: r.id, kind: r.kind, status: r.status, branchId: r.branchId, createdAt: r.createdAt.toISOString(), decidedAt: r.decidedAt?.toISOString() ?? null, payload: r.payload }));
}

export interface ProposalDecided {
  id: string;
  kind: ProposalInput['kind'];
  status: 'ACCEPTED' | 'DISMISSED';
  branchId: string;
}

/** The data that pre-fills the existing draft; nothing is created. */
export interface Prefill {
  draft: 'TRANSFER_REQUEST' | 'PURCHASE_ORDER' | 'SUPPLIER_RETURN';
  branchId: string;
  fromBranchId?: string;
  toBranchId?: string;
  lines: Array<{ productId: string; batchId?: string; qty: number }>;
}

async function decide(tx: Tx, ph: PhActor, proposalId: string, status: 'ACCEPTED' | 'DISMISSED', now: Date) {
  assertStaff(ph);
  const row = await tx.phAiProposal.findFirst({ where: { id: proposalId } });
  if (!row) throw new StudioError('NOT_FOUND');
  mayHandle(ph, row.kind);
  // One conditional update: of two people deciding at once, exactly one wins; the other sees that it was already decided.
  const done = await tx.phAiProposal.updateMany({ where: { id: row.id, status: 'PROPOSED' }, data: { status, decidedAt: now } });
  if (done.count !== 1) throw new StudioError('CONFLICT', 'This suggestion was already decided', { phCode: 'PROPOSAL_DECIDED' });
  return row;
}

export async function dismissProposal(tx: Tx, args: { ph: PhActor; proposalId: string; now?: Date }): Promise<ProposalDecided> {
  const row = await decide(tx, args.ph, args.proposalId, 'DISMISSED', args.now ?? new Date());
  return { id: row.id, kind: row.kind, status: 'DISMISSED', branchId: row.branchId };
}

export async function acceptProposal(tx: Tx, args: { ph: PhActor; proposalId: string; now?: Date }): Promise<ProposalDecided & { prefill: Prefill }> {
  const row = await decide(tx, args.ph, args.proposalId, 'ACCEPTED', args.now ?? new Date());
  const stored = proposalInput.safeParse({ kind: row.kind, ...(row.payload as object) });
  if (!stored.success) throw new StudioError('CONFLICT', 'This suggestion can no longer be used', { phCode: 'PROPOSAL_UNUSABLE' });
  const p = stored.data;
  const prefill: Prefill =
    p.kind === 'TRANSFER'
      ? { draft: 'TRANSFER_REQUEST', branchId: row.branchId, fromBranchId: p.fromBranchId, toBranchId: p.toBranchId, lines: p.lines.map((l) => ({ productId: l.productId, qty: l.qty })) }
      : p.kind === 'REORDER'
        ? { draft: 'PURCHASE_ORDER', branchId: row.branchId, lines: p.lines.map((l) => ({ productId: l.productId, qty: l.qty })) }
        : { draft: 'SUPPLIER_RETURN', branchId: row.branchId, lines: p.lines.map((l) => ({ productId: l.productId, batchId: l.batchId, qty: l.qty })) };
  return { id: row.id, kind: row.kind, status: 'ACCEPTED', branchId: row.branchId, prefill };
}
