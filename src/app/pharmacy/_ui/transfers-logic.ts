import { isExpired, type ExpiryPrecision } from '@/server/domain/pharmacy/expiry';
import { allocateFefo, type BatchStatus } from '@/server/domain/pharmacy/stock';
import { splitQty } from '@/server/domain/pharmacy/units';
import { wholeOf } from './product-draft';
import type { UnitChoice } from './receipt-draft';

/**
 * The transfer screens' pure logic (no React, no network): the request form's value and its problems, the unit ladder
 * text, who can do what, the send proposal and its edits, and the receive figures. The send and receive rules are the
 * server's (`src/server/domain/pharmacy/transfers.ts`), written again here for the browser because that file hashes with
 * `node:crypto`; `tests/pharmacy/ui-transfers-logic.test.ts` runs both on one table of cases so they cannot drift.
 */

export type TransferStatus = 'REQUESTED' | 'SENT' | 'RECEIVED' | 'PARTIAL' | 'CANCELLED';
export type LostReason = 'LOST' | 'OTHER';

/** The most lines a request has, and the server's own cap on sent lines (one per batch). */
export const MAX_REQUEST_LINES = 100;
export const MAX_QTY = 2_147_483_647;
export const tooManyLines = (count: number): boolean => count > MAX_REQUEST_LINES;

// Status ---------------------------------------------------------------------------------------------------------------

export type StatusIcon = 'clock' | 'truck' | 'check' | 'alert' | 'ban';

/** A status as a word key and an icon, so it never rests on colour alone. */
export function statusChip(status: TransferStatus): { key: string; icon: StatusIcon } {
  const icon: Record<TransferStatus, StatusIcon> = { REQUESTED: 'clock', SENT: 'truck', RECEIVED: 'check', PARTIAL: 'alert', CANCELLED: 'ban' };
  return { key: `pharmacy.transfers.status.${status}`, icon: icon[status] };
}

// Reach ----------------------------------------------------------------------------------------------------------------

export interface Reach {
  allBranches: boolean;
  branchIds: readonly string[];
}

/** Whether the person works at this branch (the service's `mayUseBranch`). */
export const mayAt = (reach: Reach, branchId: string): boolean => reach.allBranches || reach.branchIds.includes(branchId);

interface Ends {
  status: TransferStatus;
  fromBranchId: string;
  toBranchId: string;
}

/** What is waiting for this person: a requested transfer for its sender to send, a sent one for its receiver. */
export function actionFor(t: Ends, reach: Reach): 'send' | 'receive' | null {
  if (t.status === 'REQUESTED' && mayAt(reach, t.fromBranchId)) return 'send';
  if (t.status === 'SENT' && mayAt(reach, t.toBranchId)) return 'receive';
  return null;
}

export interface DetailControls {
  edit: boolean;
  cancel: boolean;
  /** `wrongPlace`: the person is the sender, but the branch they work in now cannot see the stock to send from. */
  send: 'yes' | 'no' | 'wrongPlace';
  receive: 'yes' | 'no';
  /** The pharmacy or the role does not allow changes at all (the screen says why). */
  blocked: boolean;
}

/**
 * The controls of a transfer by status and by branch: edit and cancel while REQUESTED (either end), send for the sender,
 * receive for the destination. A sent transfer is never cancelled or edited. Nothing changes when writing is not allowed.
 */
export function detailControls(
  t: Ends,
  ctx: { reach: Reach; writable: boolean; placeBranchId: string | null; perms: { override: boolean; reportView: boolean } },
): DetailControls {
  const none: DetailControls = { edit: false, cancel: false, send: 'no', receive: 'no', blocked: !ctx.writable };
  if (!ctx.writable) return none;
  const eitherEnd = mayAt(ctx.reach, t.fromBranchId) || mayAt(ctx.reach, t.toBranchId);
  if (t.status === 'REQUESTED') {
    const sender = mayAt(ctx.reach, t.fromBranchId);
    const sees = ctx.placeBranchId === null || ctx.placeBranchId === t.fromBranchId;
    return { ...none, edit: eitherEnd, cancel: eitherEnd, send: sender ? (sees ? 'yes' : 'wrongPlace') : 'no' };
  }
  if (t.status === 'SENT') return { ...none, receive: mayAt(ctx.reach, t.toBranchId) ? 'yes' : 'no' };
  return none;
}

