import { describe, expect, it } from 'vitest';
import { INTAKE_LIMITS } from '@/server/domain/pharmacy/intake';
import { NETWORK_FAILURE } from '@/studio/settle';
import {
  CLIENT_LIMITS,
  attentionOf,
  batchStateOf,
  batchChip,
  batchKeyFor,
  checkClientFile,
  effectiveStatus,
  emptyIntakeDraft,
  fileChip,
  fileControls,
  FINAL_REFUSALS,
  isNetworkFailure,
  runDecision,
  itemOf,
  microUsdText,
  nextToRead,
  nextUpload,
  outcomeOfUpload,
  pollPlan,
  qualityReasons,
  setItem,
  stopsReadAll,
  uploadSummary,
  usagePercent,
  usageState,
  type IntakeDraft,
  type UploadItem,
} from '@/app/pharmacy/_ui/intake-logic';

const file = (patch: Partial<{ name: string; type: string; size: number }> = {}) => ({ name: 'invoice.jpg', type: 'image/jpeg', size: 1_000_000, ...patch });
const item = (patch: Partial<UploadItem> = {}): UploadItem => ({ key: 'k1', name: 'invoice.jpg', size: 1000, mediaType: 'image/jpeg', status: 'queued', ...patch });

describe('client pre-checks mirror the server limits', () => {
  it('uses the server limits', () => {
    expect(CLIENT_LIMITS).toEqual({ maxBytes: INTAKE_LIMITS.maxBytes, maxFiles: INTAKE_LIMITS.maxFilesPerBatch });
  });

  it('accepts JPEG, PNG, WebP and PDF', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']) expect(checkClientFile(file({ type }), 0)).toBeNull();
  });

  it('reads the type from the name when the browser gives none', () => {
    expect(checkClientFile(file({ type: '', name: 'scan.PDF' }), 0)).toBeNull();
    expect(checkClientFile(file({ type: '', name: 'photo.jpeg' }), 0)).toBeNull();
    expect(checkClientFile(file({ type: '', name: 'notes.txt' }), 0)).toBe('TYPE');
  });

  it('refuses other types, including HEIC photos', () => {
    expect(checkClientFile(file({ type: 'image/heic', name: 'a.heic' }), 0)).toBe('TYPE');
    expect(checkClientFile(file({ type: 'text/csv', name: 'a.csv' }), 0)).toBe('TYPE');
  });

  it('refuses an empty file and one over 8 MB, accepts exactly 8 MB', () => {
    expect(checkClientFile(file({ size: 0 }), 0)).toBe('EMPTY');
    expect(checkClientFile(file({ size: CLIENT_LIMITS.maxBytes + 1 }), 0)).toBe('TOO_LARGE');
    expect(checkClientFile(file({ size: CLIENT_LIMITS.maxBytes }), 0)).toBeNull();
  });

  it('refuses the 21st file of a batch (files already in it count)', () => {
    expect(checkClientFile(file(), 19)).toBeNull();
    expect(checkClientFile(file(), 20)).toBe('TOO_MANY');
  });
});

