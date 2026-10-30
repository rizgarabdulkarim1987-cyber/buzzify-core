import type { ScopedClient } from '@/server/data/tenant-db';
import type { PhActor } from './actor';
import { userNamesFor } from './report-exports';
import { scopeOf } from './reports-common';

/**
 * The names a report screen needs for the ids its rows carry (phase 6, task 6): the branches of the report, and the products,
 * categories and sellers the rows name. Looked up inside the business through the scoped client; a user is named only if they
 * belong to the business (`userNamesFor`). An id that is not found has no entry, so the screen never invents a name.
 */
export interface ReportLabels {
  branch: Record<string, string>;
  product: Record<string, string>;
  category: Record<string, string>;
  user: Record<string, string>;
}

export async function reportLabels(
  scoped: ScopedClient,
  ph: PhActor,
  place: { branchId?: string | undefined },
  ids: { products?: Iterable<string>; categories?: Iterable<string>; users?: Iterable<string> } = {},
): Promise<ReportLabels> {
  const products = [...new Set(ids.products ?? [])].filter(Boolean);
  const categories = [...new Set(ids.categories ?? [])].filter(Boolean);
  const [branches, productRows, categoryRows, users] = await Promise.all([
    scoped.branch.findMany({ where: { id: { in: scopeOf(ph, place.branchId).branchIds } }, select: { id: true, name: true } }),
    products.length ? scoped.phProduct.findMany({ where: { id: { in: products } }, select: { id: true, tradeName: true } }) : Promise.resolve([]),
    categories.length ? scoped.phCategory.findMany({ where: { id: { in: categories } }, select: { id: true, name: true } }) : Promise.resolve([]),
    userNamesFor(scoped, ph.restaurantId, [...new Set(ids.users ?? [])]),
  ]);
  return {
    branch: Object.fromEntries(branches.map((b) => [b.id, b.name])),
    product: Object.fromEntries(productRows.map((p) => [p.id, p.tradeName])),
    category: Object.fromEntries(categoryRows.map((c) => [c.id, c.name])),
    user: Object.fromEntries(users),
  };
}
