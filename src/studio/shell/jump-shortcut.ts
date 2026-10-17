/** The parts of a key press the shortcut reads. */
export type ShortcutKey = Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'key' | 'code'>;

/**
 * Whether a key press opens Jump to: Ctrl+K, or Cmd+K on a Mac, without Alt or Shift. The K is matched by the letter it
 * types and by the key's place on the keyboard (`code`), so the shortcut also works on layouts whose K key types another
 * letter, such as Arabic and Sorani, where it types ن or ک.
 */
export function isJumpShortcut(event: ShortcutKey): boolean {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return false;
  return event.key.toLowerCase() === 'k' || event.code === 'KeyK';
}
