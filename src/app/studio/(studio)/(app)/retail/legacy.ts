import { notFound, redirect } from 'next/navigation';
import { RETAIL_HANDOFF } from '@/studio/nav';
import { oldRetailAddressOf, OLD_RETAIL_PREFIX } from '@/studio/spaces';

type Search = Record<string, string | string[] | undefined>;

/**
 * An address of the old single Retail space (`/studio/retail/...`, a bookmark or an old link) goes to the same page of the
 * Supermarket's space, its query kept: every shop of that time is a supermarket, and a shop of another product moves on
 * from there to its own space. The owners' sign-in handoff (`open`, `continue`, `choose`) keeps the old prefix and is not
 * redirected.
 */
export async function redirectOldRetail(segments: readonly string[], searchParams: Promise<Search>): Promise<never> {
  const path = [OLD_RETAIL_PREFIX, ...segments.map(encodeURIComponent)].join('/');
  const target = oldRetailAddressOf(path, RETAIL_HANDOFF);
  if (!target) notFound();
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const one of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, one);
  }
  const search = query.toString();
  redirect(search ? `${target}?${search}` : target);
}