describe('the upload queue', () => {
  it('takes the first queued item that has its file, one at a time', () => {
    const items = [item({ key: 'a', status: 'stored' }), item({ key: 'b' }), item({ key: 'c' })];
    expect(nextUpload(items, () => true)?.key).toBe('b');
  });

  it('does not start a second upload while one is in flight', () => {
    expect(nextUpload([item({ key: 'a', status: 'uploading' }), item({ key: 'b' })], () => true)).toBeNull();
  });

  it('skips an item whose file is no longer in memory', () => {
    expect(nextUpload([item({ key: 'a' }), item({ key: 'b' })], (k) => k === 'b')?.key).toBe('b');
  });

  it('shows a queued or uploading item without its file as lost, and leaves settled ones alone', () => {
    expect(effectiveStatus(item({ status: 'queued' }), false)).toBe('lost');
    expect(effectiveStatus(item({ status: 'uploading' }), false)).toBe('lost');
    expect(effectiveStatus(item({ status: 'queued' }), true)).toBe('queued');
    expect(effectiveStatus(item({ status: 'stored' }), false)).toBe('stored');
    expect(effectiveStatus(item({ status: 'failed' }), false)).toBe('failed');
  });

  it('setItem replaces one item by key and keeps the order', () => {
    const items = [item({ key: 'a' }), item({ key: 'b' })];
    const next = setItem(items, 'b', { status: 'stored', fileId: 'f1' });
    expect(next.map((i) => [i.key, i.status])).toEqual([['a', 'queued'], ['b', 'stored']]);
    expect(next[1]!.fileId).toBe('f1');
    expect(items[1]!.status).toBe('queued');
  });

  it('itemOf builds a queued item, or an invalid one with its problem', () => {
    expect(itemOf('n1', file(), null)).toMatchObject({ key: 'n1', status: 'queued', name: 'invoice.jpg', size: 1_000_000, mediaType: 'image/jpeg' });
    expect(itemOf('n2', file({ type: 'text/csv', name: 'a.csv' }), 'TYPE')).toMatchObject({ status: 'invalid', problem: 'TYPE' });
  });
});

describe('what the server answered for one upload', () => {
  const added = { fileId: 'f1', batchId: 'b1', status: 'UPLOADED', duplicate: false, mediaType: 'image/jpeg', pages: 1, bytes: 10, reasons: [] };

  it('a stored file', () => {
    expect(outcomeOfUpload({ data: added }, 'b1')).toEqual({ status: 'stored', fileId: 'f1' });
  });

  it('a poor image is rejected with its reasons in a fixed order', () => {
    expect(outcomeOfUpload({ data: { ...added, status: 'REJECTED_QUALITY', reasons: ['TOO_DARK', 'BLURRY'] } }, 'b1')).toEqual({ status: 'rejected', fileId: 'f1', reasons: ['BLURRY', 'TOO_DARK'] });
  });

  it('the same bytes again in this batch: a stored one is "already uploaded", a rejected one keeps its reasons', () => {
    expect(outcomeOfUpload({ data: { ...added, duplicate: true } }, 'b1')).toEqual({ status: 'duplicate', fileId: 'f1' });
    expect(outcomeOfUpload({ data: { ...added, duplicate: true, status: 'REJECTED_QUALITY', reasons: ['TOO_DARK', 'BLURRY'] } }, 'b1')).toEqual({ status: 'rejected', fileId: 'f1', reasons: ['BLURRY', 'TOO_DARK'] });
  });

  it('the same bytes already in another batch of the branch say so and name that batch', () => {
    expect(outcomeOfUpload({ data: { ...added, duplicate: true, batchId: 'b2' } }, 'b1')).toEqual({ status: 'elsewhere', fileId: 'f1', batchId: 'b2' });
    expect(outcomeOfUpload({ data: { ...added, duplicate: true, batchId: 'b2', status: 'REJECTED_QUALITY', reasons: ['BLURRY'] } }, 'b1')).toMatchObject({ status: 'elsewhere', batchId: 'b2' });
  });

  it('a file that exists where this branch cannot see it is "elsewhere" without a batch to open', () => {
    expect(outcomeOfUpload({ error: { code: 'CONFLICT', message: 'x', fields: { phCode: 'DUPLICATE_FILE' } } }, 'b1')).toEqual({ status: 'elsewhere' });
  });

  it('refusals that repeating cannot fix are failed without a retry', () => {
    for (const phCode of ['TOO_LARGE', 'UNSUPPORTED_TYPE', 'EMPTY', 'TYPE_MISMATCH', 'PDF_UNREADABLE', 'IMAGE_UNREADABLE', 'TOO_MANY_PAGES', 'TOO_MANY_FILES', 'STORAGE_LIMIT', 'BATCH_NOT_OPEN', 'INTAKE_STORAGE_NOT_CONFIGURED', 'SUPPLIER_ARCHIVED']) {
      expect(outcomeOfUpload({ error: { code: 'INVALID', message: 'x', fields: { phCode } } }, 'b1')).toMatchObject({ status: 'failed', retryable: false, phCode });
    }
  });

  it('a lost connection or an unknown failure can be tried again', () => {
    expect(outcomeOfUpload({ error: { code: 'INVALID', message: 'The connection failed before an answer came back.' } }, 'b1')).toMatchObject({ status: 'failed', retryable: true });
    expect(outcomeOfUpload({ error: { code: 'CONFLICT', message: 'x', fields: { phCode: 'RETRY' } } }, 'b1')).toMatchObject({ status: 'failed', retryable: true });
  });

  it('summarises the queue in counts', () => {
    const items = [item({ key: 'a', status: 'stored' }), item({ key: 'b', status: 'rejected' }), item({ key: 'c', status: 'duplicate' }), item({ key: 'd', status: 'failed' }), item({ key: 'e', status: 'queued' }), item({ key: 'f', status: 'uploading' }), item({ key: 'g', status: 'invalid' }), item({ key: 'h', status: 'elsewhere' })];
    expect(uploadSummary(items)).toEqual({ stored: 1, rejected: 1, duplicate: 1, elsewhere: 1, failed: 1, waiting: 2, invalid: 1, busy: true, total: 8 });
  });
});

