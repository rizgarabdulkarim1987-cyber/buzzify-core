const KEY = 'pos.bridgeUrl';
export const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:9101';

/** Only this PC's own bridge is ever called: a saved address that points elsewhere is ignored. */
const LOCAL = /^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}$/;

export function readBridgeUrl(): string {
  try {
    const saved = localStorage.getItem(KEY);
    return saved && LOCAL.test(saved) ? saved : DEFAULT_BRIDGE_URL;
  } catch {
    return DEFAULT_BRIDGE_URL;
  }
}

/** Returns whether the address was accepted and saved. */
export function writeBridgeUrl(url: string): boolean {
  const trimmed = url.trim().replace(/\/$/, '');
  if (!LOCAL.test(trimmed)) return false;
  try {
    localStorage.setItem(KEY, trimmed);
    return true;
  } catch {
    return false;
  }
}
