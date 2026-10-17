import { useCallback, useRef, useState } from 'react';

/**
 * Search text in every language, fetched the first time the search box is used (see `buildSearchIndex`).
 * Until it arrives, search still works on the text the page already carries. A failed request is retried
 * the next time the box is used. A Studio preview (`enabled` false) searches the page text only.
 */
export function useSearchIndex(slug: string, enabled = true): { keys: Record<string, string> | null; load: () => void } {
  const [keys, setKeys] = useState<Record<string, string> | null>(null);
  const started = useRef(false);

  const load = useCallback(() => {
    if (started.current || !enabled) return;
    started.current = true;
    fetch(`/api/${slug}/search-index`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
      .then((response) => {
        if (!response.ok) throw new Error(`search index ${response.status}`);
        return response.json() as Promise<{ keys: Record<string, string> }>;
      })
      .then((body) => setKeys(body.keys))
      .catch(() => {
        started.current = false;
      });
  }, [slug, enabled]);

  return { keys, load };
}
