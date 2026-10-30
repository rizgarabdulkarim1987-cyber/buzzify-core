import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { ScopedClient, ScopedTx } from '@/server/data/tenant-db';
import { INVISIBLE } from '@/server/domain/pharmacy/purchasing';
import { updateWithVersion } from '@/server/studio/framework/concurrency';
import { StudioError } from '@/server/studio/framework/result';

/**
 * Suppliers (R4-1, R4-10, R4-12): business-wide records (restaurantId only), archived and never deleted. The services take
 * the transaction (or scoped client) of the action or query that calls them; the actions audit.
 *
 * Lock order of this phase (header comment of every service that locks): client key (advisory, namespace 7201) -> PO row
 * FOR UPDATE -> receipt line counters FOR UPDATE -> invoice rows FOR UPDATE ordered by id -> stock rows (phase 2/3 order)
 * -> number lock (7202). This file takes only the first.
 */

/** The advisory-lock namespace of purchasing client keys (the second int is `hashtext(restaurantId:clientKey)`). */
export const NS_CLIENT_KEY = 7201;

export const PAGE_SIZE = 50;

const WHOLE = 'Enter a whole number';

/** Bidirectional controls (U+061C Arabic letter mark, U+200E/F, U+202A-E, U+2066-9): never meaningful in stored text. */
const BIDI = /[؜‎‏‪-‮⁦-⁩]/g;

/**
 * A single-line text as stored: bidi controls removed, every run of white space (line breaks too) one space, trimmed.
 * ZWNJ and ZWJ stay: they are meaningful in Persian, Kurdish and emoji.
 */
export function cleanText(value: string): string {
  return value.replace(BIDI, '').replace(/\s+/g, ' ').trim();
}