// Quantities -----------------------------------------------------------------------------------------------------------

/** A base quantity written in the product's units, largest first: `2 Box + 1 Strip + 5 Tablet`. No ladder: the number alone. */
export function ladderText(units: readonly UnitChoice[], baseQty: number): string {
  if (units.length === 0) return String(baseQty);
  const levels = [...units].sort((a, b) => a.baseQty - b.baseQty).map((u, level) => ({ level, label: u.label, baseQty: u.baseQty, sellable: true }));
  try {
    const parts = splitQty(levels, baseQty);
    if (parts.length === 0) return `0 ${levels[0]!.label}`;
    return parts.map((p) => `${p.qty} ${p.label}`).join(' + ');
  } catch {
    return String(baseQty);
  }
}

// The request form -----------------------------------------------------------------------------------------------------

export interface TransferLineDraft {
  /** Stable within the form, so a row keeps its fields when another is removed. */
  key: string;
  productId: string;
  productName: string;
  productMeta: string;
  units: UnitChoice[];
  unitId: string;
  /** In the chosen unit, as typed. */
  qty: string;
}

export interface TransferDraft {
  /** The saved transfer's version this draft was made on (0 for a new one). */
  version: number;
  clientKey: string;
  /** The signature `clientKey` was made for: the key is reused only while the request is the same. */
  keySig?: string;
  /** `send`: I send from my branch. `request`: I ask for stock into my branch. */
  mode: 'send' | 'request';
  mineId: string;
  otherId: string;
  note: string;
  lines: TransferLineDraft[];
}

export function emptyTransferDraft(clientKey: string, mode: 'send' | 'request', mineId: string, otherId: string): TransferDraft {
  return { version: 0, clientKey, mode, mineId, otherId, note: '', lines: [] };
}

export function endsOf(draft: Pick<TransferDraft, 'mode' | 'mineId' | 'otherId'>): { fromBranchId: string; toBranchId: string } {
  return draft.mode === 'send' ? { fromBranchId: draft.mineId, toBranchId: draft.otherId } : { fromBranchId: draft.otherId, toBranchId: draft.mineId };
}

/** The quantity of a line in base units, or null when what is typed is not a whole number of at least 1. */
export function lineBaseQty(line: TransferLineDraft): number | null {
  const qty = wholeOf(line.qty);
  const unit = line.units.find((u) => u.id === line.unitId);
  if (qty === null || qty < 1 || !unit) return null;
  const base = qty * unit.baseQty;
  return Number.isSafeInteger(base) ? base : null;
}

/** What `clientKey` is made for: the ends, the note and each line's product, unit and quantity. */
export function draftSignature(draft: TransferDraft): string {
  const { fromBranchId, toBranchId } = endsOf(draft);
  return JSON.stringify([fromBranchId, toBranchId, draft.note, draft.lines.map((l) => [l.productId, l.unitId, l.qty.trim()])]);
}

export type RequestProblem = 'missing' | 'same' | 'notMine' | 'none' | 'tooMany' | 'qty' | 'big' | 'duplicate';

export interface BuiltRequest {
  input?: { fromBranchId: string; toBranchId: string; note: string; lines: { productId: string; qty: number }[] } | { note: string; lines: { productId: string; qty: number }[] };
  /** `branches`, `lines`, `lines.<i>.qty`, `lines.<i>.productId` to a code the screen turns into a sentence. */
  problems: Record<string, RequestProblem>;
}

