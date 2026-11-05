/**
 * The cashier screen's keyboard mapping, pure (no DOM, no React). The guards of the old sale screen's keys: a key held
 * down (repeat) never fires twice, a key already handled (`defaultPrevented`, as a scanner's closing Enter is) and a key
 * pressed while an input method is composing (`isComposing`, keyCode 229) mean nothing, and nothing fires while a modal
 * is open. Function keys work everywhere; `*`, `/`, `+`, `-` and the line keys are hotkeys only outside a text field,
 * except `*` and `/` on an empty search field (the scanner wins in the search field).
 */

export type KeyEventLike = {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  repeat?: boolean;
  isComposing?: boolean;
  keyCode?: number;
  defaultPrevented?: boolean;
};

export type CashierKey =
  | {
      kind:
        | 'cash'
        | 'credit'
        | 'new'
        | 'unit'
        | 'inquiry'
        | 'hold'
        | 'discount'
        | 'focusScan'
        | 'escape'
        | 'addTop'
        | 'qtyUp'
        | 'qtyDown'
        | 'remove'
        | 'lineUp'
        | 'lineDown';
    }
  | { kind: 'switch'; index: number }
  | { kind: 'switchRel'; delta: 1 | -1 };

export type CashierKeyContext = { inSearch: boolean; inTextField: boolean; searchEmpty: boolean; modalOpen: boolean };

const FUNCTION_KEYS: Record<string, CashierKey['kind']> = {
  F2: 'cash',
  F3: 'credit',
  F4: 'new',
  F6: 'unit',
  F7: 'inquiry',
  F8: 'hold',
  F9: 'discount',
  Escape: 'escape',
};

export function cashierKeyOf(event: KeyEventLike, ctx: CashierKeyContext): CashierKey | null {
  if (ctx.modalOpen) return null;
  if (event.ctrlKey || event.metaKey || event.repeat || event.defaultPrevented) return null;
  if (event.isComposing || event.keyCode === 229) return null;

  if (event.altKey) {
    if (/^[1-6]$/.test(event.key)) return { kind: 'switch', index: Number(event.key) - 1 };
    // RTL: the tab to the left is the next one.
    if (event.key === 'ArrowLeft') return { kind: 'switchRel', delta: 1 };
    if (event.key === 'ArrowRight') return { kind: 'switchRel', delta: -1 };
    return null;
  }

  const fixed = FUNCTION_KEYS[event.key];
  if (fixed) return { kind: fixed } as CashierKey;

  // `*` and `/` also work on an empty search field; every other plain key only outside a text field.
  const scanFieldFree = !ctx.inTextField || (ctx.inSearch && ctx.searchEmpty);
  switch (event.key) {
    case 'Enter':
      return ctx.inSearch && !event.shiftKey ? { kind: 'addTop' } : null;
    case '*':
      return scanFieldFree ? { kind: 'unit' } : null;
    case '/':
      return scanFieldFree ? { kind: 'focusScan' } : null;
    case '+':
      return ctx.inTextField ? null : { kind: 'qtyUp' };
    case '-':
      return ctx.inTextField ? null : { kind: 'qtyDown' };
    case 'Delete':
      return ctx.inTextField ? null : { kind: 'remove' };
    case 'ArrowUp':
      return ctx.inTextField ? null : { kind: 'lineUp' };
    case 'ArrowDown':
      return ctx.inTextField ? null : { kind: 'lineDown' };
    default:
      return null;
  }
}
