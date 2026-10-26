'use client';

import { X } from 'lucide-react';
import { useMemo } from 'react';
import { useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';
import { cx } from '@/studio/ui/cx';
import { EmptyState } from '@/studio/ui/EmptyState';
import { SearchFilter, useFilterParams } from '@/studio/ui/FilterBar';
import { PageHeader } from '@/studio/ui/PageHeader';
import { MENU_STYLES, STYLE_GROUPS, type StyleGroup } from './catalog';
import { filterStyles } from './search';
import { StyleCard } from './StyleCard';

const GROUP_PARAM = 'group';

function asGroup(value: string | null): StyleGroup | 'all' {
  return value && (STYLE_GROUPS as readonly string[]).includes(value) ? (value as StyleGroup) : 'all';
}

/**
 * The Menu Styles gallery: a poster of every style, in the library's four groups. The group and the search live in the
 * address, so a filtered view can be shared, as on Motion.
 */
export function StyleLibrary() {
  const t = useT();
  const { params, set } = useFilterParams();
  const group = asGroup(params.get(GROUP_PARAM));
  const q = params.get('q') ?? '';

  const shown = useMemo(() => filterStyles(MENU_STYLES, { q, group }, (id) => t(`styles.${id}.name`)), [q, group, t]);
  const counts = useMemo(() => {
    const byGroup = new Map<StyleGroup, number>();
    for (const style of MENU_STYLES) byGroup.set(style.group, (byGroup.get(style.group) ?? 0) + 1);
    return byGroup;
  }, []);
  const sections = STYLE_GROUPS.map((key) => ({ key, styles: shown.filter((style) => style.group === key) })).filter(
    (section) => section.styles.length > 0,
  );

  return (
    <>
      <PageHeader
        title={t('styles.library.title')}
        description={t('styles.library.intro')}
        below={
          <div className="flex flex-col gap-3 pb-5">
            <SearchFilter label={t('styles.library.search')} placeholder={t('styles.library.searchPlaceholder')} />
            <nav aria-label={t('styles.library.groups')} className="-mx-1 overflow-x-auto px-1 pb-1">
              <ul className="flex w-max gap-1.5">
                {(['all', ...STYLE_GROUPS] as const).map((key) => {
                  const current = key === group;
                  return (
                    <li key={key}>
                      <button
                        type="button"
                        aria-pressed={current}
                        onClick={() => set({ [GROUP_PARAM]: key === 'all' ? null : key })}
                        className={cx(
                          'inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-sm whitespace-nowrap transition-colors duration-150',
                          current ? 'bg-ink text-on-ink' : 'border border-line-strong bg-raised text-text hover:bg-hover',
                        )}
                      >
                        {key === 'all' ? t('styles.library.all') : t(`styles.group.${key}`)}
                        <span className={cx('tabular-nums', current ? 'text-on-ink/70' : 'text-muted')}>
                          {key === 'all' ? MENU_STYLES.length : counts.get(key)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </nav>
          </div>
        }
      />

      <div className="flex flex-col gap-10 px-8 pt-2 pb-16">
        <p aria-live="polite" className="text-sm text-muted tabular-nums">
          {t('styles.library.showing', { count: shown.length, total: MENU_STYLES.length })}
        </p>
        {sections.length === 0 ? (
          <EmptyState
            title={t('styles.library.empty', { q })}
            action={
              <Button icon={<X aria-hidden />} onClick={() => set({ q: null, [GROUP_PARAM]: null })}>
                {t('common.clearFilters')}
              </Button>
            }
          />
        ) : (
          sections.map(({ key, styles }) => (
            <section key={key} aria-labelledby={`style-group-${key}`} className="flex flex-col gap-4">
              <h2 id={`style-group-${key}`} className="flex items-baseline gap-2 text-md font-semibold text-text">
                {t(`styles.group.${key}`)}
                <span className="text-sm font-normal text-muted tabular-nums">{styles.length}</span>
              </h2>
              {/* Phone-shaped posters take narrower columns than Motion's 4:3 cards, so a row still holds several. */}
              <ul aria-label={t(`styles.group.${key}`)} className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-x-5 gap-y-7">
                {styles.map((style) => (
                  <StyleCard key={style.id} style={style} />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </>
  );
}
