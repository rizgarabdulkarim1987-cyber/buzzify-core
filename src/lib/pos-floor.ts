import type { TableStatus } from '@/server/domain/pos/table-status';

/**
 * The till's ten arrangements of the tables screen (docs/superpowers/specs/2026-10-26-pos-calm-layouts-design.md). The
 * choice is per device, in a cookie the server reads, so the first paint is already the chosen layout.
 */
export const LAYOUTS = ['tiles', 'strip', 'register', 'keypad', 'dock', 'groups', 'order', 'zones', 'night', 'slips'] as const;

export type LayoutId = (typeof LAYOUTS)[number];

export const DEFAULT_LAYOUT: LayoutId = 'tiles';
export const LAYOUT_COOKIE = 'pos-layout';

export function isLayoutId(value: unknown): value is LayoutId {
  return typeof value === 'string' && (LAYOUTS as readonly string[]).includes(value);
}

/**
 * The cashier's look on a big screen: the shell (where the pages menu sits), the tables screen, the order screen and every
 * list wear it. A per-device cookie like the layout, read by the server. Phones keep their own layout.
 */
export const DESKS = ['classic', 'photo', 'rows', 'cards', 'split', 'board', 'register', 'stack'] as const;
export type DeskId = (typeof DESKS)[number];
export const DEFAULT_DESK: DeskId = 'classic';
export const DESK_COOKIE = 'pos-desk';

/** The tables arrangement a look goes with: choosing a look sets it too, and it can still be changed after. */
export const DESK_LAYOUT: Partial<Record<DeskId, LayoutId>> = { photo: 'tiles', rows: 'register', cards: 'tiles', split: 'order', board: 'groups', register: 'keypad', stack: 'slips' };

export function deskOf(value: string | undefined): DeskId {
  return (DESKS as readonly string[]).includes(value ?? '') ? (value as DeskId) : DEFAULT_DESK;
}

export function layoutOf(value: string | undefined): LayoutId {
  return isLayoutId(value) ? value : DEFAULT_LAYOUT;
}

/** The layouts whose board has a bill area: a press on a busy table selects it first. */
export const SELECTING: ReadonlySet<LayoutId> = new Set(['tiles', 'register', 'dock', 'night']);

const TILE_GAP = 10;
/** Below this a tile's number stops reading across the room: the box scrolls instead of shrinking the tiles further. */
const MIN_TILE = 84;
/** Above this a tile only wastes the room: a small floor stays a centred block of comfortable tiles. */
const MAX_TILE = 240;

export const TILE_GAP_PX = TILE_GAP;

export type TileFit = { cols: number; side: number; overflow: boolean };

/**
 * The column count and side of the biggest square tiles that fit `count` of them in a `width` by `height` box, capped at
 * a comfortable size. Below the smallest readable side the box scrolls instead (`overflow`).
 */
export function fitTiles(count: number, width: number, height: number): TileFit {
  const n = Math.max(count, 1);
  let best = 0;
  let cols = 1;
  for (let c = 1; c <= n; c++) {
    const rows = Math.ceil(n / c);
    const side = Math.min((width - (c - 1) * TILE_GAP) / c, (height - (rows - 1) * TILE_GAP) / rows);
    if (side > best) {
      best = side;
      cols = c;
    }
  }
  if (best >= MIN_TILE) return { cols, side: Math.floor(Math.min(best, MAX_TILE)), overflow: false };
  const fitCols = Math.max(1, Math.floor((width + TILE_GAP) / (MIN_TILE + TILE_GAP)));
  return { cols: fitCols, side: Math.floor((width - (fitCols - 1) * TILE_GAP) / fitCols), overflow: true };
}

export type FloorTableState = { number: number; status: TableStatus; pendingRequests: number };

const QUEUE_ORDER = { PENDING_APPROVAL: 0, BILL_REQUESTED: 1, READY: 2 } as const;

export type Need = keyof typeof QUEUE_ORDER;

/** Why a table waits for the cashier: a waiting QR request whatever its state, else a bill asked for or food ready. */
export function needOf(table: FloorTableState): Need | null {
  if (table.pendingRequests > 0) return 'PENDING_APPROVAL';
  if (table.status === 'PENDING_APPROVAL' || table.status === 'BILL_REQUESTED' || table.status === 'READY') return table.status;
  return null;
}

/** "Waiting for you": new QR orders, then bills asked for, then food ready; by table number within each. */
export function queueOf<T extends FloorTableState>(tables: readonly T[]): { table: T; need: Need }[] {
  return tables
    .map((table) => ({ table, need: needOf(table) }))
    .filter((item): item is { table: T; need: Need } => item.need !== null)
    .sort((a, b) => QUEUE_ORDER[a.need] - QUEUE_ORDER[b.need] || a.table.number - b.table.number);
}

/** The tables that need the cashier first, then the busy ones, then the free ones; by number within each. */
export function openFirst<T extends FloorTableState>(tables: readonly T[]): T[] {
  const rank = (t: T) => {
    const need = needOf(t);
    return need !== null ? QUEUE_ORDER[need] : t.status === 'FREE' ? 4 : 3;
  };
  return [...tables].sort((a, b) => rank(a) - rank(b) || a.number - b.number);
}

/** A table seated longer than the owner's "table ring minutes" shows its time as late. */
export function isLate(minutes: number | null, ringMinutes: number): boolean {
  return minutes !== null && ringMinutes > 0 && minutes >= ringMinutes;
}
