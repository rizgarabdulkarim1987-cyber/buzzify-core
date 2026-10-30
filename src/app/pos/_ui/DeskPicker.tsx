'use client';

import { Check } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTransition, type CSSProperties, type ReactNode } from 'react';
import { DESK_COOKIE, DESK_LAYOUT, DESKS, LAYOUT_COOKIE, type DeskId } from '@/lib/pos-floor';
import { useT } from '@/studio/i18n';

const YEAR = 60 * 60 * 24 * 365;

function save(id: DeskId) {
  document.cookie = `${DESK_COOKIE}=${id}; path=/; max-age=${YEAR}; samesite=lax`;
  const layout = DESK_LAYOUT[id];
  if (layout) document.cookie = `${LAYOUT_COOKIE}=${layout}; path=/; max-age=${YEAR}; samesite=lax`;
}

const box = (key: string | number, style?: CSSProperties, strong = false) => (
  <span key={key} className="wire block" style={{ ...style, ...(strong ? { background: 'var(--s-muted)' } : null) }} />
);
const grid = (n: number, cols: number, style?: CSSProperties) => (
  <span className="grid flex-1 content-start gap-[3px]" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, ...style }}>
    {Array.from({ length: n }, (_, i) => box(i, undefined, i === 1))}
  </span>
);
const bar = (key: string, strong: boolean) => box(key, { height: 7, flex: 'none' }, strong);
const rail = (width: string) => <span className="flex flex-col gap-[3px]" style={{ width }}>{Array.from({ length: 5 }, (_, i) => box(i, { flex: 1 }, i === 0))}</span>;
const ticket = (width = '28%') => box('t', { width, flex: 'none' });

/** A small sketch of each look's whole cashier: where the pages menu sits, the dishes and the bill. */
const SKETCH: Record<DeskId, ReactNode> = {
  classic: (
    <span className="flex h-full flex-col gap-[3px]">
      {bar('n', false)}
      <span className="flex flex-1 gap-[3px]">{grid(8, 4)}{ticket()}</span>
    </span>
  ),
  photo: (
    <span className="flex h-full gap-[3px]">
      {rail('12%')}
      {grid(6, 3)}
      {ticket('24%')}
    </span>
  ),
  rows: (
    <span className="flex h-full flex-col gap-[3px]">
      {bar('n', true)}
      <span className="flex flex-1 gap-[3px]">
        <span className="grid flex-1 grid-cols-2 content-start gap-[3px]">{Array.from({ length: 12 }, (_, i) => box(i, { height: 5 }))}</span>
        {ticket('26%')}
      </span>
    </span>
  ),
  cards: (
    <span className="flex h-full flex-col gap-[3px]">
      <span className="flex flex-1 gap-[3px]">{grid(6, 3)}{box('t', { width: '28%', flex: 'none', borderRadius: 8 })}</span>
      {box('d', { height: 9, flex: 'none', borderRadius: 6 })}
    </span>
  ),
  split: (
    <span className="flex h-full gap-[3px]">
      {rail('7%')}
      {box('l', { width: '24%', flex: 'none' })}
      {grid(6, 3)}
      {ticket('22%')}
    </span>
  ),
  board: (
    <span className="flex h-full flex-col gap-[3px]">
      {bar('n', false)}
      <span className="flex flex-1 gap-[3px]">
        {Array.from({ length: 4 }, (_, c) => (
          <span key={c} className="flex flex-1 flex-col gap-[3px]">
            {Array.from({ length: 4 - (c % 2) }, (_, i) => box(i, { height: 8, flex: 'none' }, i === 0))}
          </span>
        ))}
      </span>
    </span>
  ),
  register: (
    <span className="flex h-full flex-col gap-[3px]">
      <span className="flex flex-1 gap-[3px]">
        {box('t', { width: '34%', flex: 'none' })}
        <span className="grid flex-1 grid-cols-3 gap-[3px]">{Array.from({ length: 9 }, (_, i) => box(i, undefined, i % 4 === 1))}</span>
      </span>
      {bar('n', true)}
    </span>
  ),
  stack: (
    <span className="flex h-full flex-col items-center gap-[3px]">
      {bar('n', false)}
      <span className="flex w-[46%] flex-1 flex-col gap-[3px]">
        {Array.from({ length: 5 }, (_, i) => box(i, { height: 8, flex: 'none' }, i === 1))}
        {box('p', { height: 9, marginTop: 'auto', flex: 'none' }, true)}
      </span>
    </span>
  ),
};

/** The cashier look choices, shown inside the screen-look dialog. Big screens only: phones keep their own layout. */
export function DeskSection({ current }: { current: DeskId }) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function choose(id: DeskId) {
    save(id);
    startTransition(() => router.refresh());
  }

  return (
    <section className="mb-6 hidden flex-col gap-3 lg:flex" aria-labelledby="desk-title">
      <div>
        <h3 id="desk-title" className="text-base font-bold">{t('pos.desk.title')}</h3>
        <p className="text-sm text-muted">{t('pos.desk.subtitle')}</p>
      </div>
      <ul className="grid grid-cols-4 gap-3" aria-busy={pending || undefined}>
        {DESKS.map((id) => {
          const on = id === current;
          return (
            <li key={id}>
              <button type="button" data-desk-option={id} aria-pressed={on} disabled={pending} onClick={() => choose(id)} className="layout-option flex w-full flex-col gap-2 rounded-xl p-2 text-start">
                <span aria-hidden="true" className="relative block aspect-[16/10] w-full">
                  {SKETCH[id]}
                  {on ? (
                    <span className="absolute end-1 top-1 grid size-6 place-items-center rounded-full bg-ink text-on-ink">
                      <Check size={16} />
                    </span>
                  ) : null}
                </span>
                <span className="px-1 text-sm font-bold">{t(`pos.desk.name.${id}`)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