/** The action input of a request (or of an update of its note and lines) and the problems that need no server. */
export function transferInputOf(draft: TransferDraft, reach: Reach, mode: 'create' | 'update'): BuiltRequest {
  const problems: BuiltRequest['problems'] = {};
  const { fromBranchId, toBranchId } = endsOf(draft);
  if (mode === 'create') {
    if (!draft.mineId || !draft.otherId) problems.branches = 'missing';
    else if (draft.mineId === draft.otherId) problems.branches = 'same';
    else if (!mayAt(reach, draft.mineId)) problems.branches = 'notMine';
  }
  if (draft.lines.length === 0) problems.lines = 'none';
  else if (tooManyLines(draft.lines.length)) problems.lines = 'tooMany';
  const seen = new Set<string>();
  const lines = draft.lines.map((l, i) => {
    const base = lineBaseQty(l);
    if (base === null) problems[`lines.${i}.qty`] = wholeOf(l.qty) !== null && (wholeOf(l.qty) ?? 0) >= 1 ? 'big' : 'qty';
    else if (base > MAX_QTY) problems[`lines.${i}.qty`] = 'big';
    if (seen.has(l.productId)) problems[`lines.${i}.productId`] = 'duplicate';
    seen.add(l.productId);
    return { productId: l.productId, qty: base ?? 0 };
  });
  if (Object.keys(problems).length > 0) return { problems };
  return { problems, input: mode === 'create' ? { fromBranchId, toBranchId, note: draft.note, lines } : { note: draft.note, lines } };
}

// Sending --------------------------------------------------------------------------------------------------------------

/** One batch of a product at the sending branch, with what is available there. */
export interface SendStockBatch {
  batchId: string;
  productId: string;
  lot: string;
  expiryDate: string;
  expiryPrecision: ExpiryPrecision;
  status: BatchStatus;
  available: number;
}

export interface SendRequestLine {
  lineId: string;
  productId: string;
  requestedQty: number;
}

export interface SendRow {
  batchId: string;
  qty: number;
}

export interface SendProposal {
  lineId: string;
  productId: string;
  requestedQty: number;
  /** What the sender can send of this product (sendable batches only). */
  availableQty: number;
  /** The sender cannot cover the request: the proposal is what exists. */
  short: boolean;
  rows: SendRow[];
}

/** Only an ACTIVE, unexpired batch may leave a branch. */
export const sendableBatch = (b: SendStockBatch, today: string): boolean => b.status === 'ACTIVE' && !isExpired(b, today);

const fefoCandidates = (batches: readonly SendStockBatch[], today: string) =>
  batches.filter((b) => sendableBatch(b, today) && b.available > 0).map((b) => ({ id: b.batchId, lot: b.lot, expiryDate: b.expiryDate, expiryPrecision: b.expiryPrecision, sellable: b.available }));

/** Per request line, the FEFO batches that cover it (or everything sendable when it cannot be covered). */
export function proposeSend(lines: readonly SendRequestLine[], stock: readonly SendStockBatch[], today: string): SendProposal[] {
  return lines.map((line) => {
    const candidates = fefoCandidates(stock.filter((b) => b.productId === line.productId), today);
    const availableQty = candidates.reduce((sum, b) => sum + b.sellable, 0);
    const taken = allocateFefo(candidates, line.requestedQty);
    const rows = (taken.ok ? taken.allocations : allocateFefo(candidates, availableQty).allocations).map((a) => ({ batchId: a.batchId, qty: a.qty }));
    return { lineId: line.lineId, productId: line.productId, requestedQty: line.requestedQty, availableQty, short: !taken.ok, rows };
  });
}

/**
 * Whether these picks for one line are not what FEFO would take: a sendable batch that expires EARLIER than the latest picked
 * one still has stock left after the picks. Batches that expire the same day are equally first in line.
 */
export function isOverridePicks(picks: readonly SendRow[], batches: readonly SendStockBatch[], today: string): boolean {
  const used = picks.filter((p) => p.qty > 0);
  if (used.length === 0) return false;
  const byId = new Map(batches.map((b) => [b.batchId, b]));
  const taken = new Map(picks.map((p) => [p.batchId, p.qty]));
  const latest = used.reduce((max, p) => {
    const date = byId.get(p.batchId)?.expiryDate ?? '';
    return date > max ? date : max;
  }, '');
  return batches.some((b) => sendableBatch(b, today) && b.expiryDate < latest && b.available - (taken.get(b.batchId) ?? 0) > 0);
}

export type SendProblem = 'qty' | 'overBatch' | 'overRequested' | 'noStock' | 'needed' | 'nothing';

export interface BuiltSend {
  input?: { transferId: string; version: number; picks: { lineId: string; batchId: string; qty: number }[] };
  /** `<lineId>|<batchId>` for a row, the line id for a line, `override` and `nothing` for the whole. */
  problems: Record<string, SendProblem>;
  /** Some line is out of expiry order (whether or not the person may). */
  overridden: boolean;
  totalQty: number;
}

