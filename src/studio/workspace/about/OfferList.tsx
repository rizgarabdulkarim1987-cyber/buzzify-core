'use client';

import { ArrowDown, ArrowUp, ImagePlus, Pencil, Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { deleteAboutOffer, reorderAboutOffers, saveAboutOffer } from '@/app/studio/_actions/about';
import type { Locale } from '@/lib/locale';
import { utcToZonedLocal, zonedLocalToUtc } from '@/server/domain/schedule-time';
import type { AboutOfferRow, AboutStudioView, LocaleTexts } from '@/server/studio/services/about';
import { describeFailure } from '@/studio/errors';
import { useLocale, useT } from '@/studio/i18n';
import { MediaPicker } from '@/studio/media/MediaPicker';
import { Alert } from '@/studio/ui/Alert';
import { Button } from '@/studio/ui/Button';
import { Checkbox } from '@/studio/ui/Checkbox';
import { cx } from '@/studio/ui/cx';
import { Field } from '@/studio/ui/Field';
import { IconButton } from '@/studio/ui/IconButton';
import { Input } from '@/studio/ui/Input';
import { Select } from '@/studio/ui/Select';
import { Textarea } from '@/studio/ui/Textarea';
import { isRtl } from '../content/shared';

type Link = 'none' | 'dish' | 'category';

interface Draft {
  offerId: string | null;
  titles: LocaleTexts;
  bodies: LocaleTexts;
  label: LocaleTexts;
  imageAssetId: string | null;
  imageThumb: string | null;
  starts: string;
  ends: string;
  active: boolean;
  link: Link;
  productId: string;
  categoryId: string;
}

const dayOf = (iso: string | null, zone: string) => (iso ? utcToZonedLocal(new Date(iso), zone).slice(0, 10) : '');

function draftOf(offer: AboutOfferRow | null, view: AboutStudioView): Draft {
  return {
    offerId: offer?.id ?? null,
    titles: offer?.titles ?? {},
    bodies: offer?.bodies ?? {},
    label: offer?.label ?? {},
    imageAssetId: offer?.imageAssetId ?? null,
    imageThumb: offer?.imageAssetId ? (view.thumbs[offer.imageAssetId] ?? null) : null,
    starts: dayOf(offer?.startsAt ?? null, view.timezone),
    ends: dayOf(offer?.endsAt ?? null, view.timezone),
    active: offer?.active ?? true,
    link: offer?.productId ? 'dish' : offer?.categoryId ? 'category' : 'none',
    productId: offer?.productId ?? '',
    categoryId: offer?.categoryId ?? '',
  };
}

/** The offers of the page: a list with a card editor under the one being edited. Each offer saves on its own. */
export function OfferList({ menuId, view }: { menuId: string; view: AboutStudioView }) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, startBusy] = useTransition();

  const run = (action: () => Promise<{ ok: true } | { ok: false; message: string }>, done: string) =>
    startBusy(async () => {
      const result = await action();
      if (!result.ok) return setProblem(result.message);
      setProblem(null);
      toast.success(done);
      router.refresh();
    });
  const fail = (error: Parameters<typeof describeFailure>[2]) => ({ ok: false as const, message: describeFailure(t, locale, error).message });

  const move = (index: number, by: -1 | 1) => {
    const ids = view.offers.map((offer) => offer.id);
    const [taken] = ids.splice(index, 1);
    if (taken) ids.splice(index + by, 0, taken);
    run(async () => {
      const result = await reorderAboutOffers({ menuId, ids });
      return result.ok ? { ok: true } : fail(result.error);
    }, t('aboutPage.offerSaved'));
  };
  const remove = (offerId: string) =>
    run(async () => {
      const result = await deleteAboutOffer({ menuId, offerId });
      if (result.ok) setEditing(null);
      return result.ok ? { ok: true } : fail(result.error);
    }, t('aboutPage.offerDeleted'));

  const nameOf = (offer: AboutOfferRow) => offer.titles[view.defaultLocale] || offer.titles.en || Object.values(offer.titles).find(Boolean) || t('aboutPage.offerUntitled');

  return (
    <div className="flex flex-col gap-3">
      {problem && <Alert tone="danger">{problem}</Alert>}
      {view.offers.length === 0 && editing !== 'new' && <p className="text-sm text-muted">{t('aboutPage.noOffers')}</p>}
      <ul className="flex flex-col gap-2">
        {view.offers.map((offer, index) => {
          return (
            <li key={offer.id} className="rounded-md border border-line">
              <div className="flex items-center gap-3 p-3">
                {offer.imageAssetId && view.thumbs[offer.imageAssetId] ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a library thumbnail
                  <img src={view.thumbs[offer.imageAssetId]} alt="" className="size-12 rounded-md border border-line object-cover" />
                ) : (
                  <span className="size-12 rounded-md border border-dashed border-line-strong" aria-hidden />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base text-text">{nameOf(offer)}</p>
                  <p className="text-sm text-muted">
                    {[offer.label[view.defaultLocale] || offer.label.en, offer.ended ? t('aboutPage.offerEnded') : null, offer.active ? null : t('aboutPage.offerOff')].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <IconButton size="sm" icon={<ArrowUp aria-hidden />} label={t('aboutPage.offerMoveUp', { name: nameOf(offer) })} disabled={index === 0 || busy} onClick={() => move(index, -1)} />
                <IconButton size="sm" icon={<ArrowDown aria-hidden />} label={t('aboutPage.offerMoveDown', { name: nameOf(offer) })} disabled={index === view.offers.length - 1 || busy} onClick={() => move(index, 1)} />
                <Button size="sm" icon={<Pencil aria-hidden />} onClick={() => setEditing(editing === offer.id ? null : offer.id)}>
                  {t('aboutPage.editOffer')}
                </Button>
              </div>
              {editing === offer.id && (
                <OfferEditor
                  key={offer.id}
                  menuId={menuId}
                  view={view}
                  draft={draftOf(offer, view)}
                  onDone={() => setEditing(null)}
                  onDelete={() => remove(offer.id)}
                />
              )}
            </li>
          );
        })}
      </ul>
      {editing === 'new' ? (
        <div className="rounded-md border border-line">
          <OfferEditor key="new" menuId={menuId} view={view} draft={draftOf(null, view)} onDone={() => setEditing(null)} />
        </div>
      ) : (
        <div>
          <Button size="sm" icon={<Plus aria-hidden />} onClick={() => setEditing('new')} disabled={view.offers.length >= 100}>
            {t('aboutPage.addOffer')}
          </Button>
        </div>
      )}
    </div>
  );
}

function OfferEditor({ menuId, view, draft: initial, onDone, onDelete }: { menuId: string; view: AboutStudioView; draft: Draft; onDone: () => void; onDelete?: () => void }) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const [draft, setDraft] = useState(initial);
  const [picking, setPicking] = useState(false);
  const [failure, setFailure] = useState<{ message: string; fields: Record<string, string> } | null>(null);
  const [saving, startSaving] = useTransition();
  const errors = failure?.fields ?? {};
  const change = (next: Partial<Draft>) => setDraft((current) => ({ ...current, ...next }));
  const text = (key: 'titles' | 'bodies' | 'label', code: Locale, value: string) => change({ [key]: { ...draft[key], [code]: value } });

  const save = () =>
    startSaving(async () => {
      // The dates are days in the menu's own time zone: the first minute of the start day and the last of the end day.
      let startsAt: string | null = null;
      let endsAt: string | null = null;
      try {
        if (draft.starts) startsAt = zonedLocalToUtc(`${draft.starts}T00:00`, view.timezone).toISOString();
        if (draft.ends) endsAt = zonedLocalToUtc(`${draft.ends}T23:59`, view.timezone).toISOString();
      } catch {
        return setFailure({ message: t('error.INVALID'), fields: { endsAt: t('error.INVALID') } });
      }
      const result = await saveAboutOffer({
        menuId,
        ...(draft.offerId ? { offerId: draft.offerId } : {}),
        titles: draft.titles,
        bodies: draft.bodies,
        label: draft.label,
        imageAssetId: draft.imageAssetId,
        startsAt,
        endsAt,
        active: draft.active,
        productId: draft.link === 'dish' && draft.productId ? draft.productId : null,
        categoryId: draft.link === 'category' && draft.categoryId ? draft.categoryId : null,
      });
      if (!result.ok) {
        const described = describeFailure(t, locale, result.error);
        return setFailure({ message: described.message, fields: described.fields });
      }
      setFailure(null);
      toast.success(t('aboutPage.offerSaved'));
      router.refresh();
      onDone();
    });

  return (
    <div className="flex flex-col gap-4 border-t border-line p-4">
      <h3 className="text-md font-semibold text-text">{draft.offerId ? t('aboutPage.editOffer') : t('aboutPage.offerNew')}</h3>
      {failure && Object.keys(errors).length === 0 && <Alert tone="danger">{failure.message}</Alert>}
      {view.locales.map((code) => {
        const language = t(`menus.language.${code}`);
        const rtl = isRtl(code);
        const direction = { lang: code, dir: rtl ? ('rtl' as const) : ('ltr' as const) };
        return (
          <fieldset key={code} className="flex flex-col gap-3 rounded-md border border-line p-3">
            <legend className="px-1 text-sm font-medium text-text">{language}</legend>
            <Field label={t('aboutPage.offerTitleField', { language })} error={errors.titles}>
              <Input value={draft.titles[code] ?? ''} maxLength={120} {...direction} onChange={(event) => text('titles', code, event.target.value)} />
            </Field>
            <Field label={t('aboutPage.offerBodyField', { language })} error={errors.bodies}>
              <Textarea rows={2} value={draft.bodies[code] ?? ''} maxLength={500} {...direction} onChange={(event) => text('bodies', code, event.target.value)} />
            </Field>
            <Field label={t('aboutPage.offerLabelField', { language })} error={errors.label}>
              <Input value={draft.label[code] ?? ''} maxLength={40} {...direction} onChange={(event) => text('label', code, event.target.value)} />
            </Field>
          </fieldset>
        );
      })}
      <div className="flex items-center gap-3">
        {draft.imageThumb ? (
          // eslint-disable-next-line @next/next/no-img-element -- a library thumbnail
          <img src={draft.imageThumb} alt="" className="h-16 w-24 rounded-md border border-line object-cover" />
        ) : (
          <span className="flex h-16 w-24 items-center justify-center rounded-md border border-dashed border-line-strong text-xs text-muted">{t('aboutPage.noPicture')}</span>
        )}
        <div className="flex flex-col gap-1">
          <span className="text-sm text-text">{t('aboutPage.offerImage')}</span>
          <div className="flex gap-1">
            <Button size="sm" icon={<ImagePlus aria-hidden />} onClick={() => setPicking(true)}>
              {t('aboutPage.choose')}
            </Button>
            {draft.imageAssetId && (
              <IconButton size="sm" icon={<Trash2 aria-hidden />} label={t('aboutPage.remove')} onClick={() => change({ imageAssetId: null, imageThumb: null })} />
            )}
          </div>
          {errors.imageAssetId && <span className="text-sm text-danger">{errors.imageAssetId}</span>}
        </div>
      </div>
      <MediaPicker
        open={picking}
        onOpenChange={setPicking}
        restaurantId={view.restaurantId}
        onPick={([first]) => first && change({ imageAssetId: first.assetId, imageThumb: first.thumbUrl })}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('aboutPage.offerStarts')} optional error={errors.startsAt}>
          <Input type="date" value={draft.starts} onChange={(event) => change({ starts: event.target.value })} />
        </Field>
        <Field label={t('aboutPage.offerEnds')} optional error={errors.endsAt}>
          <Input type="date" value={draft.ends} onChange={(event) => change({ ends: event.target.value })} />
        </Field>
      </div>
      <p className="-mt-2 text-sm text-muted">{t('aboutPage.offerDatesHelp', { zone: view.timezone })}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('aboutPage.offerLink')}>
          <Select
            value={draft.link}
            onChange={(event) => change({ link: event.target.value as Link })}
            options={[
              { value: 'none', label: t('aboutPage.linkNone') },
              { value: 'dish', label: t('aboutPage.linkDish') },
              { value: 'category', label: t('aboutPage.linkCategory') },
            ]}
          />
        </Field>
        {draft.link === 'dish' && (
          <Field label={t('aboutPage.linkDish')} error={errors.productId}>
            <Select value={draft.productId} onChange={(event) => change({ productId: event.target.value })} options={[{ value: '', label: '—' }, ...view.targets.products.map((row) => ({ value: row.id, label: row.name }))]} />
          </Field>
        )}
        {draft.link === 'category' && (
          <Field label={t('aboutPage.linkCategory')} error={errors.categoryId}>
            <Select value={draft.categoryId} onChange={(event) => change({ categoryId: event.target.value })} options={[{ value: '', label: '—' }, ...view.targets.categories.map((row) => ({ value: row.id, label: row.name }))]} />
          </Field>
        )}
      </div>
      <Checkbox label={t('aboutPage.offerActive')} checked={draft.active} onChange={(event) => change({ active: event.target.checked })} />
      <div className={cx('flex flex-wrap items-center gap-2')}>
        <Button variant="primary" onClick={save} disabled={saving}>
          {t('aboutPage.offerSave')}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          {t('aboutPage.offerCancel')}
        </Button>
        {onDelete && (
          <Button variant="ghost" icon={<Trash2 aria-hidden />} onClick={onDelete} className="ms-auto">
            {t('aboutPage.offerDelete')}
          </Button>
        )}
      </div>
    </div>
  );
}