describe('quality reasons in words', () => {
  it('keeps only known reasons in a fixed order', () => {
    expect(qualityReasons('LOW_CONTRAST,BLURRY,whatever')).toEqual(['BLURRY', 'LOW_CONTRAST']);
    expect(qualityReasons(null)).toEqual([]);
  });
});

describe('the batch key and the draft', () => {
  it('the batch is created with a key that stays while the supplier is the same and changes with it', () => {
    const draft = { ...emptyIntakeDraft('intake-1'), supplierId: 's1' };
    const a = batchKeyFor(draft, () => 'intake-new');
    expect(a).toEqual({ clientKey: 'intake-1', keySig: JSON.stringify(['s1']) });
    const same = batchKeyFor({ ...draft, ...a }, () => 'intake-new');
    expect(same.clientKey).toBe('intake-1');
    const other = batchKeyFor({ ...draft, ...a, supplierId: 's2' }, () => 'intake-2');
    expect(other.clientKey).toBe('intake-2');
  });

  it('a draft round trips through JSON with its files and batch', () => {
    const draft: IntakeDraft = { ...emptyIntakeDraft('intake-1'), supplierId: 's1', supplierName: 'Al Noor', batchId: 'b1', items: [item({ status: 'stored', fileId: 'f1' }), item({ key: 'k2', status: 'failed', retryable: true, message: 'x' })] };
    expect(JSON.parse(JSON.stringify(draft))).toEqual(draft);
  });

  it('a new draft is empty and has no batch', () => {
    expect(emptyIntakeDraft('intake-9')).toEqual({ clientKey: 'intake-9', supplierId: '', supplierName: '', batchId: null, items: [] });
  });
});

describe('status chips', () => {
  it('batch statuses map to a word key and an icon', () => {
    expect(batchChip('OPEN')).toEqual({ kind: 'open', icon: 'open' });
    expect(batchChip('APPROVED')).toEqual({ kind: 'approved', icon: 'approved' });
    expect(batchChip('CANCELLED')).toEqual({ kind: 'cancelled', icon: 'cancelled' });
  });

  it('file statuses map to the six states', () => {
    expect(fileChip('UPLOADED')).toBe('uploaded');
    expect(fileChip('REJECTED_QUALITY')).toBe('rejected');
    expect(fileChip('EXTRACTING')).toBe('reading');
    expect(fileChip('EXTRACTED')).toBe('read');
    expect(fileChip('FAILED')).toBe('failed');
    expect(fileChip('PURGED')).toBe('purged');
  });

  it('counts the files that need attention (failed or rejected)', () => {
    expect(attentionOf([{ status: 'FAILED' }, { status: 'REJECTED_QUALITY' }, { status: 'EXTRACTED' }, { status: 'UPLOADED' }])).toBe(2);
    expect(attentionOf([])).toBe(0);
  });
});