/** A multi-line text as stored (address, note): bidi controls removed, line breaks kept (at most one blank line), spaces collapsed per line. */
export function cleanMultiline(value: string): string {
  return value
    .replace(BIDI, '')
    .replace(/\r\n?|\r/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[^\S\n]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * The key two names are compared by: NFKC (presentation forms, fullwidth letters), every invisible and bidi character
 * removed (ZWNJ included: it must not make two names different), spaces collapsed, lower-cased. Unicode-aware, so
 * Arabic-script text is untouched.
 */
export function supplierNameKey(name: string): string {
  return name.normalize('NFKC').replace(INVISIBLE, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

const text = (max: number, message: string) => z.string().transform(cleanText).pipe(z.string().max(max, message));
const multiline = (max: number, message: string) => z.string().transform(cleanMultiline).pipe(z.string().max(max, message));

export const supplierFields = z.object({
  name: z.string().transform(cleanText).pipe(z.string().min(1, 'Enter a name').max(120, 'Use at most 120 characters')),
  phone: text(40, 'Use at most 40 characters').default(''),
  contactName: text(120, 'Use at most 120 characters').default(''),
  addressNote: multiline(300, 'Use at most 300 characters').default(''),
  defaultCurrency: z.enum(['IQD', 'USD'], 'Choose IQD or USD'),
  termsDays: z.number(WHOLE).int(WHOLE).min(0, 'Use 0 or more').max(365, 'Use at most 365 days').default(0),
  note: multiline(500, 'Use at most 500 characters').default(''),
});
export type SupplierFields = z.infer<typeof supplierFields>;

/** Only the supplier's own fields from an action's whole input (which also carries the place, a key and a version). */
function fieldsOf(input: SupplierFields): SupplierFields {
  const { name, phone, contactName, addressNote, defaultCurrency, termsDays, note } = input;
  return { name, phone, contactName, addressNote, defaultCurrency, termsDays, note };
}

export const supplierListInput = z.object({
  search: z.string().trim().max(100, 'Use at most 100 characters').optional(),
  /** `true` (the default) lists live suppliers, `false` archived ones, `'all'` both. */
  active: z.union([z.boolean(), z.literal('all')]).default(true),
  cursor: z.string().min(1).max(64).nullish(),
});
export type SupplierListInput = z.infer<typeof supplierListInput>;

const notFound = () => new StudioError('NOT_FOUND', 'Supplier not found');
const exists = () => new StudioError('CONFLICT', 'This supplier already exists', { phCode: 'SUPPLIER_EXISTS', name: 'This supplier already exists' });
const keyMismatch = () => new StudioError('CONFLICT', 'This key was already used for a different supplier', { phCode: 'CLIENT_KEY_MISMATCH' });

export interface SupplierView {
  id: string;
  name: string;
  phone: string;
  contactName: string;
  addressNote: string;
  defaultCurrency: 'IQD' | 'USD';
  termsDays: number;
  active: boolean;
  note: string;
  version: number;
  createdAt: string;
}

const VIEW_SELECT = {
  id: true,
  name: true,
  phone: true,
  contactName: true,
  addressNote: true,
  defaultCurrency: true,
  termsDays: true,
  active: true,
  note: true,
  version: true,
  createdAt: true,
} as const;

function viewOf(row: { createdAt: Date } & Omit<SupplierView, 'createdAt'>): SupplierView {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    contactName: row.contactName,
    addressNote: row.addressNote,
    defaultCurrency: row.defaultCurrency,
    termsDays: row.termsDays,
    active: row.active,
    note: row.note,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface SupplierWrite {
  id: string;
  version: number;
  active: boolean;
  defaultCurrency: 'IQD' | 'USD';
  termsDays: number;
  replayed: boolean;
}

/** What identifies a create request apart from who made it: a repeat of a key must be this exactly. */
export function payloadHash(input: SupplierFields): string {
  const f = fieldsOf(input);
  const canonical = [f.name, f.phone, f.contactName, f.addressNote, f.defaultCurrency, f.termsDays, f.note];
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/** The supplier with the same name key, other than `exceptId`. */
async function nameTaken(tx: ScopedTx, nameKey: string, exceptId?: string): Promise<boolean> {
  const found = await tx.phSupplier.findFirst({ where: { nameKey, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true } });
  return found !== null;
}

/**
 * A new supplier, or the one the same `clientKey` already made (a repeat changes nothing). A repeat must come from the same
 * person with the same fields: anything else is `CLIENT_KEY_MISMATCH`. A name already used (ignoring case, spacing and
 * invisible characters) is `SUPPLIER_EXISTS`.
 */
export async function createSupplier(
  tx: ScopedTx,
  args: { restaurantId: string; userId: string; clientKey: string; input: SupplierFields },
): Promise<SupplierWrite> {
  const input = fieldsOf(args.input);
  const hash = payloadHash(input);
  // eslint-disable-next-line no-restricted-properties -- an advisory lock touches no tenant rows: it only serialises one client key
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${NS_CLIENT_KEY}::int, hashtext(${`${args.restaurantId}:${args.clientKey}`}))`;
  const earlier = await tx.phSupplier.findFirst({ where: { clientKey: args.clientKey } });
  if (earlier) {
    const sameFields =
      earlier.name === input.name &&
      earlier.phone === input.phone &&
      earlier.contactName === input.contactName &&
      earlier.addressNote === input.addressNote &&
      earlier.defaultCurrency === input.defaultCurrency &&
      earlier.termsDays === input.termsDays &&
      earlier.note === input.note;
    // The hash is of the original request, so an edit since does not turn a retry into a mismatch; rows without one are compared by their fields.
    const sameRequest = earlier.payloadHash !== null ? earlier.payloadHash === hash : sameFields;
    if (earlier.createdById !== args.userId || !sameRequest) throw keyMismatch();
    return { id: earlier.id, version: earlier.version, active: earlier.active, defaultCurrency: earlier.defaultCurrency, termsDays: earlier.termsDays, replayed: true };
  }
  const nameKey = supplierNameKey(input.name);
  if (await nameTaken(tx, nameKey)) throw exists();
  const made = await tx.phSupplier.create({
    data: { restaurantId: args.restaurantId, nameKey, clientKey: args.clientKey, createdById: args.userId, payloadHash: hash, ...input },
    select: { id: true, version: true, active: true, defaultCurrency: true, termsDays: true },
  });
  return { ...made, replayed: false };
}

export interface SupplierUpdate {
  id: string;
  version: number;
  before: { defaultCurrency: 'IQD' | 'USD'; termsDays: number };
  after: { defaultCurrency: 'IQD' | 'USD'; termsDays: number };
}

/** Saves the fields if the supplier is still at `expectedVersion` (`CONFLICT` otherwise); a name taken by another is `SUPPLIER_EXISTS`. */
export async function updateSupplier(
  tx: ScopedTx,
  args: { supplierId: string; expectedVersion: number; input: SupplierFields },
): Promise<SupplierUpdate> {
  const current = await tx.phSupplier.findFirst({ where: { id: args.supplierId }, select: { id: true, defaultCurrency: true, termsDays: true } });
  if (!current) throw notFound();
  const input = fieldsOf(args.input);
  const nameKey = supplierNameKey(input.name);
  if (await nameTaken(tx, nameKey, current.id)) throw exists();
  await updateWithVersion(tx.phSupplier, { id: current.id, version: args.expectedVersion, data: { ...input, nameKey }, entityType: 'PhSupplier' }, tx);
  return {
    id: current.id,
    version: args.expectedVersion + 1,
    before: { defaultCurrency: current.defaultCurrency, termsDays: current.termsDays },
    after: { defaultCurrency: input.defaultCurrency, termsDays: input.termsDays },
  };
}

export interface ArchiveResult {
  id: string;
  version: number;
  active: boolean;
  changed: boolean;
}

/** Hides a supplier from the pickers (`archived`) or brings it back. Open balances do not stop it. Already in that state: nothing changes. */
export async function archiveSupplier(tx: ScopedTx, args: { supplierId: string; archived: boolean }): Promise<ArchiveResult> {
  const current = await tx.phSupplier.findFirst({ where: { id: args.supplierId }, select: { id: true, active: true, version: true } });
  if (!current) throw notFound();
  const active = !args.archived;
  if (current.active === active) return { id: current.id, version: current.version, active, changed: false };
  await updateWithVersion(tx.phSupplier, { id: current.id, version: current.version, data: { active }, entityType: 'PhSupplier' }, tx);
  return { id: current.id, version: current.version + 1, active, changed: true };
}


/** One page of suppliers by name: live ones unless told otherwise, matching the search in the name or the phone. */
export async function listSuppliers(scoped: ScopedClient, input: SupplierListInput): Promise<{ items: SupplierView[]; nextCursor: string | null }> {
  const search = input.search ? cleanText(input.search) : '';
  const rows = await scoped.phSupplier.findMany({
    where: {
      ...(input.active === 'all' ? {} : { active: input.active }),
      ...(search
        ? { OR: [{ name: { contains: search, mode: 'insensitive' as const } }, { phone: { contains: search } }] }
        : {}),
    },
    select: VIEW_SELECT,
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    take: PAGE_SIZE + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 0 } : {}),
  });
  const page = rows.slice(0, PAGE_SIZE);
  return { items: page.map(viewOf), nextCursor: rows.length > PAGE_SIZE ? rows[PAGE_SIZE]!.id : null };
}

export async function getSupplier(scoped: ScopedClient, supplierId: string): Promise<SupplierView> {
  const row = await scoped.phSupplier.findFirst({ where: { id: supplierId }, select: VIEW_SELECT });
  if (!row) throw notFound();
  return viewOf(row);
}
