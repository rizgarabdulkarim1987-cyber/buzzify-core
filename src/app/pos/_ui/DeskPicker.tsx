'use client';

import { Check } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { DESK_COOKIE, DESKS, type DeskId } from '@/lib/pos-floor';
import { useT } from '@/studio/i18n';

const YEAR = 60 * 60 * 24 * 365;

function save(id: DeskId) {
  document.cookie = `${DESK_COOKIE}=${id}; path=/; max-age=${YEAR}; samesite=lax`;
}

/** A tiny sketch of each look: the dish tile, the category and the ticket, as the cashier will see them. */
function Sketch({ id }: { id: DeskId }) {
  const tile = (i: number) => <span key={i} className="block rounded-[3px] bg-[hsl(28_70%_70%)]" style={id === 'rows' ? { height: 6, borderInlineStart: '3px solid hsl(8 80% 50%)', background: 'var(--s-muted)' } : id === 'photo' ? { background: `hsl(${[28, 8, 335, 200][i % 4]} 65% 62%)` } : { background: `hsl(${[28, 150, 8, 45][i % 4]} 60% 72%)`, borderBottom: '4px solid var(--s-muted)' }} />;
  const cols = id === 'rows' ? 2 : id === 'cards' ? 5 : 4;
  const count = id === 'rows' ? 8 : id === 'cards' ? 10 : 8;
  return (
    <span className="flex h-full gap-[3px]">
      {id === 'photo' ? <span className="flex w-[14%] flex-col gap-[3px]">{[28, 45, 8, 150].map((h) => <span key={h} className="block flex-1 rounded-[3px]" style={{ background: `hsl(${h} 80% 62%)` }} />)}</span> : null}
      <span className="flex flex-1 flex-col gap-[3px]">
        {id !== 'photo' ? <span className="flex gap-[3px]">{[28, 45, 8].map((h) => <span key={h} className="block h-[7px] flex-1 rounded-full" style={{ background: `hsl(${h} 80% 62%)` }} />)}</span> : null}
        <span className="grid flex-1 content-start gap-[3px]" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
          {Array.from({ length: count }, (_, i) => tile(i))}
        </span>
      </span>
      <span className="block w-[28%] rounded-[3px] bg-[hsl(0_0%_88%)]" style={id === 'cards' ? { borderRadius: 8 } : undefined} />
    </span>
  );
}

/** The "order look" choices, shown inside the screen-look dialog. Big screens only: phones keep their own layout. */
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
                  <Sketch id={id} />
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