describe('what a file may do', () => {
  const ctx = { batchOpen: true, mayAi: true, writable: true, online: true, busy: false };

  it('an uploaded file can be read, a failed one tried again, others neither', () => {
    expect(fileControls('UPLOADED', ctx)).toMatchObject({ read: { shown: true, disabled: false }, retry: { shown: false } });
    expect(fileControls('FAILED', ctx)).toMatchObject({ read: { shown: false }, retry: { shown: true, disabled: false } });
    for (const s of ['EXTRACTED', 'EXTRACTING', 'REJECTED_QUALITY', 'PURGED'] as const) {
      expect(fileControls(s, ctx).read.shown).toBe(false);
      expect(fileControls(s, ctx).retry.shown).toBe(false);
    }
  });

  it('without ai.use the controls stay shown but disabled with the reason', () => {
    const c = fileControls('UPLOADED', { ...ctx, mayAi: false });
    expect(c.read).toEqual({ shown: true, disabled: 'noAi' });
    expect(fileControls('FAILED', { ...ctx, mayAi: false }).retry).toEqual({ shown: true, disabled: 'noAi' });
  });

  it('gives one reason, the most basic first: read-only, closed batch, no ai.use, offline, busy', () => {
    expect(fileControls('UPLOADED', { ...ctx, writable: false, mayAi: false }).read.disabled).toBe('readOnly');
    expect(fileControls('UPLOADED', { ...ctx, branchOk: false, mayAi: false }).read.disabled).toBe('branch');
    expect(fileControls('UPLOADED', { ...ctx, batchOpen: false, mayAi: false }).read.disabled).toBe('closed');
    expect(fileControls('UPLOADED', { ...ctx, mayAi: false, online: false }).read.disabled).toBe('noAi');
    expect(fileControls('UPLOADED', { ...ctx, online: false }).read.disabled).toBe('offline');
    expect(fileControls('UPLOADED', { ...ctx, busy: true }).read.disabled).toBe('busy');
  });

  it('"enter manually" is offered when the AI path failed or cannot be used', () => {
    expect(fileControls('FAILED', ctx).manual).toBe(true);
    expect(fileControls('REJECTED_QUALITY', ctx).manual).toBe(true);
    expect(fileControls('UPLOADED', { ...ctx, mayAi: false }).manual).toBe(true);
    expect(fileControls('UPLOADED', ctx).manual).toBe(false);
    expect(fileControls('EXTRACTED', ctx).manual).toBe(false);
    expect(fileControls('FAILED', { ...ctx, batchOpen: false }).manual).toBe(false);
  });
});

describe('polling while files are being read', () => {
  it('polls every 3 seconds while a file is being read, and stops when none is', () => {
    expect(pollPlan([{ status: 'EXTRACTING' }, { status: 'UPLOADED' }], 0)).toEqual({ poll: true, delayMs: 3000 });
    expect(pollPlan([{ status: 'EXTRACTED' }, { status: 'FAILED' }], 0)).toEqual({ poll: false, delayMs: 3000 });
    expect(pollPlan([], 0).poll).toBe(false);
  });

  it('gives up after five answers in a row that failed', () => {
    expect(pollPlan([{ status: 'EXTRACTING' }], 4).poll).toBe(true);
    expect(pollPlan([{ status: 'EXTRACTING' }], 5).poll).toBe(false);
  });
});

