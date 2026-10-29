import { attemptKeyFor } from './purchasing-logic';
import { newClientKey } from './sell-logic';

/**
 * The invoice intake screens' decisions, apart from the screens: what the browser checks before it sends a file, the
 * upload queue and how an answer settles one item, the draft kept on the device, the chip of each state, which controls
 * a file shows and why one is disabled, when to poll, which file "Read all" takes next and when it stops, and the
 * usage figures. The server stays the authority on every limit (it reads the type from the bytes, counts pages and
 * judges the picture); these checks only spare a round trip and say the reason at once. No motion, no I/O.
 */

// Limits the browser can check ----------------------------------------------------------------------------------------

/** The server's per-file and per-batch limits (INTAKE_LIMITS); the page count of a PDF is only known on the server. */
export const CLIENT_LIMITS = { maxBytes: 8 * 1024 * 1024, maxFiles: 20 } as const;

export type FileProblem = 'TYPE' | 'EMPTY' | 'TOO_LARGE' | 'TOO_MANY';

const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
const BY_EXTENSION: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf' };

/** The accepted type a file has by its browser type or, when the browser gives none, by its name; null when it has none. */
export function acceptedType(file: { name: string; type: string }): string | null {
  const type = file.type.trim().toLowerCase();
  if (type !== '') return TYPES.has(type) ? type : null;
  const extension = file.name.toLowerCase().split('.').pop() ?? '';
  return BY_EXTENSION[extension] ?? null;
}

/** Why a file is not worth sending, or null. `taken` is how many files the batch holds or has queued already. */
export function checkClientFile(file: { name: string; type: string; size: number }, taken: number): FileProblem | null {
  if (taken >= CLIENT_LIMITS.maxFiles) return 'TOO_MANY';
  if (acceptedType(file) === null) return 'TYPE';
  if (file.size <= 0) return 'EMPTY';
  if (file.size > CLIENT_LIMITS.maxBytes) return 'TOO_LARGE';
  return null;
}

// The upload queue -----------------------------------------------------------------------------------------------------

export type UploadStatus = 'queued' | 'uploading' | 'stored' | 'rejected' | 'duplicate' | 'failed' | 'invalid';

/** One file of the draft. The bytes are not here: only the browser's memory holds them, so a draft can be saved as JSON. */
export interface UploadItem {
  key: string;
  name: string;
  size: number;
  mediaType: string;
  status: UploadStatus;
  fileId?: string | undefined;
  /** Quality reasons of a rejected picture (BLURRY, TOO_DARK, ...). */
  reasons?: string[] | undefined;
  /** Why a file failed, in the server's own words (translated when shown). */
  message?: string | undefined;
  phCode?: string | undefined;
  retryable?: boolean | undefined;
  /** Why a file was never queued. */
  problem?: FileProblem | undefined;
}

export function itemOf(key: string, file: { name: string; type: string; size: number }, problem: FileProblem | null): UploadItem {
  const base = { key, name: file.name, size: file.size, mediaType: acceptedType(file) ?? file.type };
  return problem ? { ...base, status: 'invalid', problem } : { ...base, status: 'queued' };
}

export function setItem(items: readonly UploadItem[], key: string, patch: Partial<UploadItem>): UploadItem[] {
  return items.map((i) => (i.key === key ? { ...i, ...patch } : i));
}

/**
 * What an item really is now: a draft brought back after the page was closed lists files that were waiting, but their bytes
 * are gone, so they are shown as lost (choose the file again) rather than waiting for ever.
 */
export function effectiveStatus(item: UploadItem, hasFile: boolean): UploadStatus | 'lost' {
  return (item.status === 'queued' || item.status === 'uploading') && !hasFile ? 'lost' : item.status;
}

/** The next file to send: files go one at a time, in the order chosen, and never while one is on its way. */
export function nextUpload(items: readonly UploadItem[], hasFile: (key: string) => boolean): UploadItem | null {
  if (items.some((i) => i.status === 'uploading' && hasFile(i.key))) return null;
  return items.find((i) => i.status === 'queued' && hasFile(i.key)) ?? null;
}

const QUALITY_ORDER = ['BLURRY', 'TOO_SMALL', 'TOO_DARK', 'LOW_CONTRAST'] as const;

/** The known quality reasons of a stored `failureCode` (comma separated) or a list, in a fixed order. */
export function qualityReasons(source: string | readonly string[] | null | undefined): string[] {
  const given = typeof source === 'string' ? source.split(',') : (source ?? []);
  return QUALITY_ORDER.filter((r) => given.includes(r));
}

/** The route's answer: `{ data }` or `{ error }` (the Studio route shape). */
export type UploadAnswer = { data: unknown } | { error: { code: string; message: string; fields?: Record<string, string> | undefined } };

