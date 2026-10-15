import type { EventType } from '@/server/data/events';

interface Config {
  slug: string;
  table: number | null;
}

interface QueuedEvent {
  type: EventType;
  productId?: string;
  suggestionId?: string;
  payload: Record<string, unknown>;
}

let config: Config | null = null;
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

export function configureTracking(next: Config): void {
  config = next;
  if (!listening && typeof document !== 'undefined') {
    listening = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushTracking();
    });
  }
}

export function track(
  type: EventType,
  data: { productId?: string; suggestionId?: string; payload?: Record<string, unknown> } = {},
  options: { once?: boolean } = {},
): void {
  if (!config) return;
  if (options.once) {
    const key = `${type}:${data.suggestionId ?? data.productId ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
  }
  queue.push({ type, productId: data.productId, suggestionId: data.suggestionId, payload: data.payload ?? {} });
  if (queue.length >= 10) flushTracking();
  else timer ??= setTimeout(flushTracking, 2000);
}

export function resetTrackingForTests(): void {
  config = null;
  queue = [];
  seen.clear();
  memorySession = null;
  if (timer) clearTimeout(timer);
  timer = null;
}
