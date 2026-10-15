export const ART_KINDS = ['cup', 'glass', 'plate', 'pastry', 'bowl', 'burger'] as const;
export type ArtKind = (typeof ART_KINDS)[number];

export type MediaItem =
  | { kind: 'art'; art: ArtKind; tone: string }
  | { kind: 'image'; url: string; alt: string; width: number; height: number }
  | { kind: 'video'; url: string; poster: string }
  | { kind: 'model3d'; url: string; poster: string };

/** Same-origin paths and https URLs only. Protocol-relative and script URLs are rejected. */
function isSafeUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value.startsWith('//')) return false;
  return value.startsWith('/') || value.startsWith('https://');
}

export function parseMedia(raw: unknown): MediaItem[] {
  if (!Array.isArray(raw)) return [];
  const items: MediaItem[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const v = entry as Record<string, unknown>;
    if (v.kind === 'art') {
      if ((ART_KINDS as readonly unknown[]).includes(v.art) && typeof v.tone === 'string' && /^#[0-9a-fA-F]{6}$/.test(v.tone)) {
        items.push({ kind: 'art', art: v.art as ArtKind, tone: v.tone });
      }
    } else if (v.kind === 'image') {
      if (isSafeUrl(v.url) && typeof v.alt === 'string' && Number.isFinite(v.width) && Number.isFinite(v.height)) {
        items.push({ kind: 'image', url: v.url, alt: v.alt, width: Number(v.width), height: Number(v.height) });
      }
    } else if (v.kind === 'video' || v.kind === 'model3d') {
      if (isSafeUrl(v.url) && isSafeUrl(v.poster)) items.push({ kind: v.kind, url: v.url, poster: v.poster });
    }
  }
  return items;
}
