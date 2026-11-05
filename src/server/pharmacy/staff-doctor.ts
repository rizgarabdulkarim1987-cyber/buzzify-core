import { z } from 'zod';
import type { ScopedClient, ScopedTx } from '@/server/data/tenant-db';
import { RX_ONLY_INGREDIENTS, rxOnlyTermOf } from '@/server/domain/pharmacy/doctor';
import { canPh, type PhRole } from '@/server/domain/pharmacy/permissions';
import { StudioError } from '@/server/studio/framework/result';
import type { PhActor } from './actor';

/**
 * The owner's control of the AI Doctor (plan Task 9).
 *
 * The switch: `PhStaff.aiDoctor`, one per person of the business. Only the OWNER flips it (ruling 1: the owner decides who uses
 * the Doctor; a branch manager holds `staff.manage` and still may not), and only for a person whose role grants `ai.use`. The
 * Doctor reads the switch from the person's identity, which is resolved again on every request, so a switch turned off refuses
 * the very next question.
 *
 * The list: the people the asker may see (a branch-limited manager sees the people of their own branches, with those branches
 * only), a name and never an email, the owner first and always on.
 *
 * The review: the business's active OTC products whose trade name, generic name or active ingredient names a prescription-only
 * ingredient of `RX_ONLY_INGREDIENTS`, so the owner can correct their `rxLevel` before switching the Doctor on.
 */

export const setDoctorInput = z.object({
  staffId: z.string().min(1).max(64),
  on: z.boolean(),
});

export const DOCTOR_SWITCH_TEXT = {
  OWNER_ONLY: 'Only the owner can turn the AI Doctor on or off',
  NOT_ELIGIBLE: 'This role cannot use the AI Doctor',
  NOT_FOUND: 'Staff member not found',
} as const;

function assertPerson(ph: PhActor): asserts ph is PhActor & { role: PhRole } {
  if (ph.support !== null || ph.role === null) throw new StudioError('FORBIDDEN');
}

/** The owner of ruling 1: the Studio membership's OWNER, never a staff row that happens to carry the OWNER role. */
function isStudioOwner(ph: PhActor): boolean {
  return ph.role === 'OWNER' && ph.viaMembership;
}

/** Turns one person's switch on or off; returns the value before and after, for the audit. */
export async function setStaffDoctor(tx: ScopedTx, ph: PhActor, input: z.infer<typeof setDoctorInput>): Promise<{ before: boolean; after: boolean }> {
  assertPerson(ph);
  if (!isStudioOwner(ph)) throw new StudioError('FORBIDDEN', DOCTOR_SWITCH_TEXT.OWNER_ONLY);
  const row = await tx.phStaff.findFirst({ where: { id: input.staffId, deactivatedAt: null }, select: { id: true, userId: true, role: true, aiDoctor: true } });
  if (!row) throw new StudioError('NOT_FOUND', DOCTOR_SWITCH_TEXT.NOT_FOUND);
  const owner = await tx.membership.findFirst({ where: { userId: row.userId, role: 'OWNER' }, select: { id: true } });
  if (owner || row.role === 'OWNER' || !canPh(row.role, 'ai.use')) throw new StudioError('INVALID', DOCTOR_SWITCH_TEXT.NOT_ELIGIBLE);
  // Conditional: under two flips at once only one changes the row, and the other reads that it was already set, so the audit's
  // `before` is what the row really held.
  const { count } = await tx.phStaff.updateMany({ where: { id: row.id, aiDoctor: !input.on }, data: { aiDoctor: input.on } });
  return { before: count === 1 ? !input.on : input.on, after: input.on };
}

export interface StaffDoctorRow {
  kind: 'OWNER' | 'STAFF';
  /** The staff row's id (what the switch names); null for an owner through the Studio membership. */
  staffId: string | null;
  name: string;
  role: PhRole;
  allBranches: boolean;
  /** The person's branches the asker may see. */
  branches: { id: string; name: string }[];
  aiDoctor: boolean;
  /** Whether the role grants `ai.use`: the switch means something only then. */
  eligible: boolean;
}

export interface StaffDoctorList {
  /** Whether the asker may flip the switches (the owner, ruling 1). The action checks it again. */
  canEdit: boolean;
  /** Whether the plan carries an AI budget: without one nobody is answered, whatever the switches say. */
  inPlan: boolean;
  rows: StaffDoctorRow[];
}

const byName = <T extends { name: string }>(x: T, y: T) => x.name.localeCompare(y.name);

