'use client';

import { ArrowLeft, ArrowRight, Check, Search, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { memo, useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { saveMotion } from '@/app/studio/_actions/motions';
import { direction, type Locale } from '@/lib/locale';
import { motionById } from '@/motion/catalog';
import type { MotionCategory, MotionMeta, MotionParams, ParamSpec, ParamValue } from '@/motion/types';
import { PLACEABLE_CATEGORIES, placeMotions, startingParams, startingTexts, type MotionTexts } from '@/server/domain/menu-motions';
import type { MotionPlaceView, MotionPlacesView } from '@/server/studio/services/menu-motions';
import { describeFailure } from '@/studio/errors';
import { useLocale, useT } from '@/studio/i18n';
import { MotionPreview } from '@/studio/motion/MotionCard';
import { ParamControls } from '@/studio/motion/ParamControls';
import { usePlayPreference } from '@/studio/motion/play-preference';
import { filterMotions } from '@/studio/motion/search';
import { UpgradeHint } from '@/studio/plans/UpgradeHint';
import { Alert } from '@/studio/ui/Alert';
import { Button, buttonClasses } from '@/studio/ui/Button';
import { cx } from '@/studio/ui/cx';
import { EmptyState } from '@/studio/ui/EmptyState';
import { CONTROL_CLASSES, Field } from '@/studio/ui/Field';
import { Input } from '@/studio/ui/Input';
import { PLACE_ASPECT, PLACE_FADE, placeName, previewParams } from './places';

const splitSpecs = (meta: MotionMeta) => {
  const entries = Object.entries(meta.params);
  return {
    settings: Object.fromEntries(entries.filter(([, spec]) => spec.type !== 'text')) as Record<string, ParamSpec>,
    words: entries.filter((entry): entry is [string, Extract<ParamSpec, { type: 'text' }>] => entry[1].type === 'text'),
  };
};

/**
 * One motion the place offers, on the menu's page colour; pressing it picks it. It shows a still frame and plays only
 * while pointed at or focused: dozens of live previews would starve the page, and the large preview plays the pick.
 */
const PickCard = memo(function PickCard({
  meta,
  view,
  picked,
  onPick,
}: {
  meta: MotionMeta;
  view: MotionPlacesView;
  picked: boolean;
  onPick: (id: string) => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const [live, setLive] = useState(false);
  const params = useMemo(
    () =>
      previewParams(view, locale, {
        motionId: meta.id,
        params: startingParams(meta, view.pageBackground),
        texts: startingTexts(meta, view.locales, view.logoText),
      }),
    [meta, view, locale],
  );
  return (
    <li>
      <button
        type="button"
        aria-pressed={picked}
        onClick={() => onPick(meta.id)}
        onPointerEnter={() => setLive(true)}
        onPointerLeave={() => setLive(false)}
        onFocus={() => setLive(true)}
        onBlur={() => setLive(false)}
        className="group flex w-full flex-col gap-2 rounded-lg text-start outline-offset-4"
      >
        <MotionPreview
          meta={meta}
          params={params}
          playing={live}
          className={cx(
            'aspect-[4/3] w-full rounded-lg transition-[box-shadow] duration-150 ease-out',
            picked ? 'ring-2 ring-ink' : 'ring-1 ring-line group-hover:ring-2 group-hover:ring-line-strong',
          )}
        />
        <span className="flex min-w-0 items-baseline gap-2 px-0.5">
          <span className="shrink-0 text-xs text-muted tabular-nums">{t('motion.detail.number', { number: meta.number })}</span>
          <span className={cx('truncate text-sm text-text', picked ? 'font-semibold' : 'font-medium')}>{t(`motion.${meta.id}.name`)}</span>
          {picked && <Check aria-hidden className="ms-auto size-4 shrink-0 text-text" />}
        </span>
      </button>
    </li>
  );
});

/**
 * Choosing and tuning the motion of one place (spec: 2026-10-18-menu-motions-design.md, section 10): the motions the
 * place offers beside a preview in the place's own shape, the motion's settings, and its words in each of the menu's
 * languages. A motion just picked starts on the menu's page colour; the one already placed comes back as it was saved.
 */
export function MotionPlaceEditor({ menuId, view, place }: { menuId: string; view: MotionPlacesView; place: MotionPlaceView }) {
  const t = useT();
  const { locale, dir } = useLocale();
  const router = useRouter();
  // Kept on the page, not in the address: filtering is instant and never asks the server for the page again.
  const [q, setQ] = useState('');
  const [group, setGroup] = useState<MotionCategory | 'all'>('all');
  // The large preview follows the viewer's choice from the Motion Studio (still under reduced motion until they play it).
  const [playing] = usePlayPreference();
  const [saving, startSaving] = useTransition();
  const [failure, setFailure] = useState<string | null>(null);
  const stored = place.motion;
  const [pick, setPick] = useState<{ motionId: string; params: MotionParams; texts: MotionTexts } | null>(
    stored ? { motionId: stored.motionId, params: stored.params, texts: stored.texts } : null,
  );

  const offered = useMemo(() => placeMotions(place.place), [place.place]);
  const shown = useMemo(() => filterMotions(offered, { q, category: group }, (id) => t(`motion.${id}.name`)), [offered, q, group, t]);
  const counts = useMemo(() => {
    const byGroup = new Map<MotionCategory, number>();
    for (const motion of offered) byGroup.set(motion.category, (byGroup.get(motion.category) ?? 0) + 1);
    return byGroup;
  }, [offered]);

  const meta = pick ? motionById(pick.motionId) : undefined;
  const specs = meta ? splitSpecs(meta) : null;
  const name = placeName(t, place);
  const back = `/studio/menus/${menuId}/motion`;
  // A plan without motions keeps the one placed here; picking another is the plan's to allow.
  const locked = !view.allowed && pick !== null && pick.motionId !== stored?.motionId;
  const BackIcon = dir === 'rtl' ? ArrowRight : ArrowLeft;

  const choose = (id: string) => {
    setFailure(null);
    if (stored && id === stored.motionId) return setPick({ motionId: id, params: stored.params, texts: stored.texts });
    const next = motionById(id);
    if (!next) return;
    setPick({ motionId: id, params: startingParams(next, view.pageBackground), texts: startingTexts(next, view.locales, view.logoText) });
  };

  const setParam = (key: string, value: ParamValue) => setPick((current) => (current ? { ...current, params: { ...current.params, [key]: value } } : current));
  const setText = (key: string, language: Locale, value: string) =>
    setPick((current) =>
      current ? { ...current, texts: { ...current.texts, [key]: { ...current.texts[key], [language]: value } } } : current,
    );

  const save = () =>
    startSaving(async () => {
      if (!pick) return;
      const result = await saveMotion({
        menuId,
        place: place.place,
        ...(place.categoryId ? { categoryId: place.categoryId } : {}),
        motionId: pick.motionId,
        params: pick.params,
        texts: pick.texts,
        version: stored?.version ?? null,
      });
      if (!result.ok) {
        setFailure(describeFailure(t, locale, result.error).message);
        return;
      }
      toast.success(t('menuMotions.saved'));
      router.push(back);
      router.refresh();
    });

  return (
    <div className="flex flex-col px-8 pt-6 pb-16">
      <Link href={back} className="inline-flex w-fit items-center gap-1.5 text-sm text-muted hover:text-text hover:underline hover:underline-offset-2">
        <BackIcon aria-hidden className="size-4" />
        {t('menuMotions.editor.back')}
      </Link>
      <h2 className="mt-3 text-lg font-semibold text-text">{name}</h2>

      <div className="mt-5 grid gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <aside aria-label={t('menuMotions.editor.preview')} className="flex flex-col gap-6 lg:sticky lg:top-6 lg:order-last lg:self-start">
          <section aria-labelledby="motion-editor-preview" className="flex flex-col gap-2">
            <h3 id="motion-editor-preview" className="text-sm font-medium text-muted">
              {t('menuMotions.editor.preview')}
            </h3>
            <div className={cx('relative w-full overflow-hidden rounded-lg ring-1 ring-line', PLACE_ASPECT[place.place])} style={{ background: view.pageBackground }}>
              {pick && meta ? (
                <MotionPreview
                  key={pick.motionId}
                  meta={meta}
                  params={previewParams(view, locale, pick)}
                  playing={playing}
                  className={cx('size-full', PLACE_FADE[place.place])}
                />
              ) : (
                <p className="absolute inset-0 grid place-items-center px-6 text-center text-sm text-muted">{t('menuMotions.editor.pickFirst')}</p>
              )}
            </div>
            {pick && meta && (
              <p className="flex items-baseline gap-2 text-base text-text">
                <span className="text-sm text-muted tabular-nums">{t('motion.detail.number', { number: meta.number })}</span>
                <span className="font-medium">{t(`motion.${meta.id}.name`)}</span>
                {stored?.motionId === meta.id && <span className="ms-auto text-sm text-muted">{t('menuMotions.editor.current')}</span>}
              </p>
            )}
          </section>

          {pick && meta && specs && (
            <form
              noValidate
              className="flex flex-col gap-6"
              onSubmit={(event) => {
                event.preventDefault();
                save();
              }}
            >
              {Object.keys(specs.settings).length > 0 && (
                <fieldset className="flex flex-col gap-4">
                  <legend className="mb-3 text-md font-semibold text-text">{t('menuMotions.editor.settings')}</legend>
                  <ParamControls specs={specs.settings} values={pick.params} onChange={setParam} />
                </fieldset>
              )}
              {specs.words.length > 0 && (
                <fieldset className="flex flex-col gap-4">
                  <legend className="mb-1 text-md font-semibold text-text">{t('menuMotions.editor.words')}</legend>
                  <p className="text-sm text-muted">{t('menuMotions.editor.wordsIntro', { fallback: view.logoText })}</p>
                  {specs.words.flatMap(([key, spec]) =>
                    view.locales.map((language) => (
                      <Field
                        key={`${key}-${language}`}
                        label={t('menuMotions.editor.textIn', { param: t(`motion.param.${key}`), language: t(`menus.language.${language}`) })}
                      >
                        <Input
                          dir={direction(language)}
                          lang={language}
                          value={pick.texts[key]?.[language] ?? ''}
                          maxLength={spec.maxLength}
                          onChange={(event) => setText(key, language, event.target.value)}
                        />
                      </Field>
                    )),
                  )}
                </fieldset>
              )}
              {locked && view.upgrade && <UpgradeHint feature="design.menuMotions" info={view.upgrade} />}
              {failure && <Alert tone="danger">{failure}</Alert>}
              <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" variant="primary" pending={saving} disabled={locked}>
                  {t('menuMotions.editor.save')}
                </Button>
                <Link href={back} className={buttonClasses('ghost')}>
                  {t('menuMotions.editor.cancel')}
                </Link>
              </div>
            </form>
          )}
        </aside>

        <section aria-labelledby="motion-editor-motions" className="flex min-w-0 flex-col gap-4">
          <h3 id="motion-editor-motions" className="text-md font-semibold text-text">
            {t('menuMotions.editor.motions')}
          </h3>
          <div className="relative w-72">
            <Search aria-hidden className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input
              type="search"
              aria-label={t('menuMotions.editor.search')}
              placeholder={t('menuMotions.editor.searchPlaceholder')}
              value={q}
              onChange={(event) => setQ(event.target.value)}
              className={cx(CONTROL_CLASSES, 'h-8 ps-8 pe-2.5 text-base')}
            />
          </div>
          <nav aria-label={t('menuMotions.editor.groups')} className="-mx-1 overflow-x-auto px-1 pb-1">
            <ul className="flex w-max gap-1.5">
              {(['all', ...PLACEABLE_CATEGORIES] as const).map((key) => {
                const current = key === group;
                return (
                  <li key={key}>
                    <button
                      type="button"
                      aria-pressed={current}
                      onClick={() => setGroup(key)}
                      className={cx(
                        'inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-sm whitespace-nowrap transition-colors duration-150',
                        current ? 'bg-ink text-on-ink' : 'border border-line-strong bg-raised text-text hover:bg-hover',
                      )}
                    >
                      {key === 'all' ? t('menuMotions.editor.all') : t(`motion.category.${key}`)}
                      <span className={cx('tabular-nums', current ? 'text-on-ink/70' : 'text-muted')}>{key === 'all' ? offered.length : counts.get(key)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
          {shown.length === 0 ? (
            <EmptyState
              title={t('menuMotions.editor.empty', { q })}
              action={
                <Button
                  icon={<X aria-hidden />}
                  onClick={() => {
                    setQ('');
                    setGroup('all');
                  }}
                >
                  {t('common.clearFilters')}
                </Button>
              }
            />
          ) : (
            <ul aria-label={t('menuMotions.editor.motions')} className="grid grid-cols-[repeat(auto-fill,minmax(176px,1fr))] gap-x-4 gap-y-6">
              {shown.map((motion) => (
                <PickCard key={motion.id} meta={motion} view={view} picked={pick?.motionId === motion.id} onPick={choose} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