export type UploadOutcome =
  | { status: 'stored'; fileId: string }
  | { status: 'rejected'; fileId: string; reasons: string[] }
  | { status: 'duplicate'; fileId?: string }
  | { status: 'failed'; retryable: boolean; message: string; phCode?: string; error: { code: string; message: string; fields?: Record<string, string> | undefined } };

/** Refusals that sending the same file again cannot change. */
const FINAL = new Set(['TOO_LARGE', 'UNSUPPORTED_TYPE', 'TOO_MANY_PAGES', 'PAGES_UNKNOWN', 'TOO_MANY_FILES', 'STORAGE_LIMIT', 'BATCH_NOT_OPEN', 'INTAKE_STORAGE_NOT_CONFIGURED', 'SUPPLIER_ARCHIVED']);

export function outcomeOfUpload(answer: UploadAnswer): UploadOutcome {
  if ('error' in answer) {
    const phCode = answer.error.fields?.phCode;
    if (phCode === 'DUPLICATE_FILE') return { status: 'duplicate' };
    return { status: 'failed', retryable: !(phCode && FINAL.has(phCode)), message: answer.error.message, ...(phCode ? { phCode } : {}), error: answer.error };
  }
  const added = answer.data as { fileId: string; status: string; duplicate: boolean; reasons?: string[] };
  if (added.duplicate) return { status: 'duplicate', fileId: added.fileId };
  if (added.status === 'REJECTED_QUALITY') return { status: 'rejected', fileId: added.fileId, reasons: qualityReasons(added.reasons ?? []) };
  return { status: 'stored', fileId: added.fileId };
}

export function uploadSummary(items: readonly UploadItem[]) {
  const count = (...s: UploadStatus[]) => items.filter((i) => s.includes(i.status)).length;
  return {
    stored: count('stored'),
    rejected: count('rejected'),
    duplicate: count('duplicate'),
    failed: count('failed'),
    waiting: count('queued', 'uploading'),
    invalid: count('invalid'),
    busy: items.some((i) => i.status === 'uploading'),
    total: items.length,
  };
}

// The draft ---------------------------------------------------------------------------------------------------------------

/** What "New batch" keeps on the device: the key the batch is made with, the supplier, the batch once it exists, the files. */
export interface IntakeDraft {
  clientKey: string;
  /** The signature `clientKey` was made for. */
  keySig?: string | undefined;
  supplierId: string;
  supplierName: string;
  /** Set once the batch exists; a refresh then continues with it (the same key would replay it anyway). */
  batchId: string | null;
  items: UploadItem[];
}

export function emptyIntakeDraft(clientKey: string): IntakeDraft {
  return { clientKey, supplierId: '', supplierName: '', batchId: null, items: [] };
}

/** The key the batch is created with: the draft's own until it was used, then kept while the supplier is the same and new once it changed. */
export function batchKeyFor(draft: Pick<IntakeDraft, 'clientKey' | 'keySig' | 'supplierId'>, make: (prefix: string) => string = newClientKey): { clientKey: string; keySig: string } {
  const sig = JSON.stringify([draft.supplierId]);
  if (draft.keySig === undefined) return { clientKey: draft.clientKey, keySig: sig };
  return attemptKeyFor(draft, sig, 'intake', make);
}

// Chips ---------------------------------------------------------------------------------------------------------------------

export type BatchStatusName = 'OPEN' | 'APPROVED' | 'CANCELLED';

/** A batch's chip: a word key and an icon key (never a colour alone). */
export function batchChip(status: BatchStatusName): { kind: 'open' | 'approved' | 'cancelled'; icon: 'open' | 'approved' | 'cancelled' } {
  const kind = status === 'OPEN' ? 'open' : status === 'APPROVED' ? 'approved' : 'cancelled';
  return { kind, icon: kind };
}

export type FileStatusName = 'UPLOADED' | 'REJECTED_QUALITY' | 'EXTRACTING' | 'EXTRACTED' | 'FAILED' | 'PURGED';
export type FileChipKind = 'uploaded' | 'rejected' | 'reading' | 'read' | 'failed' | 'purged';

const FILE_CHIPS: Record<FileStatusName, FileChipKind> = {
  UPLOADED: 'uploaded',
  REJECTED_QUALITY: 'rejected',
  EXTRACTING: 'reading',
  EXTRACTED: 'read',
  FAILED: 'failed',
  PURGED: 'purged',
};

export const fileChip = (status: FileStatusName): FileChipKind => FILE_CHIPS[status];

/** Files that need a person: they failed to read or were rejected for quality. */
export const attentionOf = (files: readonly { status: string }[]): number => files.filter((f) => f.status === 'FAILED' || f.status === 'REJECTED_QUALITY').length;

