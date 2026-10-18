'use client';

import { X } from 'lucide-react';
import { useMemo } from 'react';
import { MOTION_CATEGORIES, MOTIONS } from '@/motion/catalog';
import type { MotionCategory } from '@/motion/types';
import { useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';
import { cx } from '@/studio/ui/cx';
import { EmptyState } from '@/studio/ui/EmptyState';
import { SearchFilter, useFilterParams } from '@/studio/ui/FilterBar';
import { PageHeader } from '@/studio/ui/PageHeader';
import { Switch } from '@/studio/ui/Switch';
import { MotionCard } from './MotionCard';
import { usePlayPreference, useReducedMotion } from './play-preference';
import { filterMotions } from './search';

const GROUP_PARAM = 'group';

function asCategory(value: string | null): MotionCategory | 'all' {
  return value && (MOTION_CATEGORIES as readonly string[]).includes(value) ? (value as MotionCategory) : 'all';
}

/**
 * The Motion area's gallery: every motion playing in its card, in the list's ten groups. The group and the search live
 * in the address, so a filtered view can be shared; whether previews play is the viewer's own choice.
 */
export function MotionLibrary() {
  const t = useT();
  const { params, set } = useFilterParams();
  const [playing, setPlaying] = usePlayPreference();
  const reduced = useReducedMotion();
  const category = asCategory(params.get(GROUP_PARAM));
  const q = params.get('q') ?? '';

  const shown = useMemo(() => filterMotions(MOTIONS, { q, category }, (id) => t(`motion.${id}.name`)), [q, category, t]);
  const counts = useMemo(() => {
    const byGroup = new Map<MotionCategory, number>();
    for (const motion of MOTIONS) byGroup.set(motion.category, (byGroup.get(motion.category) ?? 0) + 1);
    return byGroup;
  }, []);
  const sections = MOTION_CATEGORIES.map((group) => ({ group, motions: shown.filter((motion) => motion.category === group) })).filter(
    (section) => section.motions.length > 0,
  );

  return (
    <>
      <PageHeader
        title={t('motion.library.title')}
        description={t('motion.library.intro')}
        actions={
          <label className="flex cursor-pointer items-center gap-2.5 text-base text-text">
            <Switch checked={playing} onCheckedChange={setPlaying} />
            {t('motion.library.play')}
          </label>
        }
        below={
          <div className="flex flex-col gap-3 pb-5">
            <SearchFilter label={t('motion.library.search')} placeholder={t('motion.library.searchPlaceholder')} />
            <nav aria-label={t('motion.library.categories')} className="-mx-1 overflow-x-auto px-1 pb-1">
              <ul className="flex w-max gap-1.5">
                {(['all', ...MOTION_CATEGORIES] as const).map((group) => {
                  const current = group === category;
                  return (
                    <li key={group}>
                      <button
                        type="button"
                        aria-pressed={current}
                        onClick={() => set({ [GROUP_PARAM]: group === 'all' ? null : group })}
                        className={cx(
                          'inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-sm whitespace-nowrap transition-colors duration-150',
                          current ? 'bg-ink text-on-ink' : 'border border-line-strong bg-raised text-text hover:bg-hover',
                        )}
                      >
                        {group === 'all' ? t('motion.library.all') : t(`motion.category.${group}`)}
                        <span className={cx('tabular-nums', current ? 'text-on-ink/70' : 'text-muted')}>
                          {group === 'all' ? MOTIONS.length : counts.get(group)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </nav>
            {reduced && !playing && <p className="text-sm text-muted">{t('motion.library.reduced')}</p>}
          </div>
        }
      />

      <div className="flex flex-col gap-10 px-8 pt-2 pb-16">
        <p aria-live="polite" className="text-sm text-muted tabular-nums">
          {t('motion.library.showing', { count: shown.length, total: MOTIONS.length })}
        </p>
        {sections.length === 0 ? (
          <EmptyState
            title={t('motion.library.empty', { q })}
            action={
              <Button icon={<X aria-hidden />} onClick={() => set({ q: null, [GROUP_PARAM]: null })}>
                {t('common.clearFilters')}
              </Button>
            }
          />
        ) : (
          sections.map(({ group, motions }) => (
            <section key={group} aria-labelledby={`motion-group-${group}`} className="flex flex-col gap-4">
              <h2 id={`motion-group-${group}`} className="flex items-baseline gap-2 text-md font-semibold text-text">
                {t(`motion.category.${group}`)}
                <span className="text-sm font-normal text-muted tabular-nums">{motions.length}</span>
              </h2>
              <ul aria-label={t(`motion.category.${group}`)} className="grid grid-cols-[repeat(auto-fill,minmax(232px,1fr))] gap-x-5 gap-y-7">
                {motions.map((meta) => (
                  <MotionCard key={meta.id} meta={meta} playing={playing} />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </>
  );
}
