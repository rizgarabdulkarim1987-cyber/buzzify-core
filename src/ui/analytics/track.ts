import type { EventType } from '@/server/data/events';

interface Config {
  slug: string;
  table: number | null;
}

interface QueuedEvent {
  type: EventType;
  productId?: string;
  suggestionId?: string;
  qrCodeId?: string;
  payload: Record<string, unknown>;
}

let config: Config | null = null;
let qrRead = false;
let queue: QueuedEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let memorySession: string | null = null;
let listening = false;
const seen = new Set<string>();

function sessionId(): string {
  try {
    const existing = sessionStorage.getItem('buzzify:sid');
    if (existing) return existing;
    const created = crypto.randomUUID();
    sessionStorage.setItem('buzzify:sid', created);
    return created;
  } catch {
    memorySession ??= globalThis.crypto?.randomUUID?.() ?? `m-${Math.random().toString(36).slice(2)}-${Date.now()}`;
    return memorySession;
  }
}

export function flushTracking(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (!config || queue.length === 0) return;
  const batch = queue.splice(0, 20);
  try {
    void fetch(`/api/${config.slug}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ anonymousSessionId: sessionId(), tableNumber: config.table, events: batch }),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Analytics must never affect the menu.
  }
  if (queue.length > 0) flushTracking();
}

/** Events recorded before tracking is configured are kept, up to this many, and sent once it is. */
const MAX_PENDING = 50;

export function configureTracking(next: Config): void {
  config = next;
  if (queue.length > 0) timer ??= setTimeout(flushTracking, 2000);
  if (!listening && typeof document !== 'undefined') {
    listening = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushTracking();
    });
  }
}

const QR_CODE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * The printed QR code this page was opened from (`?qr=`), once per page load: the parameter is then taken out of the
 * address, so a reload, a shared link or a bookmark does not count as another scan.
 */
function scannedCode(): string | undefined {
  if (qrRead) return undefined;
  qrRead = true;
  try {
    const url = new URL(location.href);
    const code = url.searchParams.get('qr');
    if (code === null) return undefined;
    url.searchParams.delete('qr');
    history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
    return QR_CODE_ID.test(code) ? code : undefined;
  } catch {
    return undefined;
  }
}

export function track(
  type: EventType,
  data: { productId?: string; suggestionId?: string; payload?: Record<string, unknown> } = {},
  options: { once?: boolean } = {},
): void {
  if (!config && queue.length >= MAX_PENDING) return;
  if (options.once) {
    const key = `${type}:${data.suggestionId ?? data.productId ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
  }
  const qrCodeId = type === 'MENU_VIEW' ? scannedCode() : undefined;
  queue.push({ type, productId: data.productId, suggestionId: data.suggestionId, ...(qrCodeId ? { qrCodeId } : {}), payload: data.payload ?? {} });
  // A child component's effect runs before the provider that configures tracking, so wait for it.
  if (!config) return;
  if (queue.length >= 10) flushTracking();
  else timer ??= setTimeout(flushTracking, 2000);
}

export function resetTrackingForTests(): void {
  config = null;
  qrRead = false;
  queue = [];
  seen.clear();
  memorySession = null;
  if (timer) clearTimeout(timer);
  timer = null;
}
