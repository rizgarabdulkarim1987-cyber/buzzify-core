import type { Shape } from '@/lib/appearance';

/** The two calls of `Storage` the cache makes, so a test can pass a stand-in. */
export interface CacheStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface CachedAppearance {
  vars: Record<string, string>;
  shape: Shape | null;
}

const LAST = 'pos-appearance:last';
const keyOf = (userId: string) => `pos-appearance:${userId}`;

/**
 * Keeps a person's look on this device so the offline till, which has no session to ask the server, can wear it. Storage
 * that is blocked or full is ignored: the till then looks like the default, which is still a working till.
 */
export function storeAppearance(userId: string, vars: Record<string, string>, shape: Shape | null, storage: CacheStorage): void {
  try {
    if (Object.keys(vars).length === 0) {
      storage.removeItem(keyOf(userId));
    } else {
      storage.setItem(keyOf(userId), JSON.stringify({ vars, shape }));
    }
    storage.setItem(LAST, userId);
  } catch {
    // Storage is blocked or full.
  }
}

/** Only the Studio's own custom properties come back: whatever else a stored value held is not applied. */
function parse(raw: string | null): CachedAppearance | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as { vars?: unknown; shape?: unknown };
    if (!value.vars || typeof value.vars !== 'object') return null;
    const vars: Record<string, string> = {};
    for (const [name, v] of Object.entries(value.vars)) {
      if (name.startsWith('--s-') && typeof v === 'string' && v.length <= 200) vars[name] = v;
    }
    if (Object.keys(vars).length === 0) return null;
    return { vars, shape: value.shape === 'round' || value.shape === 'square' ? value.shape : null };
  } catch {
    return null;
  }
}

/** The look stored for `userId`, or for whoever used the till last when no one is named (the offline page knows no one). */
export function restoreAppearance(userId: string | null, storage: CacheStorage): CachedAppearance | null {
  try {
    const who = userId ?? storage.getItem(LAST);
    return who ? parse(storage.getItem(keyOf(who))) : null;
  } catch {
    return null;
  }
}