export const rowKey = (lineId: string, batchId: string) => `${lineId}|${batchId}`;

/** The quantity a row will send: the person's edit when there is one, else the proposal's. */
export function rowQty(edits: Readonly<Record<string, string>>, lineId: string, row: SendRow): number | null {
  const typed = edits[rowKey(lineId, row.batchId)];
  return typed === undefined ? row.qty : wholeOf(typed);
}

/**
 * The picks a send will make. Every row is an explicit pick (so a line the person zeroed is not filled FEFO by the server),
 * limited by the batch and by the request, and out-of-order picks need the override.
 */
export function sendInputOf(args: {
  transferId: string;
  version: number;
  proposal: readonly SendProposal[];
  edits: Readonly<Record<string, string>>;
  stock: readonly SendStockBatch[];
  today: string;
  canOverride: boolean;
  /** Rows the person added with "Pick another batch" (qty 0 until typed). */
  extra?: Readonly<Record<string, readonly string[]>>;
}): BuiltSend {
  const problems: BuiltSend['problems'] = {};
  const picks: { lineId: string; batchId: string; qty: number }[] = [];
  let overridden = false;
  let totalQty = 0;
  for (const line of args.proposal) {
    const batches = args.stock.filter((b) => b.productId === line.productId);
    const rows: SendRow[] = [...line.rows, ...(args.extra?.[line.lineId] ?? []).filter((id) => !line.rows.some((r) => r.batchId === id)).map((batchId) => ({ batchId, qty: 0 }))];
    if (rows.length === 0) {
      problems[line.lineId] = 'noStock';
      continue;
    }
    const filled: SendRow[] = [];
    let sum = 0;
    for (const row of rows) {
      const qty = rowQty(args.edits, line.lineId, row);
      const batch = batches.find((b) => b.batchId === row.batchId);
      if (qty === null || !batch) {
        problems[rowKey(line.lineId, row.batchId)] = 'qty';
        continue;
      }
      if (qty > batch.available) problems[rowKey(line.lineId, row.batchId)] = 'overBatch';
      filled.push({ batchId: row.batchId, qty });
      sum += qty;
    }
    if (sum > line.requestedQty) problems[line.lineId] = 'overRequested';
    if (isOverridePicks(filled, batches, args.today)) overridden = true;
    totalQty += sum;
    for (const row of filled) if (row.qty > 0 || filled.every((r) => r.qty === 0) && row === filled[0]) picks.push({ lineId: line.lineId, batchId: row.batchId, qty: row.qty });
  }
  if (overridden && !args.canOverride) problems.override = 'needed';
  if (Object.keys(problems).length === 0 && totalQty === 0) problems.nothing = 'nothing';
  if (Object.keys(problems).length > 0) return { problems, overridden, totalQty };
  return { problems, overridden, totalQty, input: { transferId: args.transferId, version: args.version, picks } };
}

/** What a send attempt is keyed to: the transfer and the picks, not the version it was opened on. */
export function sendSignature(transferId: string, picks: readonly { lineId: string; batchId: string; qty: number }[]): string {
  return JSON.stringify([transferId, [...picks].sort((a, b) => (a.lineId + a.batchId < b.lineId + b.batchId ? -1 : 1)).map((p) => [p.lineId, p.batchId, p.qty])]);
}

// Receiving ------------------------------------------------------------------------------------------------------------

export interface ReceiveLineDraft {
  lineId: string;
  sentQty: number;
  received: string;
  damaged: string;
  lost: string;
  lostReason: '' | LostReason;
  quarantine: boolean;
}

export interface ReceiveBreakdown {
  received: number;
  damaged: number;
  lost: number;
  /** Units not yet placed (positive) or placed beyond what was sent (negative). Zero when every unit is accounted for. */
  unaccounted: number;
  /** A lost quantity without its reason. */
  needsReason: boolean;
  /** Some figure is not a whole number. */
  invalid: boolean;
  /** Where each unit goes: available, quarantine, damaged (bucket), lost (recorded only). */
  goes: { available: number; quarantine: number; damaged: number; lost: number };
  ok: boolean;
}

const figure = (text: string): number | null => (text.trim() === '' ? 0 : wholeOf(text));

