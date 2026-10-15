import { unstable_cache } from 'next/cache';

/** Uses the Next.js data cache inside the Next runtime and calls straight through elsewhere (tests, scripts). */
export function cached<T>(
  fn: () => Promise<T>,
  keyParts: string[],
  options: { revalidate: number; tags: string[] },
): () => Promise<T> {
  if (!process.env.NEXT_RUNTIME) return fn;
  return unstable_cache(fn, keyParts, options);
}
