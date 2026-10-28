export type Shortcut = 'search' | 'pay' | 'close';

interface ShortcutEvent {
  key: string;
  target: { tagName?: string; isContentEditable?: boolean } | null;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

const FIELDS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/**
 * What a key press does on the order screen: `/` jumps to the menu search, F2 opens payment, Escape closes what is open.
 * Typing in a field never triggers a shortcut (Escape still closes), and a key held with ctrl, meta or alt belongs to the
 * browser.
 */
export function shortcutFor(event: ShortcutEvent): Shortcut | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  if (event.key === 'Escape') return 'close';
  const typing = event.target !== null && (FIELDS.has(event.target.tagName ?? '') || event.target.isContentEditable === true);
  if (typing) return null;
  if (event.key === '/') return 'search';
  if (event.key === 'F2') return 'pay';
  return null;
}
