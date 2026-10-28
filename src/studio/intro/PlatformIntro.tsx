'use client';

import { ArrowDown, ArrowUp, BarChart3, Pencil, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type ReactNode } from 'react';
import { toast } from 'sonner';
import { deletePlatformAdvert, reorderPlatformAdverts, savePlatformAdvert, savePlatformIntroDefault } from '@/app/studio/_actions/platform-intro';
import { describeFailure } from '@/studio/errors';
import { useLocale, useT } from '@/studio/i18n';
import { MediaPicker } from '@/studio/media/MediaPicker';
import { PICTURE_ACCEPT } from '@/studio/media/upload';
import { UploadAsset } from './UploadAsset';
import { Alert } from '@/studio/ui/Alert';
import { Button, buttonClasses } from '@/studio/ui/Button';
import { Checkbox } from '@/studio/ui/Checkbox';
import { ConfirmDialog } from '@/studio/ui/ConfirmDialog';
import { Dialog } from '@/studio/ui/Dialog';
import { Field } from '@/studio/ui/Field';
import { IconButton } from '@/studio/ui/IconButton';
import { Input } from '@/studio/ui/Input';
import { isRtl } from '../workspace/content/shared';

export interface PlatformAdvertRow {
  id: string;
  imageAssetId: string;
  alts: unknown;
  href: string;
  startsAt: string | Date | null;
  endsAt: string | Date | null;
  active: boolean;
  restaurantIds: string[];
  menuIds: string[];
}

export interface PlatformIntroView {
  backgroundAssetId: string | null;
  adverts: PlatformAdvertRow[];
  restaurants: { id: string; name: string }[];
  menus: { id: string; name: string; restaurantId: string; slug: string }[];
  thumbs: Record<string, string>;
}

const CODES = ['en', 'ar', 'ckb'] as const;

function Section({ id, title, intro, children }: { id: string; title: string; intro?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="grid gap-x-12 gap-y-4 border-t border-line py-8 first:border-t-0 first:pt-2 xl:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
      <div className="flex flex-col gap-1">
        <h2 id={id} className="text-md font-semibold text-text">
          {title}
        </h2>
        {intro && <p className="text-sm text-muted">{intro}</p>}
      </div>
      <div className="flex min-w-0 max-w-2xl flex-col gap-4">{children}</div>
    </section>
  );
}

const altOf = (alts: unknown, locale: string) => {
  const map = typeof alts === 'object' && alts !== null ? (alts as Record<string, unknown>) : {};
  const pick = (code: string) => (typeof map[code] === 'string' && map[code] ? (map[code] as string) : '');
  return pick(locale) || pick('en') || pick('ar') || pick('ckb');
};

const dayInput = (value: string | Date | null) => (value ? new Date(value).toISOString().slice(0, 10) : '');

/** A thumbnail, or an empty frame when the file has none (a missing picture is shown as nothing, never as a broken icon). */
function Thumb({ url, label }: { url?: string; label: string }) {
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element -- a small library picture
    <img src={url} alt={label} className="h-16 w-24 rounded-md border border-line object-cover" />
  ) : (
    <span aria-hidden className="block h-16 w-24 rounded-md border border-dashed border-line" />
  );
}

/**
 * The Super Admin's intro page: the default background every intro falls back to, and the adverts shown on intros. An advert shows on
 * every menu, or on the restaurants and menus it lists (a menu is shown when its restaurant or the menu itself is listed).
 */