describe('Read all runs one file at a time', () => {
  it('picks the first uploaded file not tried in this run', () => {
    const files = [{ id: 'a', status: 'EXTRACTED' }, { id: 'b', status: 'UPLOADED' }, { id: 'c', status: 'UPLOADED' }];
    expect(nextToRead(files, new Set())).toBe('b');
    expect(nextToRead(files, new Set(['b']))).toBe('c');
    expect(nextToRead(files, new Set(['b', 'c']))).toBeNull();
  });

  it('never picks a file that is being read, failed or rejected', () => {
    expect(nextToRead([{ id: 'a', status: 'EXTRACTING' }, { id: 'b', status: 'FAILED' }, { id: 'c', status: 'REJECTED_QUALITY' }], new Set())).toBeNull();
  });

  it('stops for a reason that would repeat on the next file, not for a bad file', () => {
    for (const code of ['AI_BUDGET_REACHED', 'AI_NOT_IN_PLAN', 'AI_PRICING_NOT_SET', 'AI_PRICING_MODEL_MISMATCH', 'AI_NOT_CONFIGURED', 'INTAKE_STORAGE_NOT_CONFIGURED', 'BATCH_NOT_OPEN']) expect(stopsReadAll(code)).toBe(true);
    for (const code of ['EXTRACTION_INVALID', 'AI_TIMEOUT', 'TOO_MANY_LINES', 'AI_REFUSED', null]) expect(stopsReadAll(code)).toBe(false);
  });
});

describe('AI usage figures', () => {
  it('writes micro-dollars as dollars with two decimals, rounding half up', () => {
    expect(microUsdText('0')).toBe('$0.00');
    expect(microUsdText('10000000')).toBe('$10.00');
    expect(microUsdText('1234567')).toBe('$1.23');
    expect(microUsdText('1235000')).toBe('$1.24');
    expect(microUsdText('12345678901234567890')).toBe('$12345678901234.57');
  });

  it('says "under one cent" for a tiny amount instead of $0.00', () => {
    expect(microUsdText('4000')).toBe('<$0.01');
    expect(microUsdText('10000')).toBe('$0.01');
  });

  it('percent used is whole, capped at 100, and 0 without a budget', () => {
    expect(usagePercent('2500000', '10000000')).toBe(25);
    expect(usagePercent('12000000', '10000000')).toBe(100);
    expect(usagePercent('1', '0')).toBe(0);
    expect(usagePercent('1', '10000000')).toBe(0);
  });

  it('tells apart: not in the plan, pricing not set, budget used, counts only, ok', () => {
    const base = { month: '2026-10', calls: 1, inputTokens: '1', outputTokens: '1' };
    expect(usageState({ ...base, budgetMicroUsd: '0', spentMicroUsd: '0', reservedMicroUsd: '0', remainingMicroUsd: '0' }, true)).toBe('notInPlan');
    expect(usageState({ ...base, budgetMicroUsd: '10000000', spentMicroUsd: '0', reservedMicroUsd: '0', remainingMicroUsd: '10000000' }, false)).toBe('noPricing');
    expect(usageState({ ...base, budgetMicroUsd: '10000000', spentMicroUsd: '10000000', reservedMicroUsd: '0', remainingMicroUsd: '0' }, true)).toBe('used');
    expect(usageState({ ...base, budgetMicroUsd: '10000000', spentMicroUsd: '1000000', reservedMicroUsd: '0', remainingMicroUsd: '9000000' }, true)).toBe('ok');
    expect(usageState(base, true)).toBe('countsOnly');
  });
});

describe('the batch as the detail screen holds it', () => {
  it('keeps status, version, receipt and files, and counts the lines of each file without the removed ones', () => {
    const file = (id: string) => ({ id, status: 'EXTRACTED' as const, failureCode: null, pages: 1, mediaType: 'image/png', bytes: 5, attempts: 1 });
    const state = batchStateOf({
      batch: { status: 'OPEN', version: 4, receiptId: null },
      files: [file('f1'), file('f2')],
      rows: [
        { fileId: 'f1', removed: false },
        { fileId: 'f1', removed: false },
        { fileId: 'f1', removed: true },
        { fileId: 'f2', removed: true },
      ],
    });
    expect(state).toMatchObject({ status: 'OPEN', version: 4, receiptId: null });
    expect(state.files.map((f) => f.id)).toEqual(['f1', 'f2']);
    expect(state.rowsByFile).toEqual({ f1: 2 });
  });
});

