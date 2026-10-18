'use client';

import { Images, RotateCw, Sparkles, Trash2, Upload } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition, type ReactNode } from 'react';
import { toast } from 'sonner';
import { suggestPalettes, updateBrand } from '@/app/studio/_actions/brand';
import { HEX, type Palette } from '@/lib/brand';
import { FONT_PAIR_IDS, type FontPairId } from '@/lib/font-pairs';
import type { PaletteProblem } from '@/lib/palette';
import { RAIL_STYLES, type RailStyle } from '@/lib/rail';
import type { FeatureKey } from '@/server/domain/entitlements';
import { railFeature } from '@/server/domain/plan-choices';
import type { BrandKitView, BrandPlanView, FaviconChoice } from '@/server/studio/services/brand';
import { describeFailure } from '@/studio/errors';
import { useLocale, useT } from '@/studio/i18n';
import { MediaPicker } from '@/studio/media/MediaPicker';
import { uploadMedia } from '@/studio/media/upload';
import { UpgradeHint } from '@/studio/plans/UpgradeHint';
import { Alert } from '@/studio/ui/Alert';
import { Button } from '@/studio/ui/Button';
import { cx } from '@/studio/ui/cx';
import { Field } from '@/studio/ui/Field';
import { IconButton } from '@/studio/ui/IconButton';
import { Input } from '@/studio/ui/Input';
import { Select } from '@/studio/ui/Select';
import { BrandSample } from './BrandSample';
import { FontPairPicker } from './FontPairPicker';
import { checkPalette, PaletteEditor } from './PaletteEditor';
import { PresetPicker, Swatches } from './PresetPicker';

type Logo = { assetId: string; thumbUrl: string } | null;