export async function staffDoctorList(scoped: ScopedClient, ph: PhActor, inPlan: boolean): Promise<StaffDoctorList> {
  assertPerson(ph);
  // Branch-scoped: a branch-limited asker reads only the links to their own branches, so other branches' people never show.
  const links = await scoped.phStaffBranch.findMany({ select: { staffId: true, branchId: true } });
  const staffIds = [...new Set(links.map((l) => l.staffId))];
  const [staff, branches, owners] = await Promise.all([
    scoped.phStaff.findMany({ where: { id: { in: staffIds }, deactivatedAt: null }, select: { id: true, userId: true, role: true, aiDoctor: true } }),
    scoped.branch.findMany({ where: { id: { in: [...new Set(links.map((l) => l.branchId))] } }, select: { id: true, name: true, sortOrder: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    scoped.membership.findMany({ where: { role: 'OWNER' }, select: { userId: true } }),
  ]);
  const ownerIds = new Set(owners.map((o) => o.userId));
  const users = await scoped.user.findMany({
    where: { id: { in: [...new Set([...ownerIds, ...staff.map((s) => s.userId)])] }, deactivatedAt: null },
    select: { id: true, name: true },
  });
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  const branchOrder = branches.map((b) => ({ id: b.id, name: b.name }));

  const ownerRows: StaffDoctorRow[] = [...ownerIds]
    .filter((id) => nameOf.has(id))
    .map((id) => ({ kind: 'OWNER' as const, staffId: null, name: nameOf.get(id)!, role: 'OWNER' as const, allBranches: true, branches: [], aiDoctor: true, eligible: true }))
    .sort(byName);
  const staffRows: StaffDoctorRow[] = staff
    .filter((s) => !ownerIds.has(s.userId) && nameOf.has(s.userId))
    .map((s) => {
      const mine = new Set(links.filter((l) => l.staffId === s.id).map((l) => l.branchId));
      return {
        kind: 'STAFF' as const,
        staffId: s.id,
        name: nameOf.get(s.userId)!,
        role: s.role,
        allBranches: false,
        branches: branchOrder.filter((b) => mine.has(b.id)),
        aiDoctor: s.aiDoctor,
        eligible: canPh(s.role, 'ai.use'),
      };
    })
    .sort(byName);
  return { canEdit: isStudioOwner(ph), inPlan, rows: [...ownerRows, ...staffRows] };
}

/** How many OTC products the review reads at most; a bigger catalog is reviewed in part and says so (`truncated`). */
export const RX_REVIEW_SCAN_MAX = 20_000;
/** How many matches the review lists at most. */
export const RX_REVIEW_LIST_MAX = 200;
const PAGE = 1000;

export interface RxReviewItem {
  productId: string;
  tradeName: string;
  genericName: string;
  activeIngredient: string;
  strength: string;
  form: string;
  /** The prescription-only ingredient it names, as the list writes it. */
  matched: string;
}

export async function rxReview(scoped: ScopedClient, ph: PhActor): Promise<{ items: RxReviewItem[]; truncated: boolean }> {
  assertPerson(ph);
  if (!canPh(ph.role, 'catalog.manage')) throw new StudioError('FORBIDDEN');
  const items: RxReviewItem[] = [];
  let read = 0;
  let scannedAll = true;
  let cursor: string | undefined;
  for (;;) {
    const rows = await scoped.phProduct.findMany({
      where: { rxLevel: 'OTC', active: true },
      select: { id: true, tradeName: true, genericName: true, activeIngredient: true, strength: true, form: true },
      orderBy: { id: 'asc' },
      take: PAGE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    for (const r of rows) {
      const matched = rxOnlyTermOf(r.tradeName, r.genericName, r.activeIngredient);
      if (matched) items.push({ productId: r.id, tradeName: r.tradeName, genericName: r.genericName, activeIngredient: r.activeIngredient, strength: r.strength, form: r.form, matched });
    }
    read += rows.length;
    if (rows.length < PAGE) break;
    cursor = rows.at(-1)!.id;
    if (read >= RX_REVIEW_SCAN_MAX) {
      // The scan stops here; it is cut short only when a product is left unread.
      scannedAll = (await scoped.phProduct.count({ where: { rxLevel: 'OTC', active: true, id: { gt: cursor } } })) === 0;
      break;
    }
  }
  return { items: orderRxReview(items).slice(0, RX_REVIEW_LIST_MAX), truncated: !scannedAll || items.length > RX_REVIEW_LIST_MAX };
}

/**
 * The review's order, which also decides what the cut to `RX_REVIEW_LIST_MAX` keeps: by the place of the matched ingredient in
 * `RX_ONLY_INGREDIENTS` (antibiotics first, as the list is written), then by trade name.
 */
export function orderRxReview(items: RxReviewItem[]): RxReviewItem[] {
  const rank = (term: string) => {
    const at = RX_ONLY_INGREDIENTS.indexOf(term);
    return at === -1 ? RX_ONLY_INGREDIENTS.length : at;
  };
  return [...items].sort((x, y) => rank(x.matched) - rank(y.matched) || x.tradeName.localeCompare(y.tradeName));
}