/**
 * Where the units of one sent line go. `unsellable` is a batch that can no longer be sold (expired, recalled or blocked): its
 * received units go to quarantine whatever the toggle says, as the server books them.
 */
export function receiveBreakdown(line: ReceiveLineDraft, unsellable: boolean): ReceiveBreakdown {
  const r = figure(line.received);
  const d = figure(line.damaged);
  const l = figure(line.lost);
  const invalid = r === null || d === null || l === null;
  const received = r ?? 0;
  const damaged = d ?? 0;
  const lost = l ?? 0;
  const unaccounted = line.sentQty - received - damaged - lost;
  const toQuarantine = line.quarantine || unsellable;
  const needsReason = lost > 0 && line.lostReason === '';
  return {
    received,
    damaged,
    lost,
    unaccounted,
    needsReason,
    invalid,
    goes: { available: toQuarantine ? 0 : received, quarantine: toQuarantine ? received : 0, damaged, lost },
    ok: !invalid && unaccounted === 0 && !needsReason,
  };
}

/** The line with the missing units put in lost (reason LOST unless one is set). Nothing missing: unchanged. */
export function restOfLine(line: ReceiveLineDraft): ReceiveLineDraft {
  const b = receiveBreakdown(line, false);
  if (b.invalid || b.unaccounted <= 0) return line;
  return { ...line, lost: String(b.lost + b.unaccounted), lostReason: line.lostReason === '' ? 'LOST' : line.lostReason };
}

export type ReceiveProblem = 'unaccounted' | 'over' | 'reason' | 'number';

export interface BuiltReceive {
  input?: {
    transferId: string;
    version: number;
    clientKey: string;
    lines: { lineId: string; receivedQty: number; damagedQty: number; lostQty: number; lostReason?: LostReason; quarantine: boolean }[];
  };
  /** `<lineId>` to a code. */
  problems: Record<string, ReceiveProblem>;
  /** What the transfer will be when closed: RECEIVED when every line comes in full, else PARTIAL. */
  status: 'RECEIVED' | 'PARTIAL';
  /** Closing needs a person who can see reports (any unit lost). */
  needsReportView: boolean;
}

export function receiveInputOf(args: { transferId: string; version: number; clientKey: string; lines: readonly ReceiveLineDraft[] }): BuiltReceive {
  const problems: BuiltReceive['problems'] = {};
  const lines = args.lines.map((line) => {
    const b = receiveBreakdown(line, false);
    if (b.invalid) problems[line.lineId] = 'number';
    else if (b.unaccounted > 0) problems[line.lineId] = 'unaccounted';
    else if (b.unaccounted < 0) problems[line.lineId] = 'over';
    else if (b.needsReason) problems[line.lineId] = 'reason';
    return {
      lineId: line.lineId,
      receivedQty: b.received,
      damagedQty: b.damaged,
      lostQty: b.lost,
      ...(b.lost > 0 && line.lostReason !== '' ? { lostReason: line.lostReason } : {}),
      quarantine: line.quarantine,
    };
  });
  const status = args.lines.every((l) => (figure(l.received) ?? -1) === l.sentQty) ? 'RECEIVED' : 'PARTIAL';
  const needsReportView = lines.some((l) => l.lostQty > 0);
  if (Object.keys(problems).length > 0) return { problems, status, needsReportView };
  return { problems, status, needsReportView, input: { transferId: args.transferId, version: args.version, clientKey: args.clientKey, lines } };
}

/** What a receive attempt is keyed to: the transfer and every figure. */
export function receiveSignature(transferId: string, lines: readonly ReceiveLineDraft[]): string {
  return JSON.stringify([transferId, [...lines].sort((a, b) => (a.lineId < b.lineId ? -1 : 1)).map((l) => [l.lineId, l.received.trim(), l.damaged.trim(), l.lost.trim(), l.lostReason, l.quarantine])]);
}

/** The receive form's start: everything sent counts as received, nothing damaged or lost. */
export function startReceive(sentLines: readonly { lineId: string; sentQty: number }[]): ReceiveLineDraft[] {
  return sentLines.map((l) => ({ lineId: l.lineId, sentQty: l.sentQty, received: String(l.sentQty), damaged: '0', lost: '0', lostReason: '', quarantine: false }));
}