function Section({ id, title, intro, children }: { id: string; title: string; intro?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4 border-t border-line py-7 first:border-t-0 first:pt-2">
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

/** One logo slot: its thumbnail, a choice from the library, an upload in place, and removal. */
function LogoSlot({
  label,
  imageLabel,
  uploadLabel,
  logo,
  restaurantId,
  onChange,
}: {
  label: string;
  imageLabel: string;
  uploadLabel: string;
  logo: Logo;
  restaurantId: string;
  onChange: (logo: Logo) => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const file = useRef<HTMLInputElement>(null);
  const [picking, setPicking] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const upload = async (chosen: File) => {
    setProblem(null);
    setProgress(0);
    const result = await uploadMedia(chosen, { restaurantId }, { onProgress: setProgress, folder: 'brand' });
    setProgress(null);
    if (!result.ok) return setProblem(describeFailure(t, locale, result.error).message);
    onChange({ assetId: result.data.assetId, thumbUrl: URL.createObjectURL(chosen) });
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-text">{label}</span>
      <div className="flex flex-wrap items-center gap-3">
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element -- a library thumbnail, or the file just uploaded
          <img src={logo.thumbUrl} alt={imageLabel} className="h-16 w-36 rounded-md border border-line bg-surface object-contain p-1" />
        ) : (
          <span className="flex h-16 w-36 items-center justify-center rounded-md border border-dashed border-line-strong text-xs text-muted">
            {t('brand.logo.none')}
          </span>
        )}
        <div className="flex flex-wrap gap-1">
          <Button size="sm" icon={<Images aria-hidden />} onClick={() => setPicking(true)}>
            {t('brand.logo.choose')}
          </Button>
          <input
            ref={file}
            type="file"
            accept="image/png,image/svg+xml,image/webp,image/jpeg"
            aria-label={uploadLabel}
            className="sr-only"
            tabIndex={-1}
            onChange={(event) => {
              const chosen = event.target.files?.[0];
              event.target.value = '';
              if (chosen) void upload(chosen);
            }}
          />
          <Button size="sm" icon={<Upload aria-hidden />} onClick={() => file.current?.click()} pending={progress !== null}>
            {progress === null ? t('brand.logo.uploadButton') : t('brand.logo.uploading', { percent: Math.round(progress * 100) })}
          </Button>
          {logo && <IconButton size="sm" icon={<Trash2 aria-hidden />} label={t('brand.logo.remove', { logo: label })} onClick={() => onChange(null)} />}
        </div>
      </div>
      {problem && (
        <p role="alert" className="text-sm text-danger">
          {problem}
        </p>
      )}
      <MediaPicker open={picking} onOpenChange={setPicking} restaurantId={restaurantId} onPick={([first]) => first && onChange({ assetId: first.assetId, thumbUrl: first.thumbUrl })} />
    </div>
  );
}

/** A saved choice the plan no longer includes: kept, and what guests get meanwhile. */
function LockedChoice({ fallback, choice }: { fallback: string; choice: string }) {
  const t = useT();
  return <p className="max-w-[65ch] text-sm text-muted">{t('brand.lockedChoice', { fallback, choice })}</p>;
}

/** The order the motion section's hint picks the feature to name: the animated rails first, the melting dish last. */
const MOTION_LOCKS: readonly FeatureKey[] = ['design.railStyles', 'design.expressiveMotion', 'immersive.stage'];

/**
 * The Brand tab (spec 12): logos and favicon, the palette of the theme guests see with its contrast checked live, palettes
 * suggested from the logo, the font pair, the rail and motion, and a sample of the menu drawn from what is on screen.
 * Saving needs every text pair readable; a weak accent is saved and named. A pair, rail or motion level the restaurant's
 * plan does not include is shown locked with the way to get it; the one already saved is kept and says what guests see.
 */
export function BrandForm({ menuId, kit }: { menuId: string; kit: BrandKitView & { plan: BrandPlanView } }) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const { plan } = kit;
  const planOf = (feature: FeatureKey | null) => (feature === null ? undefined : plan.upgrade.lowest[feature]);
  /** A rail or motion level as a select option: one the plan lacks is named with its plan and cannot be chosen. */
  const choiceOption = (value: string, label: string, feature: FeatureKey | null, open: boolean) => {
    if (open) return { value, label };
    const lowest = planOf(feature);
    return {
      value,
      label: `${label} · ${lowest ? t('upgrade.partOf', { plan: plan.upgrade.planNames[lowest] }) : t('upgrade.notInPlan')}`,
      disabled: true,
    };
  };
  const lockedRailFeatures = RAIL_STYLES.filter((style) => !plan.rails.includes(style)).map(railFeature);
  const motionLock =
    MOTION_LOCKS.find((feature) => (feature === 'design.expressiveMotion' ? !plan.motions.includes('expressive') : lockedRailFeatures.includes(feature))) ??
    null;
  const [theme, setTheme] = useState(kit.theme);
  const [palettes, setPalettes] = useState(kit.tokens);
  const [logo, setLogo] = useState<Logo>(kit.logo);
  const [logoDark, setLogoDark] = useState<Logo>(kit.logoDark);
  const [favicon, setFavicon] = useState<FaviconChoice>(kit.favicon);
  const [faviconPicking, setFaviconPicking] = useState(false);
  const [faviconThumb, setFaviconThumb] = useState(kit.faviconThumbUrl);
  const [fontPairId, setFontPairId] = useState<FontPairId>(kit.fontPairId);
  const [railStyle, setRailStyle] = useState<RailStyle>(kit.railStyle);
  const [motion, setMotion] = useState(kit.motionIntensity);
  const [logoText, setLogoText] = useState(kit.logoText);
  const [suggestions, setSuggestions] = useState<Palette[] | null>(null);
  const [warnings, setWarnings] = useState<PaletteProblem[]>([]);
  const [failure, setFailure] = useState<{ code: string; message: string; attempt: number } | null>(null);
  const [saving, startSaving] = useTransition();
  const [suggesting, startSuggesting] = useTransition();

  const palette = palettes[theme];
  const setPalette = (next: Palette) => setPalettes((current) => ({ ...current, [theme]: next }));
  const results = checkPalette(palette);
  const failing = results.filter((result) => result.state === 'fail');
  const incomplete = (Object.keys(palette) as Array<keyof Palette>).some((key) => !HEX.test(palette[key]));
  const blocked = failing.length > 0 || incomplete || logoText.trim() === '';
  const sampleLogo = theme === 'dark' ? (logoDark ?? logo) : logo;

  const suggest = () =>
    startSuggesting(async () => {
      if (!logo) return;
      const result = await suggestPalettes({ menuId, assetId: logo.assetId, theme });
      if (!result.ok) {
        toast.error(describeFailure(t, locale, result.error).message);
        return;
      }
      setSuggestions(result.data.palettes);
    });

  const save = () =>
    startSaving(async () => {
      const attempt = (failure?.attempt ?? 0) + 1;
      const result = await updateBrand({
        menuId,
        version: kit.version,
        theme,
        palette,
        logoAssetId: logo?.assetId ?? null,
        logoDarkAssetId: logoDark?.assetId ?? null,
        favicon: favicon.kind === 'fromLogo' && !logo ? { kind: 'none' } : favicon,
        fontPairId,
        railStyle,
        motionIntensity: motion,
        logoText,
      });
      if (!result.ok) {
        setFailure({ code: result.error.code, message: describeFailure(t, locale, result.error).message, attempt });
        return;
      }
      setFailure(null);
      setWarnings(result.data.warnings);
      toast.success(t('brand.saved'));
      router.refresh();
    });

  return (
    <div className="grid max-w-6xl gap-x-10 px-8 pt-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
        className="flex min-w-0 flex-col"
      >
        <Section id="brand-logo" title={t('brand.logo.title')} intro={t('brand.logo.intro')}>
          <LogoSlot
            label={t('brand.logo.light')}
            imageLabel={t('brand.logo.current')}
            uploadLabel={t('brand.logo.upload')}
            logo={logo}
            restaurantId={kit.restaurantId}
            onChange={(next) => {
              setLogo(next);
              setSuggestions(null);
            }}
          />
          <LogoSlot
            label={t('brand.logo.dark')}
            imageLabel={t('brand.logo.currentDark')}
            uploadLabel={t('brand.logo.uploadDark')}
            logo={logoDark}
            restaurantId={kit.restaurantId}
            onChange={setLogoDark}
          />
          <Field label={t('brand.logoText')} hint={t('brand.logoTextHint')} className="max-w-sm">
            <Input value={logoText} maxLength={60} onChange={(event) => setLogoText(event.target.value)} />
          </Field>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium text-text">{t('brand.favicon.title')}</legend>
            {(['none', 'fromLogo', 'asset'] as const).map((kind) => (
              <label key={kind} className={cx('flex items-center gap-2 text-sm text-text', kind === 'fromLogo' && !logo && 'opacity-50')}>
                <input
                  type="radio"
                  name="favicon"
                  checked={favicon.kind === kind}
                  disabled={kind === 'fromLogo' && !logo}
                  onChange={() => (kind === 'asset' ? setFaviconPicking(true) : setFavicon({ kind }))}
                  className="size-3.5 accent-ink"
                />
                {t(`brand.favicon.${kind}`)}
              </label>
            ))}
            {favicon.kind === 'asset' && faviconThumb && (
              // eslint-disable-next-line @next/next/no-img-element -- a library thumbnail
              <img src={faviconThumb} alt={t('brand.favicon.current')} className="size-10 rounded-sm border border-line object-contain" />
            )}
            <MediaPicker
              open={faviconPicking}
              onOpenChange={setFaviconPicking}
              restaurantId={kit.restaurantId}
              onPick={([first]) => {
                if (!first) return;
                setFavicon({ kind: 'asset', assetId: first.assetId });
                setFaviconThumb(first.thumbUrl);
              }}
            />
          </fieldset>
        </Section>

        <Section id="brand-colours" title={t('brand.colours')} intro={t('brand.coloursIntro')}>
          <div role="radiogroup" aria-label={t('brand.theme')} className="flex gap-4">
            {(['light', 'dark'] as const).map((value) => (
              <label key={value} className="flex items-center gap-2 text-sm text-text">
                <input
                  type="radio"
                  name="theme"
                  checked={theme === value}
                  onChange={() => {
                    setTheme(value);
                    setSuggestions(null);
                  }}
                  className="size-3.5 accent-ink"
                />
                {t(`brand.theme.${value}`)}
              </label>
            ))}
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-text">{t('brand.presets')}</span>
            <PresetPicker theme={theme} onPick={setPalette} />
          </div>
          <div className="flex flex-col gap-2">
            <div>
              <Button size="sm" icon={<Sparkles aria-hidden />} onClick={suggest} disabled={!logo} pending={suggesting}>
                {t('brand.suggest')}
              </Button>
              {!logo && <span className="ms-2 text-sm text-muted">{t('brand.suggestNeedsLogo')}</span>}
            </div>
            {suggestions && (
              <ul aria-label={t('brand.suggestions')} className="flex flex-wrap gap-2">
                {suggestions.map((suggestion, index) => (
                  <li key={index} className="flex items-center gap-2 rounded-md border border-line p-2">
                    <Swatches palette={suggestion} />
                    <Button size="sm" variant="ghost" onClick={() => setPalette({ ...suggestion })}>
                      {t('brand.suggestion.apply', { n: index + 1 })}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <PaletteEditor palette={palette} onChange={setPalette} />
        </Section>

        <Section id="brand-type" title={t('brand.fonts')} intro={t('brand.fontsIntro')}>
          <FontPairPicker value={fontPairId} onChange={setFontPairId} allowed={plan.fontPairs} stored={kit.fontPairId} upgrade={plan.upgrade} />
          {!plan.fontPairs.includes(fontPairId) && (
            <LockedChoice fallback={t(`brand.pair.name.${plan.guestSees.fontPairId}`)} choice={t(`brand.pair.name.${fontPairId}`)} />
          )}
          {plan.fontPairs.length < FONT_PAIR_IDS.length && <UpgradeHint feature="design.fontPairs" info={plan.upgrade} />}
        </Section>

        <Section id="brand-motion" title={t('brand.motion.title')} intro={t('brand.motion.intro')}>
          <div className="grid max-w-xl gap-4 sm:grid-cols-2">
            <Field label={t('brand.rail.label')} hint={motion === 'none' ? t('brand.rail.plainWithoutMotion') : undefined}>
              <Select
                value={railStyle}
                onChange={(event) => setRailStyle(event.target.value as RailStyle)}
                options={RAIL_STYLES.map((style) => {
                  const feature = railFeature(style);
                  return choiceOption(style, t(`brand.rail.${style}`), feature, plan.rails.includes(style) || style === kit.railStyle);
                })}
              />
            </Field>
            <Field label={t('brand.motion.label')}>
              <Select
                value={motion}
                onChange={(event) => setMotion(event.target.value as typeof motion)}
                options={(['none', 'subtle', 'expressive'] as const).map((level) =>
                  choiceOption(level, t(`brand.motion.${level}`), 'design.expressiveMotion', plan.motions.includes(level) || level === kit.motionIntensity),
                )}
              />
            </Field>
          </div>
          {!plan.rails.includes(railStyle) && <LockedChoice fallback={t(`brand.rail.${plan.guestSees.railStyle}`)} choice={t(`brand.rail.${railStyle}`)} />}
          {!plan.motions.includes(motion) && (
            <LockedChoice fallback={t(`brand.motion.${plan.guestSees.motionIntensity}`)} choice={t(`brand.motion.${motion}`)} />
          )}
          {motionLock && <UpgradeHint feature={motionLock} info={plan.upgrade} />}
        </Section>

        <div className="sticky bottom-0 z-10 flex flex-col gap-3 border-t border-line bg-bg py-3">
          {failure && (
            <Alert key={failure.attempt} tone="danger">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span>{failure.message}</span>
                {failure.code === 'CONFLICT' && (
                  <Button size="sm" icon={<RotateCw aria-hidden />} onClick={() => window.location.reload()}>
                    {t('content.drawer.reload')}
                  </Button>
                )}
              </div>
            </Alert>
          )}
          {warnings.length > 0 && (
            <Alert tone="neutral">
              <span className="flex flex-col gap-0.5">
                <span>{t('brand.warnings')}</span>
                {warnings.map((warning) => (
                  <span key={`${warning.foreground}/${warning.background}`}>
                    {t(`brand.pair.${warning.foreground}/${warning.background}`)}: <bdi dir="ltr">{warning.ratio.toFixed(2)}:1</bdi>
                  </span>
                ))}
              </span>
            </Alert>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant="primary" pending={saving} disabled={blocked}>
              {t('brand.save')}
            </Button>
            {failing.length > 0 && (
              <p role="status" className="text-sm text-danger">
                {failing
                  .map((result) => t('brand.blocked', { pair: t(`brand.pair.${result.foreground}/${result.background}`), ratio: result.ratio!.toFixed(2) }))
                  .join(' ')}
              </p>
            )}
          </div>
        </div>
      </form>

      <aside className="pb-6 xl:pb-0">
        <div className="py-2 xl:sticky xl:top-16">
          <BrandSample palette={palette} pair={fontPairId} logoUrl={sampleLogo?.thumbUrl ?? null} logoText={logoText} />
        </div>
      </aside>
    </div>
  );
}

