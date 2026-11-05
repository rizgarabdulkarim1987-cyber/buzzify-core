'use client';

import { Check, LayoutDashboard } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type CSSProperties, type ReactNode } from 'react';
import { useT } from '@/studio/i18n';
import { Dialog } from '@/studio/ui/Dialog';
import { PH_BTN } from './sell-parts';
import { LOOK_COOKIE, LOOKS, type SellLook } from './sell-look';

const YEAR = 60 * 60 * 24 * 365;

function save(id: SellLook) {
  document.cookie = `${LOOK_COOKIE}=${id}; path=/; max-age=${YEAR}; samesite=lax`;
}

const box = (key: string | number, style?: CSSProperties, strong = false) => (
  <span key={key} className={`block rounded-[3px] ${strong ? 'bg-ph-muted' : 'bg-ph-line'}`} style={style} />
);
const grid = (n: number, cols: number) => (
  <span className="grid flex-1 content-start gap-[3px]" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
    {Array.from({ length: n }, (_, i) => box(i, { height: 9 }, i === 1))}
  </span>
);
const bar = (key: string, strong = false) => box(key, { height: 8, flex: 'none' }, strong);
const cart = (width = '30%') => box('cart', { width, flex: 'none' });

/** A small sketch of each look, so the choice is seen rather than read: the search bar, the results and the cart. */
const SKETCH: Record<SellLook, ReactNode> = {
  classic: (
    <span className="flex h-full flex-col gap-[3px]">
      {bar('s')}
      <span className="flex flex-1 gap-[3px]">
        <span className="flex flex-1 flex-col gap-[3px]">{Array.from({ length: 4 }, (_, i) => box(i, { height: 14, flex: 'none' }))}</span>
        {cart()}
      </span>
    </span>
  ),
  rows: (
    <span className="flex h-full flex-col gap-[3px]">
      {bar('s', true)}
      <span className="flex flex-1 gap-[3px]">
        <span className="flex flex-1 flex-col gap-[3px]">{Array.from({ length: 7 }, (_, i) => box(i, { height: 5, flex: 'none' }, i === 1))}</span>
        {cart('24%')}
      </span>
    </span>
  ),
  cards: (
    <span className="flex h-full flex-col gap-[3px]">
      {bar('s')}
      <span className="flex flex-1 gap-[3px]">
        {grid(6, 3)}
        {cart()}
      </span>
    </span>
  ),
  split: (
    <span className="flex h-full flex-col gap-[3px]">
      {bar('s')}
      <span className="flex flex-1 gap-[3px]">
        <span className="flex flex-1 flex-col gap-[3px]">{Array.from({ length: 4 }, (_, i) => box(i, { height: 12, flex: 'none' }))}</span>
        {box('cart', { flex: 1 })}
      </span>
    </span>
  ),
  board: (
    <span className="flex h-full flex-col gap-[3px]">
      {bar('s')}
      <span className="flex flex-1 flex-col gap-[3px]">
        <span className="grid flex-1 grid-cols-4 content-start gap-[3px]">{Array.from({ length: 8 }, (_, i) => box(i, { height: 9 }, i === 1))}</span>
        <span className="flex gap-[3px]">
          {box('lines', { flex: 1, height: 14 })}
          {box('pay', { width: '28%', height: 14 }, true)}
        </span>
      </span>
    </span>
  ),
  register: (
    <span className="flex h-full flex-col gap-[3px]">
      {bar('s')}
      <span className="flex flex-1 gap-[3px]">
        {box('cart', { width: '38%', flex: 'none' })}
        <span className="flex flex-1 flex-col gap-[3px]">{Array.from({ length: 4 }, (_, i) => box(i, { height: 9, flex: 'none' }, i === 1))}</span>
      </span>
    </span>
  ),
  stack: (
    <span className="flex h-full flex-col items-center gap-[3px]">
      {bar('s')}
      <span className="flex w-[50%] flex-1 flex-col gap-[3px]">
        {Array.from({ length: 3 }, (_, i) => box(i, { height: 9, flex: 'none' }, i === 1))}
        {box('cart', { height: 12, flex: 'none' })}
        {box('pay', { height: 8, marginTop: 'auto', flex: 'none' }, true)}
      </span>
    </span>
  ),
};

/** The Sell screen's "Screen layout" button and dialog: the look choices, kept on this device (a cookie) and applied at once. Big screens only. */
export function SellLookPicker({ current }: { current: SellLook }) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function choose(id: SellLook) {
    save(id);
    startTransition(() => router.refresh());
  }

  return (
    <>
      <div className="hidden shrink-0 lg:block">
        <button type="button" data-testid="look-picker" onClick={() => setOpen(true)} className={`${PH_BTN} gap-2 px-3`}>
          <LayoutDashboard aria-hidden className="size-[18px]" />
          {t('pharmacy.sell.look.open')}
        </button>
      </div>
      <Dialog open={open} onOpenChange={setOpen} title={t('pharmacy.sell.look.title')} description={t('pharmacy.sell.look.subtitle')} width="md">
        <section aria-labelledby="look-section-title" className="flex flex-col gap-3">
          <div>
            <h3 id="look-section-title" className="text-base font-bold text-ph-text">
              {t('pharmacy.sell.look.section')}
            </h3>
            <p className="text-sm text-ph-muted">{t('pharmacy.sell.look.sectionHint')}</p>
          </div>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-busy={pending || undefined}>
            {LOOKS.map((id) => {
              const on = id === current;
              return (
                <li key={id}>
                  <button
                    type="button"
                    data-look-option={id}
                    aria-pressed={on}
                    disabled={pending}
                    onClick={() => choose(id)}
                    className={`flex min-h-11 w-full flex-col gap-2 rounded-ph-xl border-2 bg-ph-card p-2 text-start ${on ? 'border-ph-g8' : 'border-ph-line hover:bg-ph-canvas'}`}
                  >
                    <span aria-hidden="true" className="relative block aspect-[16/10] w-full">
                      {SKETCH[id]}
                      {on ? (
                        <span className="absolute end-1 top-1 grid size-6 place-items-center rounded-full bg-ph-g8 text-ph-on-green">
                          <Check size={16} />
                        </span>
                      ) : null}
                    </span>
                    <span className="px-1 text-sm font-bold text-ph-text">{t(`pharmacy.sell.look.name.${id}`)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      </Dialog>
    </>
  );
}