export function PlatformIntro({ view }: { view: PlatformIntroView }) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const [picking, setPicking] = useState(false);
  const [background, setBackground] = useState<{ assetId: string | null; thumb: string }>({ assetId: view.backgroundAssetId, thumb: view.backgroundAssetId ? (view.thumbs[view.backgroundAssetId] ?? '') : '' });
  const [problem, setProblem] = useState<string | null>(null);
  const [editing, setEditing] = useState<PlatformAdvertRow | 'new' | null>(null);
  const [removing, setRemoving] = useState<PlatformAdvertRow | null>(null);
  const [busy, startBusy] = useTransition();

  const run = (work: () => Promise<{ ok: true } | { ok: false; error: Parameters<typeof describeFailure>[2] }>, done?: string) =>
    startBusy(async () => {
      const result = await work();
      if (!result.ok) return setProblem(describeFailure(t, locale, result.error).message);
      setProblem(null);
      if (done) toast.success(done);
      router.refresh();
    });

  const move = (index: number, by: -1 | 1) => {
    const ids = view.adverts.map((advert) => advert.id);
    const target = index + by;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    run(() => reorderPlatformAdverts({ ids }));
  };

  return (
    <div className="flex max-w-6xl flex-col px-8 pb-10 pt-6">
      <p className="max-w-[65ch] pb-4 text-sm text-muted">{t('platformIntro.intro')}</p>
      {problem && <Alert tone="danger">{problem}</Alert>}

      <Section id="intro-default" title={t('platformIntro.defaultTitle')} intro={t('platformIntro.defaultHelp')}>
        <div className="flex flex-wrap items-center gap-4">
          <Thumb url={background.thumb} label={t('platformIntro.defaultTitle')} />
          <Button onClick={() => setPicking(true)}>{t('introPage.pick')}</Button>
          <UploadAsset target={{ shared: true }} accept={PICTURE_ACCEPT + ',video/mp4,.mp4'} folder="intro" label={t('introPage.upload')} onUploaded={(picked) => setBackground({ assetId: picked.assetId, thumb: picked.thumbUrl })} />
          {background.assetId && !background.thumb && <span className="text-sm text-muted">{t('introPage.fileChosen')}</span>}
          {background.assetId && (
            <Button variant="ghost" onClick={() => setBackground({ assetId: null, thumb: '' })}>
              {t('introPage.clear')}
            </Button>
          )}
          <Button variant="primary" disabled={busy} onClick={() => run(() => savePlatformIntroDefault({ backgroundAssetId: background.assetId }), t('platformIntro.saved'))}>
            {t('platformIntro.save')}
          </Button>
        </div>
        <MediaPicker open={picking} onOpenChange={setPicking} restaurantId={null} kinds="all" onPick={([first]) => first && setBackground({ assetId: first.assetId, thumb: first.thumbUrl })} />
      </Section>

      <Section id="intro-adverts" title={t('platformIntro.advertsTitle')} intro={t('platformIntro.advertsHelp')}>
        <div className="flex flex-wrap gap-3">
          <Button variant="primary" onClick={() => setEditing('new')}>
            <Plus aria-hidden />
            {t('platformIntro.add')}
          </Button>
          <Link href="/studio/platform/intro/reports" className={buttonClasses('secondary', 'md')}>
            <BarChart3 aria-hidden />
            {t('platformIntro.reports')}
          </Link>
        </div>
        {view.adverts.length === 0 ? (
          <p className="text-sm text-muted">{t('platformIntro.none')}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {view.adverts.map((advert, index) => {
              const scope = advert.restaurantIds.length + advert.menuIds.length;
              return (
                <li key={advert.id} className="flex flex-wrap items-center gap-4 rounded-md border border-line p-3">
                  <Thumb url={view.thumbs[advert.imageAssetId]} label={altOf(advert.alts, locale)} />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-sm font-medium text-text">{altOf(advert.alts, locale) || advert.href || t('platformIntro.untitled')}</span>
                    <span className="text-sm text-muted">
                      {advert.active ? t('platformIntro.on') : t('platformIntro.off')} · {scope === 0 ? t('platformIntro.everyMenu') : t('platformIntro.chosen', { restaurants: advert.restaurantIds.length, menus: advert.menuIds.length })}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <IconButton label={t('platformIntro.moveUp')} disabled={busy || index === 0} onClick={() => move(index, -1)} icon={<ArrowUp aria-hidden />} />
                    <IconButton label={t('platformIntro.moveDown')} disabled={busy || index === view.adverts.length - 1} onClick={() => move(index, 1)} icon={<ArrowDown aria-hidden />} />
                    <IconButton label={t('platformIntro.edit')} onClick={() => setEditing(advert)} icon={<Pencil aria-hidden />} />
                    <IconButton label={t('platformIntro.delete')} onClick={() => setRemoving(advert)} icon={<Trash2 aria-hidden />} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {editing && <AdvertDialog key={editing === 'new' ? 'new' : editing.id} advert={editing === 'new' ? null : editing} view={view} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={t('platformIntro.deleteTitle')}
        body={t('platformIntro.deleteBody')}
        confirmLabel={t('platformIntro.delete')}
        onConfirm={async () => {
          if (!removing) return true;
          const result = await deletePlatformAdvert({ advertId: removing.id });
          if (!result.ok) return { message: describeFailure(t, locale, result.error).message };
          router.refresh();
          return true;
        }}
      />
    </div>
  );
}

function AdvertDialog({ advert, view, onClose }: { advert: PlatformAdvertRow | null; view: PlatformIntroView; onClose: () => void }) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const [image, setImage] = useState<{ assetId: string; thumb: string } | null>(advert ? { assetId: advert.imageAssetId, thumb: view.thumbs[advert.imageAssetId] ?? '' } : null);
  const [picking, setPicking] = useState(false);
  const [alts, setAlts] = useState<Record<string, string>>(() => Object.fromEntries(CODES.map((code) => [code, advert ? altOf({ [code]: (advert.alts as Record<string, unknown>)?.[code] }, code) : ''])));
  const [href, setHref] = useState(advert?.href ?? '');
  const [starts, setStarts] = useState(dayInput(advert?.startsAt ?? null));
  const [ends, setEnds] = useState(dayInput(advert?.endsAt ?? null));
  const [active, setActive] = useState(advert?.active ?? true);
  const [restaurantIds, setRestaurantIds] = useState<string[]>(advert?.restaurantIds ?? []);
  const [menuIds, setMenuIds] = useState<string[]>(advert?.menuIds ?? []);
  const [filter, setFilter] = useState('');
  const [failure, setFailure] = useState<{ message: string; fields: Record<string, string> } | null>(null);
  const [saving, startSaving] = useTransition();
  const errors = failure?.fields ?? {};

  const toggle = (list: string[], set: (next: string[]) => void, id: string) => set(list.includes(id) ? list.filter((entry) => entry !== id) : [...list, id]);
  const needle = filter.trim().toLowerCase();
  const restaurants = view.restaurants.filter((row) => !needle || row.name.toLowerCase().includes(needle));
  const menus = view.menus.filter((row) => !needle || row.name.toLowerCase().includes(needle) || row.slug.includes(needle));

  const save = () =>
    startSaving(async () => {
      if (!image) return setFailure({ message: t('platformIntro.needImage'), fields: { imageAssetId: t('platformIntro.needImage') } });
      const result = await savePlatformAdvert({
        ...(advert ? { advertId: advert.id } : {}),
        imageAssetId: image.assetId,
        alts: Object.fromEntries(CODES.map((code) => [code, alts[code] ?? ''])),
        href,
        startsAt: starts ? new Date(`${starts}T00:00:00Z`).toISOString() : null,
        endsAt: ends ? new Date(`${ends}T23:59:59Z`).toISOString() : null,
        active,
        restaurantIds,
        menuIds,
      });
      if (!result.ok) {
        const described = describeFailure(t, locale, result.error);
        return setFailure({ message: described.message, fields: described.fields });
      }
      toast.success(t('platformIntro.saved'));
      router.refresh();
      onClose();
    });

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={advert ? t('platformIntro.edit') : t('platformIntro.add')}
      width="md"
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" disabled={saving} onClick={save}>
            {t('platformIntro.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {failure && Object.keys(errors).length === 0 && <Alert tone="danger">{failure.message}</Alert>}
        <Field label={t('platformIntro.image')} hint={t('platformIntro.imageHelp')} error={errors.imageAssetId}>
          <div className="flex items-center gap-3">
            <Thumb url={image?.thumb} label={t('platformIntro.image')} />
            <Button onClick={() => setPicking(true)}>{t('introPage.pick')}</Button>
            <UploadAsset target={{ shared: true }} accept={PICTURE_ACCEPT} folder="adverts" label={t('introPage.upload')} onUploaded={(picked) => setImage({ assetId: picked.assetId, thumb: picked.thumbUrl })} />
          </div>
        </Field>
        <MediaPicker open={picking} onOpenChange={setPicking} restaurantId={null} onPick={([first]) => first && setImage({ assetId: first.assetId, thumb: first.thumbUrl })} />
        {CODES.map((code) => (
          <Field key={code} label={t('platformIntro.alt', { language: t(`menus.language.${code}`) })} hint={t('platformIntro.altHelp')}>
            <Input value={alts[code] ?? ''} maxLength={200} lang={code} dir={isRtl(code) ? 'rtl' : 'ltr'} onChange={(event) => setAlts((current) => ({ ...current, [code]: event.target.value }))} />
          </Field>
        ))}
        <Field label={t('platformIntro.href')} hint={t('platformIntro.hrefHelp')} error={errors.href}>
          <Input value={href} maxLength={500} dir="ltr" placeholder="https://" onChange={(event) => setHref(event.target.value)} />
        </Field>
        <div className="flex flex-wrap gap-4">
          <Field label={t('platformIntro.starts')}>
            <Input type="date" value={starts} onChange={(event) => setStarts(event.target.value)} />
          </Field>
          <Field label={t('platformIntro.ends')} error={errors.endsAt}>
            <Input type="date" value={ends} onChange={(event) => setEnds(event.target.value)} />
          </Field>
        </div>
        <Checkbox label={t('platformIntro.active')} checked={active} onChange={(event) => setActive(event.target.checked)} />

        <fieldset className="flex flex-col gap-3">
          <legend className="text-sm font-medium text-text">{t('platformIntro.audience')}</legend>
          <p className="text-sm text-muted">{restaurantIds.length + menuIds.length === 0 ? t('platformIntro.audienceAll') : t('platformIntro.audienceSome')}</p>
          <Input type="search" value={filter} onChange={(event) => setFilter(event.target.value)} aria-label={t('platformIntro.filter')} placeholder={t('platformIntro.filter')} />
          {(errors.restaurantIds || errors.menuIds) && <p role="alert" className="text-sm text-danger">{errors.restaurantIds ?? errors.menuIds}</p>}
          <div className="grid max-h-56 gap-1 overflow-y-auto rounded-md border border-line p-2">
            <span className="text-xs font-medium uppercase text-muted">{t('platformIntro.restaurants')}</span>
            {restaurants.map((row) => (
              <Checkbox key={row.id} label={row.name} checked={restaurantIds.includes(row.id)} onChange={() => toggle(restaurantIds, setRestaurantIds, row.id)} />
            ))}
            <span className="pt-2 text-xs font-medium uppercase text-muted">{t('platformIntro.menus')}</span>
            {menus.map((row) => (
              <Checkbox key={row.id} label={`${row.name} (${row.slug})`} checked={menuIds.includes(row.id)} onChange={() => toggle(menuIds, setMenuIds, row.id)} />
            ))}
          </div>
        </fieldset>
      </div>
    </Dialog>
  );
}
