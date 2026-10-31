'use client';

import { ArrowLeft, Copy, ExternalLink, RotateCcw, Save, SlidersHorizontal, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { applyDesign, deleteDesign, resetDesign, saveDesign, setPoweredBy, setSeasonEffect, updateDesign } from '@/app/studio/_actions/design';
import { LOCALE_NAMES, type Locale } from '@/lib/locale';
import { TEMPLATES, type DesignOverrides, type TemplateId } from '@/lib/templates';
import { DEFAULT_FRAMING } from '@/lib/templates/resolve';
import type { ModelFraming, SceneMedia } from '@/lib/templates/types';
import type { DesignView, SavedDesign } from '@/server/studio/services/design';
import type { DesignMessage } from '@/ui/template/PreviewDesign';
import { describeFailure } from '@/studio/errors';
import { useLocale, useT } from '@/studio/i18n';
import { Button, buttonClasses } from '@/studio/ui/Button';
import { ConfirmDialog } from '@/studio/ui/ConfirmDialog';
import { cx } from '@/studio/ui/cx';
import { Dialog } from '@/studio/ui/Dialog';
import { Field } from '@/studio/ui/Field';
import { IconButton } from '@/studio/ui/IconButton';
import { Input } from '@/studio/ui/Input';
import { Switch } from '@/studio/ui/Switch';
import { SEASON_EFFECTS, type SeasonEffect } from '@/server/domain/seasons';
import { UpgradeHint } from '@/studio/plans/UpgradeHint';
import { Customizer, paletteBlocked } from './Customizer';
import { Segmented } from './controls';
import { Gallery, isSoon, soonStyleOf, type GallerySelection } from './Gallery';

const DEVICES = {
  phone: { width: 390, height: 844 },
  tablet: { width: 834, height: 1112 },
  desktop: { width: 1280, height: 800 },
} as const;
type Device = keyof typeof DEVICES;

/** The business's settings that carry over from one template to another (as the server keeps them). */
function contentOnly(overrides: DesignOverrides): DesignOverrides {
  const { featured, promo, info, ordering } = overrides;
  return { ...(featured ? { featured } : {}), ...(promo !== undefined ? { promo } : {}), ...(info ? { info } : {}), ...(ordering ? { ordering } : {}) };
}

/** A background file with the framing being edited, as a published menu would get it. */
function withFraming(media: SceneMedia, framing: Partial<ModelFraming> | undefined): SceneMedia {
  return media.kind === 'model' ? { ...media, framing: { ...DEFAULT_FRAMING, ...framing } } : media;
}

/**
 * The menu drawn as guests will see it, in a device frame at the device's size, scaled to fit. The frame loads the
 * draft preview with the template asked for; unsaved changes reach it as messages, so it redraws without reloading.
 */
function PreviewFrame({ src, device, title, message }: { src: string; device: Device; title: string; message: unknown }) {
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [scale, setScale] = useState(0.5);
  const size = DEVICES[device];
  const latest = useRef(message);

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setScale(Math.min(1, entry.contentRect.width / size.width, (window.innerHeight - 220) / size.height));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [size.width, size.height]);

  // The frame says when it is ready; it then gets the latest design, and every change after that.
  useEffect(() => {
    const onMessage = (event: MessageEvent<{ type?: string }>) => {
      if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow) return;
      if (event.data?.type === 'buzzify:preview-ready') frame.current?.contentWindow?.postMessage(latest.current, window.location.origin);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);
  useEffect(() => {
    latest.current = message;
    const timer = setTimeout(() => frame.current?.contentWindow?.postMessage(message, window.location.origin), 120);
    return () => clearTimeout(timer);
  }, [message]);

  return (
    <div ref={box} dir="ltr" className="w-full">
      <div className="relative mx-auto overflow-hidden rounded-xl border border-line bg-surface shadow-sm" style={{ width: size.width * scale, height: size.height * scale }}>
        <iframe ref={frame} src={src} title={title} className="absolute left-0 top-0 origin-top-left border-0 bg-white" style={{ width: size.width, height: size.height, transform: `scale(${scale})` }} />
      </div>
    </div>
  );
}

/**
 * The Design tab: choose a template from the gallery and preview it on the menu's own products, apply it, customize it
 * with the preview following every change, reset it, and save designs to reuse. Applying and saving change the draft
 * only; guests see the design once the menu is published.
 */
export function DesignStudio({
  menuId,
  state,
  customizing = false,
  canSeeStyles = false,
}: {
  menuId: string;
  state: DesignView;
  customizing?: boolean;
  /** Whether the visitor may read the menu-style files (`styleFileAccess`), which the gallery's Styles view shows. */
  canSeeStyles?: boolean;
}) {
  const t = useT();
  const { locale: studioLocale } = useLocale();
  const router = useRouter();
  const current: TemplateId | 'classic' = state.templateId ?? 'classic';
  const [selected, setSelected] = useState<GallerySelection>(current);
  const [mode, setModeState] = useState<'gallery' | 'customize'>(customizing ? 'customize' : 'gallery');
  // The view is kept in the address, so a save (which reloads the tab's data) stays where the person was.
  const setMode = (next: 'gallery' | 'customize') => {
    setModeState(next);
    const url = new URL(window.location.href);
    if (next === 'customize') url.searchParams.set('customize', '1');
    else url.searchParams.delete('customize');
    window.history.replaceState(null, '', url);
  };
  const [overrides, setOverrides] = useState<DesignOverrides>(state.overrides);
  const [device, setDevice] = useState<Device>('phone');
  const [locale, setLocale] = useState<Locale>(state.defaultLocale);
  const [saving, startSaving] = useTransition();
  const [poweredBy, setPoweredByState] = useState(state.showPoweredBy);
  const [poweredByPending, startPoweredBy] = useTransition();
  const [season, setSeasonState] = useState<SeasonEffect | null>(state.season);
  const [seasonPending, startSeason] = useTransition();
  const [naming, setNaming] = useState<null | 'menu' | TemplateId>(null);
  const [name, setName] = useState('');
  const [shared, setShared] = useState(false);
  const [deleting, setDeleting] = useState<SavedDesign | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  // Background files met in this visit (the one stored, those picked since), resolved, so the preview plays at once.
  const [sceneFiles, setSceneFiles] = useState<Record<string, SceneMedia>>(() => (state.sceneMedia ? { [state.sceneMedia.assetId]: state.sceneMedia } : {}));
  const sceneMedia = overrides.sceneAsset ? (sceneFiles[overrides.sceneAsset.assetId] ?? null) : null;

  const dirty = JSON.stringify(overrides) !== JSON.stringify(state.overrides);
  const preset = state.templateId ? TEMPLATES[state.templateId] : null;
  const blocked = preset ? paletteBlocked(preset, overrides) : false;
  // A coming-soon style has no template to draw: the preview shows its mockup instead (below).
  const soon = soonStyleOf(selected);
  const picked: TemplateId | 'classic' | null = isSoon(selected) ? null : selected;
  const previewTemplate = mode === 'customize' || !picked ? current : picked;
  const message = useMemo(
    (): DesignMessage => ({
      type: 'buzzify:design',
      templateId: previewTemplate === 'classic' ? null : previewTemplate,
      overrides: previewTemplate === current ? overrides : contentOnly(overrides),
      // The file belongs to the look of the template it was chosen for, like the rest of the overrides.
      media: previewTemplate === current && sceneMedia ? withFraming(sceneMedia, overrides.sceneAsset?.framing) : null,
    }),
    [previewTemplate, current, overrides, sceneMedia],
  );
  const src = soon && mode === 'gallery' ? `/studio/style-files/page/${soon.page}?style=${soon.key}` : `/studio/preview/${menuId}/${locale}?template=${previewTemplate}`;
  const label = (selection: GallerySelection) => {
    if (selection === 'classic') return t('design.classic');
    if (isSoon(selection)) {
      const style = soonStyleOf(selection);
      return style ? t(`styles.${style.id}.name`) : '';
    }
    return TEMPLATES[selection].name;
  };
  const previewLabel = soon && mode === 'gallery' ? label(selected) : label(previewTemplate);

  const fail = useCallback(
    (error: Parameters<typeof describeFailure>[2]): void => {
      toast.error(describeFailure(t, studioLocale, error).message);
    },
    [t, studioLocale],
  );

  const apply = () =>
    startSaving(async () => {
      if (!picked) return;
      const choice = picked === 'classic' ? { kind: 'classic' as const } : { kind: 'preset' as const, templateId: picked };
      const result = await applyDesign({ menuId, version: state.version, choice });
      if (!result.ok) return fail(result.error);
      toast.success(t('design.applied'));
      router.refresh();
    });

  const applySaved = (design: SavedDesign) =>
    startSaving(async () => {
      const result = await applyDesign({ menuId, version: state.version, choice: { kind: 'custom', customTemplateId: design.id } });
      if (!result.ok) return fail(result.error);
      toast.success(t('design.applied'));
      router.refresh();
    });

  const save = () =>
    startSaving(async () => {
      const result = await updateDesign({ menuId, version: state.version, overrides });
      if (!result.ok) return fail(result.error);
      toast.success(t('design.saved'));
      router.refresh();
    });

  const reset = async (): Promise<true | { message: string }> => {
    const result = await resetDesign({ menuId, version: state.version });
    if (!result.ok) return { message: describeFailure(t, studioLocale, result.error).message };
    toast.success(t('design.resetDone'));
    router.refresh();
    return true;
  };

  const saveAs = () =>
    startSaving(async () => {
      const from = naming;
      if (!from) return;
      const result = await saveDesign({ menuId, name, shared, from });
      if (!result.ok) return fail(result.error);
      setNaming(null);
      setName('');
      toast.success(t('design.custom.saved'));
      router.refresh();
    });

  const remove = async (): Promise<true | { message: string }> => {
    if (!deleting) return true;
    const result = await deleteDesign({ menuId, id: deleting.id });
    if (!result.ok) return { message: describeFailure(t, studioLocale, result.error).message };
    toast.success(t('design.custom.deleted'));
    router.refresh();
    return true;
  };

  // The effect is read live by guests, so it saves on its own and needs no publish.
  const chooseSeason = (next: SeasonEffect | null) =>
    startSeason(async () => {
      const result = await setSeasonEffect({ menuId, effect: next });
      if (!result.ok) return fail(result.error);
      setSeasonState(next);
      toast.success(t('design.season.saved'));
      router.refresh();
    });

  const togglePoweredBy = (show: boolean) =>
    startPoweredBy(async () => {
      const result = await setPoweredBy({ restaurantId: state.restaurantId, show });
      if (!result.ok) return fail(result.error);
      setPoweredByState(show);
      toast.success(t('design.poweredBySaved'));
      router.refresh();
    });

  return (
    <div className="grid gap-x-8 gap-y-6 px-8 pb-12 pt-6 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,30rem)]">
      <div className="flex min-w-0 flex-col gap-6">
        {mode === 'gallery' ? (
          <>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="flex flex-col gap-1">
                <h2 className="text-md font-semibold text-text">{t('design.gallery.title')}</h2>
                <p className="max-w-[65ch] text-sm text-muted">{t('design.gallery.intro')}</p>
              </div>
            </div>
            <div className="sticky top-12 z-10 -mx-2 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-bg/95 px-3 py-2">
              <span className="me-auto text-sm text-text">
                <span className="text-muted">{t('design.selected')} </span>
                <strong className="font-semibold">{label(selected)}</strong>
                {selected === current && <span className="text-muted"> · {t('design.current')}</span>}
              </span>
              {soon && <span className="inline-flex items-center rounded-full border border-line bg-surface px-2 py-0.5 text-xs font-medium text-text">{t('design.comingSoon')}</span>}
              {picked && selected !== current && (
                <Button variant="primary" pending={saving} onClick={apply}>
                  {selected === 'classic' ? t('design.applyClassic') : t('design.apply')}
                </Button>
              )}
              {selected === current && current !== 'classic' && (
                <Button variant="primary" icon={<SlidersHorizontal aria-hidden />} onClick={() => setMode('customize')}>
                  {t('design.customize')}
                </Button>
              )}
              {picked && picked !== 'classic' && (
                <Button
                  icon={<Copy aria-hidden />}
                  onClick={() => {
                    setNaming(picked);
                    setName(`${label(picked)} · ${t('design.copy')}`);
                  }}
                >
                  {t('design.duplicate')}
                </Button>
              )}
            </div>
            <Gallery restaurantType={state.restaurantType} current={current} selected={selected} onSelect={setSelected} canSeeStyles={canSeeStyles} plan={state.plan} />
            <section aria-labelledby="design-season" className="flex flex-col gap-3 border-t border-line pt-6">
              <h2 id="design-season" className="text-md font-semibold text-text">
                {t('design.season.title')}
              </h2>
              <p className="text-sm text-muted">{t('design.season.intro')}</p>
              <div className={cx(seasonPending && 'pointer-events-none opacity-60')}>
                <Segmented<SeasonEffect | 'none'>
                  label={t('design.season.title')}
                  value={season ?? 'none'}
                  options={[{ value: 'none', label: t('design.season.none') }, ...SEASON_EFFECTS.map((effect) => ({ value: effect, label: t(`design.season.${effect}`) }))]}
                  onChange={(next) => {
                    if (next !== (season ?? 'none')) chooseSeason(next === 'none' ? null : next);
                  }}
                />
              </div>
              {!state.plan.seasonalParticles && <UpgradeHint feature="design.seasonalParticles" info={state.plan.upgrade} />}
            </section>
            <section aria-labelledby="design-saved" className="flex flex-col gap-3 border-t border-line pt-6">
              <h2 id="design-saved" className="text-md font-semibold text-text">
                {t('design.custom.title')}
              </h2>
              {state.saved.length === 0 ? (
                <p className="text-sm text-muted">{t('design.custom.none')}</p>
              ) : (
                <ul className="divide-y divide-line rounded-lg border border-line">
                  {state.saved.map((design) => (
                    <li key={design.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                      <span className="me-auto flex flex-col">
                        <span className="text-sm font-medium text-text">
                          {design.name}
                          {state.customTemplateId === design.id && <span className="text-muted"> · {t('design.current')}</span>}
                        </span>
                        <span className="text-xs text-muted">
                          {t('design.custom.basedOn', { name: TEMPLATES[design.basePresetId].name })} · {t(design.shared ? 'design.custom.shared' : 'design.custom.own')}
                        </span>
                      </span>
                      <Button size="sm" pending={saving} onClick={() => applySaved(design)}>
                        {t('design.custom.apply')}
                      </Button>
                      {(!design.shared || state.superAdmin) && <IconButton size="sm" icon={<Trash2 aria-hidden />} label={t('design.custom.delete', { name: design.name })} onClick={() => setDeleting(design)} />}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        ) : (
          preset && (
            <>
              <div className="sticky top-12 z-10 -mx-2 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-bg/95 px-3 py-2">
                <Button variant="ghost" icon={<ArrowLeft aria-hidden className="rtl:-scale-x-100" />} onClick={() => setMode('gallery')}>
                  {t('design.backToGallery')}
                </Button>
                <span className="me-auto text-sm text-text">
                  <strong className="font-semibold">{preset.name}</strong>
                  {dirty && <span className="text-muted"> · {t('design.unsaved')}</span>}
                </span>
                <Button icon={<RotateCcw aria-hidden />} onClick={() => setConfirmReset(true)}>
                  {t('design.reset')}
                </Button>
                <Button
                  onClick={() => {
                    setNaming('menu');
                    setName(`${preset.name} · ${t('design.custom.mine')}`);
                  }}
                >
                  {t('design.saveAsCustom')}
                </Button>
                {dirty && (
                  <Button variant="ghost" onClick={() => setOverrides(state.overrides)}>
                    {t('design.discard')}
                  </Button>
                )}
                <Button variant="primary" icon={<Save aria-hidden />} pending={saving} disabled={!dirty || blocked} onClick={save}>
                  {t('design.save')}
                </Button>
              </div>
              <Customizer preset={preset} state={state} overrides={overrides} onChange={setOverrides} sceneMedia={sceneMedia} onPickScene={(media) => setSceneFiles((known) => ({ ...known, [media.assetId]: media }))} poweredBy={poweredBy} poweredByPending={poweredByPending} onPoweredBy={togglePoweredBy} />
            </>
          )
        )}
      </div>

      <aside aria-label={t('design.preview.title')} className="flex flex-col gap-3 xl:sticky xl:top-14 xl:self-start">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div role="group" aria-label={t('design.preview.device')} className="inline-flex rounded-md border border-line p-0.5">
            {(Object.keys(DEVICES) as Device[]).map((value) => (
              <button key={value} type="button" aria-pressed={device === value} onClick={() => setDevice(value)} className={cx('h-7 rounded-sm px-3 text-sm transition-colors', device === value ? 'bg-text text-bg' : 'text-muted hover:text-text')}>
                {t(`design.preview.${value}`)}
              </button>
            ))}
          </div>
          <div role="group" aria-label={t('design.preview.language')} className="inline-flex rounded-md border border-line p-0.5">
            {state.locales.map((code) => (
              <button key={code} type="button" lang={code} aria-pressed={locale === code} onClick={() => setLocale(code)} className={cx('h-7 rounded-sm px-2.5 text-sm transition-colors', locale === code ? 'bg-text text-bg' : 'text-muted hover:text-text')}>
                {LOCALE_NAMES[code]}
              </button>
            ))}
          </div>
        </div>
        {soon && mode === 'gallery' && <p className="text-sm font-medium text-text">{t('design.comingSoonPreview')}</p>}
        <PreviewFrame key={`${src}-${device}`} src={src} device={device} title={t('design.preview.frameTitle', { template: previewLabel, size: t(`design.preview.${device}`) })} message={message} />
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted">{soon && mode === 'gallery' ? t('design.comingSoonNote') : t('design.preview.note')}</p>
          <a href={src} target="_blank" rel="noopener noreferrer" className={buttonClasses('secondary', 'sm')}>
            <ExternalLink aria-hidden />
            {t('design.preview.newTab')}
          </a>
        </div>
      </aside>

      <Dialog open={naming !== null} onOpenChange={(open) => !open && setNaming(null)} title={naming === 'menu' ? t('design.saveAsCustom') : t('design.duplicate')} description={t('design.custom.intro')}>
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim()) saveAs();
          }}
        >
          <Field label={t('design.custom.name')}>
            <Input value={name} maxLength={60} onChange={(event) => setName(event.target.value)} autoFocus />
          </Field>
          {state.superAdmin && (
            <label className="flex items-center justify-between gap-3 text-sm text-text">
              {t('design.custom.shareAll')}
              <Switch checked={shared} onCheckedChange={setShared} />
            </label>
          )}
          <div className="flex justify-end gap-2">
            <Button onClick={() => setNaming(null)}>{t('common.cancel')}</Button>
            <Button type="submit" variant="primary" pending={saving} disabled={!name.trim()}>
              {t('design.custom.create')}
            </Button>
          </div>
        </form>
      </Dialog>

      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title={t('design.resetTitle')}
        body={t('design.resetBody')}
        confirmLabel={t('design.reset')}
        tone="primary"
        onConfirm={reset}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t('design.custom.deleteTitle')}
        body={deleting ? t('design.custom.deleteBody', { name: deleting.name }) : ''}
        confirmLabel={t('design.custom.deleteConfirm')}
        tone="danger"
        onConfirm={remove}
      />
    </div>
  );
}
