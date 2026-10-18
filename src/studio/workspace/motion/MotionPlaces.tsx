'use client';

import { Plus, Sparkles, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { removeMotion } from '@/app/studio/_actions/motions';
import { isTemplateId, TEMPLATES } from '@/lib/templates';
import { motionById } from '@/motion/catalog';
import type { MotionPlaceView, MotionPlacesView } from '@/server/studio/services/menu-motions';
import { describeFailure } from '@/studio/errors';
import { useLocale, useT } from '@/studio/i18n';
import { MotionPreview } from '@/studio/motion/MotionCard';
import { usePlayPreference } from '@/studio/motion/play-preference';
import { UpgradeHint } from '@/studio/plans/UpgradeHint';
import { Alert } from '@/studio/ui/Alert';
import { Button, buttonClasses } from '@/studio/ui/Button';
import { ConfirmDialog } from '@/studio/ui/ConfirmDialog';
import { cx } from '@/studio/ui/cx';
import { PLACE_ASPECT, placeName, placeSegment, previewParams } from './places';

function Section({ id, title, intro, children }: { id: string; title: string; intro?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3 border-t border-line py-7 first:border-t-0 first:pt-2">
      <div className="flex flex-col gap-1">
        <h2 id={id} className="text-md font-semibold text-text">
          {title}
        </h2>
        {intro && <p className="max-w-[65ch] text-sm text-muted">{intro}</p>}
      </div>
      {children}
    </section>
  );
}

/** One place: its motion playing in the place's own shape (or the page colour alone), its name, and what can be done. */
function PlaceRow({
  menuId,
  view,
  place,
  playing,
  onRemove,
}: {
  menuId: string;
  view: MotionPlacesView;
  place: MotionPlaceView;
  playing: boolean;
  onRemove: (place: MotionPlaceView) => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const name = placeName(t, place);
  const meta = place.motion ? motionById(place.motion.motionId) : undefined;
  const headingId = `motion-place-${placeSegment(place)}`;
  // A template menu draws the top behind its own header and hero, and never the signature place.
  const template = view.templateId !== null;
  const note =
    place.place === 'category'
      ? null
      : place.place === 'signature'
        ? template
          ? t('menuMotions.place.signature.templateNote')
          : view.hasSignature
            ? t('menuMotions.place.signature.hint')
            : t('menuMotions.signatureMissing')
        : t(template ? 'menuMotions.place.hero.templateHint' : 'menuMotions.place.hero.hint');
  const suggestedBy = place.motion?.suggestedBy ? (isTemplateId(place.motion.suggestedBy) ? TEMPLATES[place.motion.suggestedBy].name : place.motion.suggestedBy) : null;
  // A plan without motions keeps a motion already placed (it may be tuned) but cannot fill an empty place.
  const canEdit = view.allowed || place.motion !== null;

  return (
    <li aria-labelledby={headingId} className="flex items-center gap-5 py-4">
      <div className="w-40 shrink-0">
        {place.motion && meta ? (
          <MotionPreview
            meta={meta}
            params={previewParams(view, locale, place.motion)}
            playing={playing}
            className={cx(PLACE_ASPECT[place.place], 'w-full rounded-md ring-1 ring-line')}
          />
        ) : (
          <div
            aria-hidden
            className={cx(PLACE_ASPECT[place.place], 'w-full rounded-md border border-dashed border-line-strong')}
            style={{ background: view.pageBackground }}
          />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <h3 id={headingId} className="truncate text-base font-medium text-text">
          {name}
        </h3>
        <p className="text-sm text-text">
          {place.motion && meta ? (
            <>
              <span className="text-muted tabular-nums">{t('motion.detail.number', { number: meta.number })}</span>{' '}
              {t(`motion.${meta.id}.name`)}
            </>
          ) : (
            <span className="text-muted">{t('menuMotions.none')}</span>
          )}
        </p>
        {suggestedBy && (
          <p className="inline-flex w-fit items-center gap-1.5 text-sm text-muted">
            <Sparkles aria-hidden className="size-3.5 shrink-0" />
            {t('menuMotions.suggestedBy', { template: suggestedBy })}
          </p>
        )}
        {note && <p className="text-sm text-muted">{note}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {canEdit && (
          <Link
            href={`/studio/menus/${menuId}/motion/${placeSegment(place)}`}
            className={buttonClasses(place.motion ? 'secondary' : 'primary', 'sm')}
            aria-label={`${place.motion ? t('menuMotions.change') : t('menuMotions.choose')}: ${name}`}
          >
            {!place.motion && <Plus aria-hidden className="size-4" />}
            {place.motion ? t('menuMotions.change') : t('menuMotions.choose')}
          </Link>
        )}
        {place.motion && (
          <Button size="sm" variant="ghost" icon={<Trash2 aria-hidden />} onClick={() => onRemove(place)} aria-label={`${t('menuMotions.remove')}: ${name}`}>
            {t('menuMotions.remove')}
          </Button>
        )}
      </div>
    </li>
  );
}

/**
 * The Motion tab (spec: 2026-10-18-menu-motions-design.md, section 10): the menu's places, the top and the signature
 * dish first, then a band over each category's heading, each with the motion it holds and the way to change it.
 */
export function MotionPlaces({ menuId, view }: { menuId: string; view: MotionPlacesView }) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const [playing] = usePlayPreference();
  const [removing, setRemoving] = useState<MotionPlaceView | null>(null);
  const menuPlaces = view.places.filter((place) => place.place !== 'category');
  const categoryPlaces = view.places.filter((place) => place.place === 'category');
  const row = (place: MotionPlaceView) => (
    <PlaceRow key={placeSegment(place)} menuId={menuId} view={view} place={place} playing={playing} onRemove={setRemoving} />
  );

  return (
    <div className="flex max-w-5xl flex-col px-8 pt-6 pb-16">
      <div className="flex flex-col gap-3 pb-5">
        <p className="max-w-[65ch] text-base text-muted">{t('menuMotions.intro')}</p>
        {!view.allowed && view.upgrade && <UpgradeHint feature="design.menuMotions" info={view.upgrade} />}
        {view.motionIntensity === 'none' && <Alert>{t('menuMotions.stillNote')}</Alert>}
      </div>
      <Section id="motion-menu-places" title={t('menuMotions.menuPlaces')}>
        <ul className="divide-y divide-line">{menuPlaces.map(row)}</ul>
      </Section>
      <Section id="motion-category-places" title={t('menuMotions.categoryPlaces')} intro={t('menuMotions.categoryPlaces.intro')}>
        {categoryPlaces.length === 0 ? (
          <p className="text-sm text-muted">{t('menuMotions.noCategories')}</p>
        ) : (
          <ul className="divide-y divide-line">{categoryPlaces.map(row)}</ul>
        )}
      </Section>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title={t('menuMotions.removeTitle')}
        body={removing ? t('menuMotions.removeBody', { place: placeName(t, removing) }) : undefined}
        confirmLabel={t('menuMotions.remove')}
        onConfirm={async () => {
          if (!removing?.motion) return true;
          const result = await removeMotion({
            menuId,
            place: removing.place,
            ...(removing.categoryId ? { categoryId: removing.categoryId } : {}),
            version: removing.motion.version,
          });
          if (!result.ok) return { message: describeFailure(t, locale, result.error).message };
          toast.success(t('menuMotions.removed'));
          router.refresh();
          return true;
        }}
      />
    </div>
  );
}
