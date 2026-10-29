import { describe, expect, it } from 'vitest';
import {
  CLIENT_LIMITS,
  attentionOf,
  batchChip,
  batchKeyFor,
  checkClientFile,
  effectiveStatus,
  emptyIntakeDraft,
  fileChip,
  fileControls,
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
    expect(CLIENT_LIMITS).toEqual({ maxBytes: 8 * 1024 * 1024, maxFiles: 20 });
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
    expect(outcomeOfUpload({ data: added })).toEqual({ status: 'stored', fileId: 'f1' });
  });

  it('a poor image is rejected with its reasons in a fixed order', () => {
    expect(outcomeOfUpload({ data: { ...added, status: 'REJECTED_QUALITY', reasons: ['TOO_DARK', 'BLURRY'] } })).toEqual({ status: 'rejected', fileId: 'f1', reasons: ['BLURRY', 'TOO_DARK'] });
  });

  it('the same bytes again is a duplicate, whatever its stored status', () => {
    expect(outcomeOfUpload({ data: { ...added, duplicate: true } })).toEqual({ status: 'duplicate', fileId: 'f1' });
    expect(outcomeOfUpload({ data: { ...added, duplicate: true, status: 'REJECTED_QUALITY', reasons: ['BLURRY'] } })).toMatchObject({ status: 'duplicate' });
  });

  it('a file that exists in another branch is a duplicate without an id', () => {
    expect(outcomeOfUpload({ error: { code: 'CONFLICT', message: 'x', fields: { phCode: 'DUPLICATE_FILE' } } })).toEqual({ status: 'duplicate' });
  });

  it('refusals that repeating cannot fix are failed without a retry', () => {
    for (const phCode of ['TOO_LARGE', 'UNSUPPORTED_TYPE', 'TOO_MANY_PAGES', 'PAGES_UNKNOWN', 'TOO_MANY_FILES', 'STORAGE_LIMIT', 'BATCH_NOT_OPEN', 'INTAKE_STORAGE_NOT_CONFIGURED']) {
      expect(outcomeOfUpload({ error: { code: 'INVALID', message: 'x', fields: { phCode } } })).toMatchObject({ status: 'failed', retryable: false, phCode });
    }
  });

  it('a lost connection or an unknown failure can be tried again', () => {
    expect(outcomeOfUpload({ error: { code: 'INVALID', message: 'The connection failed before an answer came back.' } })).toMatchObject({ status: 'failed', retryable: true });
    expect(outcomeOfUpload({ error: { code: 'CONFLICT', message: 'x', fields: { phCode: 'RETRY' } } })).toMatchObject({ status: 'failed', retryable: true });
  });

  it('summarises the queue in counts', () => {
    const items = [item({ key: 'a', status: 'stored' }), item({ key: 'b', status: 'rejected' }), item({ key: 'c', status: 'duplicate' }), item({ key: 'd', status: 'failed' }), item({ key: 'e', status: 'queued' }), item({ key: 'f', status: 'uploading' }), item({ key: 'g', status: 'invalid' })];
    expect(uploadSummary(items)).toEqual({ stored: 1, rejected: 1, duplicate: 1, failed: 1, waiting: 2, invalid: 1, busy: true, total: 7 });
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
    for (const code of ['AI_BUDGET_REACHED', 'AI_NOT_IN_PLAN', 'AI_PRICING_NOT_SET', 'AI_NOT_CONFIGURED', 'INTAKE_STORAGE_NOT_CONFIGURED', 'BATCH_NOT_OPEN']) expect(stopsReadAll(code)).toBe(true);
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
