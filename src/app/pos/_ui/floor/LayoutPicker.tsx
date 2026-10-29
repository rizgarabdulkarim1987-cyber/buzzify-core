'use client';

import { Check, LayoutDashboard } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type CSSProperties, type ReactNode } from 'react';
import { LAYOUT_COOKIE, LAYOUTS, type DeskId, type LayoutId } from '@/lib/pos-floor';
import { useT } from '@/studio/i18n';
import { Dialog } from '@/studio/ui/Dialog';
import { DeskSection } from '@/app/pos/_ui/DeskPicker';

const YEAR = 60 * 60 * 24 * 365;

function save(id: LayoutId) {
  document.cookie = `${LAYOUT_COOKIE}=${id}; path=/; max-age=${YEAR}; samesite=lax`;
}

const box = (key: string | number, style: CSSProperties, dark = false) => (
  <span key={key} className="wire block" style={{ ...style, ...(dark ? { background: 'var(--s-muted)' } : null) }} />
);
const tiles = (n: number, cols: number) => (
  <span className="grid flex-1 gap-[3px]" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
    {Array.from({ length: n }, (_, i) => box(i, {}, i === 2))}
  </span>
);

/** A small sketch of each arrangement, so the choice is seen rather than read. */
const WIRES: Record<LayoutId, ReactNode> = {
  tiles: (
    <span className="flex h-full gap-[3px]">
      {tiles(12, 4)}
      {box('s', { width: '30%' })}
    </span>
  ),
  strip: (
    <span className="flex h-full flex-col gap-[3px]">
      {box('s', { height: '18%' })}
      {tiles(12, 6)}
    </span>
  ),
  register: (
    <span className="flex h-full gap-[3px]">
      <span className="grid flex-1 grid-cols-2 gap-[3px]">{Array.from({ length: 12 }, (_, i) => box(i, { height: 5 }))}</span>
      {box('s', { width: '28%' })}
    </span>
  ),
  keypad: (
    <span className="flex h-full gap-[3px]">
      <span className="flex flex-1 flex-col gap-[3px]">{Array.from({ length: 4 }, (_, i) => box(i, { height: 8 }))}</span>
      <span className="grid w-[40%] grid-cols-3 gap-[3px]">{Array.from({ length: 12 }, (_, i) => box(i, {}))}</span>
    </span>
  ),
  dock: (
    <span className="flex h-full flex-col gap-[3px]">
      {tiles(12, 6)}
      {box('s', { height: '20%' })}
    </span>
  ),
  groups: (
    <span className="flex h-full flex-col gap-[3px]">
      <span className="grid flex-1 grid-cols-5 gap-[3px]">{Array.from({ length: 5 }, (_, i) => box(i, {}, i === 1))}</span>
      <span className="grid h-[22%] grid-cols-7 gap-[3px]">{Array.from({ length: 7 }, (_, i) => box(i, {}))}</span>
    </span>
  ),
  order: (
    <span className="flex h-full gap-[3px]">
      {box('t', { width: '26%' })}
      <span className="grid flex-1 grid-cols-3 gap-[3px]">{Array.from({ length: 6 }, (_, i) => box(i, {}))}</span>
      <span className="flex w-[10%] flex-col gap-[3px]">{Array.from({ length: 8 }, (_, i) => box(i, { flex: 1 }))}</span>
    </span>
  ),
  zones: (
    <span className="flex h-full flex-col gap-[3px]">
      {tiles(6, 6)}
      {tiles(3, 6)}
      {tiles(4, 4)}
    </span>
  ),
  night: (
    <span className="flex h-full gap-[3px] rounded-[4px] bg-[#161616] p-[3px]">
      <span className="grid flex-1 grid-cols-6 gap-[3px]">
        {Array.from({ length: 12 }, (_, i) => (
          <span key={i} className="block rounded-[3px]" style={{ background: i === 2 ? '#c8262c' : '#2a2a2a' }} />
        ))}
      </span>
      <span className="block w-[30%] rounded-[3px] bg-[#1e1e1e]" />
    </span>
  ),
  slips: (
    <span className="flex h-full flex-col gap-[3px]">
      <span className="grid flex-1 grid-cols-5 gap-[3px]">{Array.from({ length: 5 }, (_, i) => box(i, { borderTop: '3px solid var(--s-muted)' }))}</span>
      {box('f', { height: '16%' })}
    </span>
  ),
};

/** The header button that picks this device's layout of the tables screen. The choice applies at once (a refresh). */
export function LayoutPicker({ current, desk }: { current: LayoutId; desk: DeskId }) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function choose(id: LayoutId) {
    save(id);
    startTransition(() => router.refresh());
  }

  return (
    <>
      <button
        type="button"
        data-testid="layout-picker"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 items-center gap-2 rounded-md border border-line-strong px-3 text-base font-medium text-text hover:bg-hover"
      >
        <LayoutDashboard size={18} aria-hidden="true" />
        {t('pos.layout.open')}
      </button>
      <Dialog open={open} onOpenChange={setOpen} title={t('pos.layout.title')} description={t('pos.layout.subtitle')} width="md">
        <h3 className="mb-3 text-base font-bold">{t('pos.layout.sectionTables')}</h3>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-busy={pending || undefined}>
          {LAYOUTS.map((id) => {
            const on = id === current;
            return (
              <li key={id}>
                <button
                  type="button"
                  data-layout-option={id}
                  aria-pressed={on}
                  disabled={pending}
                  onClick={() => choose(id)}
                  className="layout-option flex w-full flex-col gap-2 rounded-xl p-2 text-start"
                >
                  <span aria-hidden="true" className="relative block aspect-[16/10] w-full">
                    {WIRES[id]}
                    {on ? (
                      <span className="absolute end-1 top-1 grid size-6 place-items-center rounded-full bg-ink text-on-ink">
                        <Check size={16} />
                      </span>
                    ) : null}
                  </span>
                  <span className="px-1 text-sm font-bold">{t(`pos.layout.name.${id}`)}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <DeskSection current={desk} />
      </Dialog>
    </>
  );
}