// Controls --------------------------------------------------------------------------------------------------------------------

export type DisabledReason = 'readOnly' | 'closed' | 'noAi' | 'offline' | 'busy';
/** `disabled` is the reason a shown control cannot be used now; false when it can (and always false when not shown). */
export type Control = { shown: boolean; disabled: false | DisabledReason };

export interface ControlContext {
  batchOpen: boolean;
  /** The role holds `ai.use`. */
  mayAi: boolean;
  /** The pharmacy is open for writing and the role may buy. */
  writable: boolean;
  online: boolean;
  /** A reading is running from this screen. */
  busy: boolean;
}

const reasonOf = (ctx: ControlContext): false | DisabledReason => (!ctx.writable ? 'readOnly' : !ctx.batchOpen ? 'closed' : !ctx.mayAi ? 'noAi' : !ctx.online ? 'offline' : ctx.busy ? 'busy' : false);

/**
 * A file's controls. Read and Try again are shown for the states they belong to and disabled, with the reason, when this
 * person or moment cannot use them. "Enter manually" is offered whenever the AI path failed or is not open to this role.
 */
export function fileControls(status: FileStatusName, ctx: ControlContext): { read: Control; retry: Control; manual: boolean } {
  const disabled = reasonOf(ctx);
  return {
    read: status === 'UPLOADED' ? { shown: true, disabled } : { shown: false, disabled: false },
    retry: status === 'FAILED' ? { shown: true, disabled } : { shown: false, disabled: false },
    manual: ctx.batchOpen && (status === 'FAILED' || status === 'REJECTED_QUALITY' || (status === 'UPLOADED' && disabled === 'noAi')),
  };
}

// Polling and Read all -------------------------------------------------------------------------------------------------------

export const POLL_MS = 3000;
const POLL_GIVE_UP = 5;

/** Refresh the batch every 3 seconds while a file is being read; stop when none is, or after five failed refreshes in a row. */
export function pollPlan(files: readonly { status: string }[], failures: number): { poll: boolean; delayMs: number } {
  return { poll: failures < POLL_GIVE_UP && files.some((f) => f.status === 'EXTRACTING'), delayMs: POLL_MS };
}

/** The next file "Read all" takes: the first uploaded one this run has not tried yet. */
export function nextToRead(files: readonly { id: string; status: string }[], tried: ReadonlySet<string>): string | null {
  return files.find((f) => f.status === 'UPLOADED' && !tried.has(f.id))?.id ?? null;
}

const RUN_STOPPERS = new Set(['AI_BUDGET_REACHED', 'AI_NOT_IN_PLAN', 'AI_PRICING_NOT_SET', 'AI_NOT_CONFIGURED', 'INTAKE_STORAGE_NOT_CONFIGURED', 'BATCH_NOT_OPEN']);

/** A failure that would repeat for every other file (budget, plan, set-up): "Read all" stops there instead of trying the rest. */
export const stopsReadAll = (code: string | null | undefined): boolean => code != null && RUN_STOPPERS.has(code);

// Usage ------------------------------------------------------------------------------------------------------------------------

/** Micro-dollars as dollars, two decimals, rounded half up; "<$0.01" for a positive amount below one cent. */
export function microUsdText(micro: string): string {
  const cents = (BigInt(micro) + 5000n) / 10000n;
  if (cents === 0n) return BigInt(micro) > 0n ? '<$0.01' : '$0.00';
  const digits = cents.toString().padStart(3, '0');
  return `$${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

/** Whole percent of the budget used (spent plus reserved), capped at 100; 0 without a budget. */
export function usagePercent(usedMicro: string, budgetMicro: string): number {
  const budget = BigInt(budgetMicro);
  if (budget <= 0n) return 0;
  const percent = (BigInt(usedMicro) * 100n) / budget;
  return Number(percent > 100n ? 100n : percent);
}

export interface UsageFigures {
  month: string;
  calls: number;
  inputTokens: string;
  outputTokens: string;
  budgetMicroUsd?: string;
  spentMicroUsd?: string;
  reservedMicroUsd?: string;
  remainingMicroUsd?: string;
}

export type UsageState = 'countsOnly' | 'notInPlan' | 'noPricing' | 'used' | 'ok';

export function usageState(view: UsageFigures, pricingSet: boolean): UsageState {
  if (view.budgetMicroUsd === undefined) return 'countsOnly';
  if (BigInt(view.budgetMicroUsd) <= 0n) return 'notInPlan';
  if (!pricingSet) return 'noPricing';
  return BigInt(view.remainingMicroUsd ?? '0') <= 0n ? 'used' : 'ok';
}