describe('final refusals match what the server sends', () => {
  it('lists every code the server answers a file refusal with, and none it never sends', () => {
    // The server's file refusals (files.ts REFUSALS, the quality reader and the batch rules), by the code on the wire.
    const server = ['UNSUPPORTED_TYPE', 'EMPTY', 'TOO_LARGE', 'TYPE_MISMATCH', 'PDF_UNREADABLE', 'TOO_MANY_PAGES', 'IMAGE_UNREADABLE', 'TOO_MANY_FILES', 'STORAGE_LIMIT', 'BATCH_NOT_OPEN', 'INTAKE_STORAGE_NOT_CONFIGURED', 'SUPPLIER_ARCHIVED'];
    for (const code of server) expect(FINAL_REFUSALS.has(code), code).toBe(true);
    expect(FINAL_REFUSALS.has('PAGES_UNKNOWN')).toBe(false);
    expect(FINAL_REFUSALS.size).toBe(server.length);
  });

  it('a lost connection is retryable, never final', () => {
    const lost = { error: { code: 'INVALID' as const, message: NETWORK_FAILURE } };
    expect(isNetworkFailure(lost.error)).toBe(true);
    expect(outcomeOfUpload(lost, 'b1')).toMatchObject({ status: 'failed', retryable: true });
    expect(isNetworkFailure({ message: 'The file is empty' })).toBe(false);
  });

  it('keeps the error code of a failed upload', () => {
    expect(outcomeOfUpload({ error: { code: 'CONFLICT', message: 'x', fields: { phCode: 'STORAGE_LIMIT' } } }, 'b1')).toMatchObject({ status: 'failed', error: { code: 'CONFLICT' } });
  });
});

describe('a file whose reading died', () => {
  it('is not polled for ever: only a reading that is not stale keeps the polling going', () => {
    expect(pollPlan([{ status: 'EXTRACTING', stale: true }], 0).poll).toBe(false);
    expect(pollPlan([{ status: 'EXTRACTING', stale: true }, { status: 'EXTRACTING', stale: false }], 0).poll).toBe(true);
    expect(pollPlan([{ status: 'EXTRACTING' }], 0).poll).toBe(true);
  });

  it('offers Try again and Enter manually, like a failed one, and Read stays hidden', () => {
    const ctx = { batchOpen: true, mayAi: true, writable: true, online: true, busy: false };
    expect(fileControls('EXTRACTING', ctx, true)).toMatchObject({ read: { shown: false }, retry: { shown: true, disabled: false }, manual: true });
    expect(fileControls('EXTRACTING', ctx, false)).toMatchObject({ retry: { shown: false }, manual: false });
    expect(fileControls('EXTRACTING', { ...ctx, mayAi: false }, true).retry).toEqual({ shown: true, disabled: 'noAi' });
  });

  it('batchStateOf carries the stale flag', () => {
    const base = { id: 'f', status: 'EXTRACTING' as const, failureCode: null, pages: 1, mediaType: 'image/png', bytes: 1, attempts: 1 };
    const state = batchStateOf({ batch: { status: 'OPEN', version: 1, receiptId: null }, files: [{ ...base, stale: true }, { ...base, id: 'g' }], rows: [] });
    expect(state.files.map((f) => f.stale)).toEqual([true, false]);
  });
});

describe('what "Read all" does after one file', () => {
  it('carries on past an error that belongs to that file', () => {
    expect(runDecision({ error: { code: 'CONFLICT', message: 'x', fields: { phCode: 'NOT_CLAIMABLE' } } })).toBe('continue');
    expect(runDecision({ error: { code: 'CONFLICT', message: 'x', fields: { phCode: 'FILE_HAS_REVIEW_EDITS' } } })).toBe('continue');
    expect(runDecision({ failureCode: 'EXTRACTION_INVALID' })).toBe('continue');
    expect(runDecision({ failureCode: null })).toBe('continue');
  });

  it('stops for a reason every other file would meet, and says which', () => {
    expect(runDecision({ failureCode: 'AI_BUDGET_REACHED' })).toBe('sameReason');
    expect(runDecision({ error: { code: 'CONFLICT', message: 'x', fields: { phCode: 'BATCH_NOT_OPEN' } } })).toBe('sameReason');
    expect(runDecision({ error: { code: 'INVALID', message: NETWORK_FAILURE } })).toBe('network');
  });
});
