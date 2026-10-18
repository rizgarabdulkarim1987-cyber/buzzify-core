'use client';

import { ImageOff, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { FONT_PAIR_IDS, FONT_PAIR_VARIABLES, FONT_PAIRS, type FontPairId } from '@/lib/font-pairs';
import { LOCALE_NAMES, type Locale } from '@/lib/locale';
import { contrastRatio } from '@/lib/palette';
import {
  CARD_KINDS,
  CORNERS,
  DENSITIES,
  DESIGN_PALETTE_KEYS,
  DETAIL_KINDS,
  HEADING_STYLES,
  HERO_KINDS,
  IMAGE_RATIOS,
  NAV_KINDS,
  OPTION_STYLES,
  SHADOWS,
  type DesignLayout,
  type DesignOverrides,
  type DesignPalette,
  type InfoVisibility,
  type LocalText,
  type SceneSettings,
  type TemplatePreset,
} from '@/lib/templates';
import { designPaletteProblems } from '@/lib/templates/palette';
import { DEFAULT_FRAMING, FRAMING_RANGES, MAX_FEATURED, overriddenPalette, SCALE_RANGE, SCENE_RANGES, TEXT_LIMITS, TRACKING_RANGE } from '@/lib/templates/resolve';
import type { ModelFraming, SceneMedia } from '@/lib/templates/types';
import type { DesignView } from '@/server/studio/services/design';
import { useT } from '@/studio/i18n';
import { cx } from '@/studio/ui/cx';
import { Field } from '@/studio/ui/Field';
import { Input } from '@/studio/ui/Input';
import { Select } from '@/studio/ui/Select';
import { Textarea } from '@/studio/ui/Textarea';
import { ContrastBadge } from '@/studio/workspace/brand/ContrastBadge';
import { face } from '@/studio/workspace/brand/FontPairPicker';
import { Button } from '@/studio/ui/Button';
import { ColourField, Panel, Segmented, Slider, ToggleRow } from './controls';
import { SceneFileMark, ScenePicker } from './ScenePicker';

type Change = (next: DesignOverrides) => void;

/** The pairs the Design tab shows a ratio for: the rules of `designPaletteProblems`, text first. */
const PAIRS: ReadonlyArray<{ foreground: keyof DesignPalette; background: keyof DesignPalette; needs: number; blocking: boolean }> = [
  { foreground: 'text', background: 'bg', needs: 4.5, blocking: true },
  { foreground: 'text', background: 'card', needs: 4.5, blocking: true },
  { foreground: 'muted', background: 'bg', needs: 4.5, blocking: true },
  { foreground: 'muted', background: 'card', needs: 4.5, blocking: true },
  { foreground: 'onButton', background: 'button', needs: 4.5, blocking: false },
  { foreground: 'accent', background: 'bg', needs: 3, blocking: false },
];

const COLOUR_LABEL: Record<keyof DesignPalette, string> = {
  bg: 'brand.colour.bg',
  surface: 'brand.colour.surface',
  raised: 'brand.colour.raised',
  card: 'design.colour.card',
  text: 'brand.colour.text',
  muted: 'brand.colour.muted',
  line: 'brand.colour.line',
  accent: 'brand.colour.accent',
  onAccent: 'brand.colour.onAccent',
  button: 'design.colour.button',
  onButton: 'design.colour.onButton',
};

/** Whether the palette the overrides make can be saved (no text below 4.5:1, no button label below 3:1). */
export function paletteBlocked(preset: TemplatePreset, overrides: DesignOverrides): boolean {
  return designPaletteProblems(overriddenPalette(preset, overrides)).some((problem) => problem.severity === 'block');
}

function PalettePanel({ preset, overrides, onChange }: { preset: TemplatePreset; overrides: DesignOverrides; onChange: Change }) {
  const t = useT();
  const palette = overriddenPalette(preset, overrides);
  const problems = designPaletteProblems(palette);
  const blocking = problems.filter((problem) => problem.severity === 'block');
  const choosePalette = (paletteId: string) => {
    // A curated palette replaces any colours edited by hand.
    onChange({ ...overrides, colors: undefined, paletteId });
  };
  const setColour = (key: keyof DesignPalette, value: string) => onChange({ ...overrides, colors: { ...overrides.colors, [key]: value } });
  return (
    <Panel id="design-palette" title={t('design.section.palette')} intro={t('design.palette.intro')}>
      <div role="radiogroup" aria-label={t('design.palette.curated')} className="grid gap-2 sm:grid-cols-2">
        {preset.palettes.map((entry) => {
          const checked = (overrides.paletteId ?? 'signature') === entry.id && !overrides.colors;
          return (
            <button
              key={entry.id}
              type="button"
              role="radio"
              aria-checked={checked}
              onClick={() => choosePalette(entry.id)}
              className={cx('flex items-center gap-3 rounded-md border p-2 text-start text-sm transition-colors', checked ? 'border-ink ring-1 ring-ink' : 'border-line hover:bg-hover')}
            >
              <span className="flex shrink-0 overflow-hidden rounded" style={{ boxShadow: `inset 0 0 0 1px ${entry.palette.line}` }}>
                {[entry.palette.bg, entry.palette.card, entry.palette.accent, entry.palette.text].map((colour, index) => (
                  <span key={index} className="h-7 w-5" style={{ background: colour }} />
                ))}
              </span>
              <span className="truncate text-text">{entry.name}</span>
            </button>
          );
        })}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {DESIGN_PALETTE_KEYS.map((key) => (
          <ColourField key={key} label={t(COLOUR_LABEL[key])} value={overrides.colors?.[key] ?? palette[key]} invalid={blocking.some((problem) => problem.foreground === key)} onChange={(value) => setColour(key, value)} />
        ))}
      </div>
      <div className="flex flex-col gap-1.5">
        <h3 className="text-sm font-medium text-text">{t('brand.contrast.title')}</h3>
        <ul className="grid gap-1 text-sm sm:grid-cols-2">
          {PAIRS.map((pair) => {
            const ratio = contrastRatio(palette[pair.foreground], palette[pair.background]);
            const state = ratio >= pair.needs ? 'pass' : pair.blocking ? 'fail' : 'warn';
            return (
              <li key={`${pair.foreground}/${pair.background}`} className="flex items-center justify-between gap-2">
                <span className="text-muted">{t(`design.pair.${pair.foreground}/${pair.background}`)}</span>
                <ContrastBadge ratio={Math.round(ratio * 100) / 100} state={state} />
              </li>
            );
          })}
        </ul>
        {blocking.length > 0 && (
          <p role="alert" className="text-sm text-danger">
            {t('design.blocked')}
          </p>
        )}
      </div>
    </Panel>
  );
}

function TypePanel({ preset, overrides, onChange }: { preset: TemplatePreset; overrides: DesignOverrides; onChange: Change }) {
  const t = useT();
  const type = { ...preset.type, ...overrides.type };
  const set = (patch: Partial<typeof type>) => onChange({ ...overrides, type: { ...overrides.type, ...patch } });
  return (
    <Panel id="design-type" title={t('design.section.type')}>
      <div role="radiogroup" aria-label={t('design.type.pair')} className="grid max-h-80 gap-2 overflow-y-auto pe-1 sm:grid-cols-2 xl:grid-cols-3">
        {FONT_PAIR_IDS.map((id: FontPairId) => {
          const variables = FONT_PAIR_VARIABLES[id];
          const checked = type.fontPairId === id;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={checked}
              onClick={() => set({ fontPairId: id })}
              className={cx('flex flex-col gap-1 rounded-md border p-2.5 text-start transition-colors', checked ? 'border-ink ring-1 ring-ink' : 'border-line hover:bg-hover')}
            >
              <span className="text-lg leading-tight text-text" style={{ fontFamily: face(variables.display) }}>
                {FONT_PAIRS[id].label}
              </span>
              <span className="text-sm text-muted" style={{ fontFamily: face(variables.text, 'sans-serif') }}>
                Espresso 4.50
              </span>
              <span lang="ckb" dir="rtl" className="text-sm text-muted" style={{ fontFamily: face(variables.arabic, 'sans-serif') }}>
                قاوەی ڕەش
              </span>
            </button>
          );
        })}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Slider label={t('design.type.scale')} value={type.scale} min={SCALE_RANGE[0]} max={SCALE_RANGE[1]} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(scale) => set({ scale })} />
        <Slider label={t('design.type.tracking')} value={type.tracking} min={TRACKING_RANGE[0]} max={TRACKING_RANGE[1]} step={0.01} format={(v) => `${v.toFixed(2)}em`} onChange={(tracking) => set({ tracking })} />
      </div>
      <ToggleRow label={t('design.type.case')} hint={t('design.type.caseHint')} checked={type.displayCase === 'upper'} onChange={(upper) => set({ displayCase: upper ? 'upper' : 'normal' })} />
    </Panel>
  );
}

const LAYOUT_CHOICES: ReadonlyArray<{ key: keyof DesignLayout; values: readonly string[] }> = [
  { key: 'hero', values: HERO_KINDS },
  { key: 'nav', values: NAV_KINDS },
  { key: 'card', values: CARD_KINDS },
  { key: 'detail', values: DETAIL_KINDS },
  { key: 'options', values: OPTION_STYLES },
  { key: 'heading', values: HEADING_STYLES },
  { key: 'imageRatio', values: IMAGE_RATIOS },
  { key: 'density', values: DENSITIES },
  { key: 'corners', values: CORNERS },
  { key: 'shadow', values: SHADOWS },
];

function LayoutPanel({ preset, overrides, onChange }: { preset: TemplatePreset; overrides: DesignOverrides; onChange: Change }) {
  const t = useT();
  const layout = { ...preset.layout, ...overrides.layout };
  return (
    <Panel id="design-layout" title={t('design.section.layout')} intro={t('design.layout.intro')}>
      <div className="grid gap-3 sm:grid-cols-2">
        {LAYOUT_CHOICES.map(({ key, values }) => (
          <Field key={key} label={t(`design.layout.${key}`)}>
            <Select
              value={layout[key]}
              onChange={(event) => onChange({ ...overrides, layout: { ...overrides.layout, [key]: event.target.value } })}
              options={values.map((value) => ({ value, label: `${t(`design.${key}.${value}`)}${value === preset.layout[key] ? ` · ${t('design.layout.templates')}` : ''}` }))}
            />
          </Field>
        ))}
      </div>
    </Panel>
  );
}

/**
 * The business's own background file (stage 2): the template's scene, or a model, video or Lottie animation from the
 * library. Choosing one moves the mode to where it plays (3D for a model; a moving mode for a video or an animation).
 */
function SceneFile({
  restaurantId,
  scene,
  overrides,
  media,
  onChange,
  onPick,
}: {
  restaurantId: string;
  scene: SceneSettings;
  overrides: DesignOverrides;
  media: SceneMedia | null;
  onChange: Change;
  onPick: (media: SceneMedia) => void;
}) {
  const t = useT();
  const [picking, setPicking] = useState(false);
  const chosen = overrides.sceneAsset && media?.assetId === overrides.sceneAsset.assetId ? media : null;
  const framing = { ...DEFAULT_FRAMING, ...overrides.sceneAsset?.framing };
  const frame = (patch: Partial<ModelFraming>) =>
    overrides.sceneAsset && onChange({ ...overrides, sceneAsset: { ...overrides.sceneAsset, framing: { ...overrides.sceneAsset.framing, ...patch } } });
  const remove = () => {
    const rest = { ...overrides };
    delete rest.sceneAsset;
    onChange(rest);
  };
  const pick = (next: SceneMedia) => {
    onPick(next);
    const mode = next.kind === 'model' ? '3d' : scene.mode === 'static' ? 'motion' : scene.mode;
    onChange({ ...overrides, sceneAsset: { assetId: next.assetId }, scene: { ...overrides.scene, mode } });
  };
  return (
    <div className="flex flex-col gap-3 rounded-md border border-line p-3">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-text">{t('design.motion.file')}</span>
        <span className="text-xs text-muted">{t('design.motion.fileIntro')}</span>
      </div>
      <div className="flex items-center gap-3">
        <span className="studio-checker flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md border border-line">
          {chosen ? <SceneFileMark media={chosen} /> : <ImageOff aria-hidden className="size-5 text-muted" />}
        </span>
        <span className="min-w-0 flex-1 text-sm text-text">{chosen ? t(`media.kind.${chosen.kind === 'model' ? 'MODEL' : chosen.kind === 'video' ? 'VIDEO' : 'LOTTIE'}`) : t('design.motion.fileNone')}</span>
        <div className="flex flex-wrap justify-end gap-1">
          <Button size="sm" onClick={() => setPicking(true)}>
            {chosen ? t('design.motion.fileChange') : t('design.motion.fileChoose')}
          </Button>
          {overrides.sceneAsset && (
            <Button size="sm" variant="ghost" onClick={remove}>
              {t('design.motion.fileRemove')}
            </Button>
          )}
        </div>
      </div>
      {chosen && <p className="text-xs text-muted">{t(`design.motion.fileHint.${chosen.kind}`)}</p>}
      {chosen?.kind === 'model' && (
        <div className="grid gap-4 sm:grid-cols-2">
          {(Object.keys(FRAMING_RANGES) as Array<keyof ModelFraming>).map((key) => (
            <Slider
              key={key}
              label={t(`design.motion.framing.${key}`)}
              value={framing[key]}
              min={FRAMING_RANGES[key][0]}
              max={FRAMING_RANGES[key][1]}
              step={key === 'turn' ? 5 : 0.05}
              format={(v) => (key === 'turn' ? `${Math.round(v)}°` : key === 'scale' ? `${v.toFixed(2)}×` : v.toFixed(2))}
              onChange={(value) => frame({ [key]: value })}
            />
          ))}
        </div>
      )}
      <ScenePicker open={picking} onOpenChange={setPicking} restaurantId={restaurantId} current={overrides.sceneAsset?.assetId ?? null} onPick={pick} />
    </div>
  );
}

function MotionPanel({
  preset,
  overrides,
  onChange,
  restaurantId,
  sceneMedia,
  onPickScene,
}: {
  preset: TemplatePreset;
  overrides: DesignOverrides;
  onChange: Change;
  restaurantId: string;
  sceneMedia: SceneMedia | null;
  onPickScene: (media: SceneMedia) => void;
}) {
  const t = useT();
  const scene = { ...preset.scene, ...overrides.scene };
  const set = (patch: Partial<SceneSettings>) => onChange({ ...overrides, scene: { ...overrides.scene, ...patch } });
  const percent = (v: number) => `${Math.round(v * 100)}%`;
  return (
    <Panel id="design-motion" title={t('design.section.motion')} intro={t('design.motion.intro')}>
      <SceneFile restaurantId={restaurantId} scene={scene} overrides={overrides} media={sceneMedia} onChange={onChange} onPick={onPickScene} />
      <Segmented
        label={t('design.motion.mode')}
        value={scene.mode}
        options={(['static', 'motion', '3d'] as const).map((mode) => ({ value: mode, label: t(`design.mode.${mode}`) }))}
        onChange={(mode) => set({ mode })}
      />
      <p className="text-xs text-muted">{t(`design.mode.${scene.mode}Hint`)}</p>
      <div className="flex flex-col gap-3">
        <ToggleRow label={t('design.motion.ambient')} checked={scene.ambient} disabled={scene.mode === 'static'} onChange={(ambient) => set({ ambient })} />
        <ToggleRow label={t('design.motion.tap')} checked={scene.tap} disabled={scene.mode === 'static'} onChange={(tap) => set({ tap })} />
        <ToggleRow label={t('design.motion.scroll')} checked={scene.scroll} disabled={scene.mode === 'static'} onChange={(scroll) => set({ scroll })} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Slider label={t('design.motion.intensity')} value={scene.intensity} {...range('intensity')} format={percent} onChange={(intensity) => set({ intensity })} />
        <Slider label={t('design.motion.speed')} value={scene.speed} {...range('speed')} format={(v) => `${v.toFixed(2)}×`} onChange={(speed) => set({ speed })} />
        <Slider label={t('design.motion.brightness')} value={scene.brightness} {...range('brightness')} format={percent} onChange={(brightness) => set({ brightness })} />
        <Slider label={t('design.motion.blur')} value={scene.blur} min={SCENE_RANGES.blur[0]} max={SCENE_RANGES.blur[1]} step={1} format={(v) => `${v}px`} onChange={(blur) => set({ blur })} />
        <Slider label={t('design.motion.opacity')} value={scene.opacity} {...range('opacity')} format={percent} onChange={(opacity) => set({ opacity })} />
        <Slider label={t('design.motion.overlay')} value={scene.overlay} {...range('overlay')} format={percent} onChange={(overlay) => set({ overlay })} />
      </div>
      <p className="text-xs text-muted">{t('design.motion.reducedNote')}</p>
    </Panel>
  );
}

function range(key: keyof typeof SCENE_RANGES): { min: number; max: number; step: number } {
  const [min, max] = SCENE_RANGES[key];
  return { min, max, step: 0.05 };
}

/** One text in each of the menu's languages. */
function LocalFields({ label, value, locales, max, multiline, hint, onChange }: { label: string; value: LocalText | undefined; locales: Locale[]; max: number; multiline?: boolean; hint?: string; onChange: (value: LocalText) => void }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium text-text">{label}</legend>
      {hint && <p className="-mt-1 text-xs text-muted">{hint}</p>}
      {locales.map((locale) => {
        const dir = locale === 'en' ? 'ltr' : 'rtl';
        const props = { lang: locale, dir, maxLength: max, value: value?.[locale] ?? '', 'aria-label': `${label} (${LOCALE_NAMES[locale]})`, onChange: (event: { target: { value: string } }) => onChange({ ...value, [locale]: event.target.value }) };
        return (
          <div key={locale} className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-start gap-2">
            <span lang={locale} className="pt-1.5 text-xs text-muted">
              {LOCALE_NAMES[locale]}
            </span>
            {multiline ? <Textarea rows={2} {...props} /> : <Input {...props} />}
          </div>
        );
      })}
    </fieldset>
  );
}

function FeaturedPanel({ state, overrides, onChange }: { state: DesignView; overrides: DesignOverrides; onChange: Change }) {
  const t = useT();
  const [query, setQuery] = useState('');
  const chosen = useMemo(() => overrides.featured?.slugs ?? [], [overrides.featured?.slugs]);
  const shown = state.products.filter((product) => product.name.toLowerCase().includes(query.trim().toLowerCase()) || product.slug.includes(query.trim().toLowerCase()));
  const toggle = (slug: string) => {
    const slugs = chosen.includes(slug) ? chosen.filter((entry) => entry !== slug) : [...chosen, slug].slice(0, MAX_FEATURED);
    onChange({ ...overrides, featured: { ...overrides.featured, slugs } });
  };
  const promoOn = overrides.promo != null;
  return (
    <Panel id="design-featured" title={t('design.section.featured')} intro={t('design.featured.intro')}>
      <div className="flex flex-col gap-2">
        <label className="relative block max-w-sm">
          <span className="sr-only">{t('design.featured.search')}</span>
          <Search aria-hidden className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('design.featured.search')} className="ps-8" />
        </label>
        <p className="text-sm text-muted" aria-live="polite">
          {t('design.featured.count', { count: chosen.length, max: MAX_FEATURED })}
        </p>
        <ul className="grid max-h-64 gap-1 overflow-y-auto rounded-md border border-line p-1 sm:grid-cols-2">
          {shown.map((product) => {
            const checked = chosen.includes(product.slug);
            return (
              <li key={product.slug}>
                <label className={cx('flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-hover', !checked && chosen.length >= MAX_FEATURED && 'opacity-50')}>
                  <input type="checkbox" checked={checked} disabled={!checked && chosen.length >= MAX_FEATURED} onChange={() => toggle(product.slug)} className="size-3.5 accent-ink" />
                  <span className="truncate text-text">{product.name}</span>
                </label>
              </li>
            );
          })}
        </ul>
      </div>
      <ToggleRow
        label={t('design.promo.enable')}
        hint={t('design.promo.termsHint')}
        checked={promoOn}
        onChange={(on) => onChange({ ...overrides, promo: on ? { title: {}, body: {}, terms: {} } : null })}
      />
      {promoOn && overrides.promo && (
        <div className="flex flex-col gap-4">
          <LocalFields label={t('design.promo.title')} value={overrides.promo.title} locales={state.locales} max={TEXT_LIMITS.promoTitle} onChange={(title) => onChange({ ...overrides, promo: { ...overrides.promo!, title } })} />
          <LocalFields label={t('design.promo.body')} value={overrides.promo.body} locales={state.locales} max={TEXT_LIMITS.promoBody} multiline onChange={(body) => onChange({ ...overrides, promo: { ...overrides.promo!, body } })} />
          <LocalFields label={t('design.promo.terms')} value={overrides.promo.terms} locales={state.locales} max={TEXT_LIMITS.promoTerms} multiline onChange={(terms) => onChange({ ...overrides, promo: { ...overrides.promo!, terms } })} />
        </div>
      )}
    </Panel>
  );
}

const INFO_KEYS = ['hours', 'address', 'map', 'phone', 'whatsapp', 'social'] as const satisfies ReadonlyArray<keyof InfoVisibility>;

function DetailsPanel({ state, overrides, onChange, onPoweredBy, poweredBy, poweredByPending }: { state: DesignView; overrides: DesignOverrides; onChange: Change; onPoweredBy: (show: boolean) => void; poweredBy: boolean; poweredByPending: boolean }) {
  const t = useT();
  const ordering = overrides.ordering ?? 'list';
  return (
    <Panel id="design-details" title={t('design.section.details')} intro={t('design.details.intro')}>
      <div className="flex flex-col gap-3">
        {INFO_KEYS.map((key) => (
          <ToggleRow
            key={key}
            label={t(`design.details.${key}`)}
            hint={state.details[key] ? undefined : t('design.details.missing')}
            checked={overrides.info?.[key] ?? true}
            onChange={(value) => onChange({ ...overrides, info: { ...overrides.info, [key]: value } })}
          />
        ))}
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium text-text">{t('design.ordering')}</legend>
        {(['list', 'none'] as const).map((mode) => (
          <label key={mode} className="flex items-start gap-2 text-sm text-text">
            <input type="radio" name="design-ordering" checked={ordering === mode} onChange={() => onChange({ ...overrides, ordering: mode })} className="mt-0.5 size-3.5 accent-ink" />
            <span className="flex flex-col">
              {t(`design.ordering.${mode}`)}
              <span className="text-xs text-muted">{t(`design.ordering.${mode}Hint`)}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <ToggleRow label={t('design.poweredBy')} hint={t(state.superAdmin ? 'design.poweredByHint' : 'design.poweredByLocked')} checked={poweredBy} disabled={!state.superAdmin || poweredByPending} onChange={onPoweredBy} />
    </Panel>
  );
}

/** Every section of customizing the template in use. */
export function Customizer(props: {
  preset: TemplatePreset;
  state: DesignView;
  overrides: DesignOverrides;
  onChange: Change;
  /** The background file the overrides name, resolved, when one is known. */
  sceneMedia: SceneMedia | null;
  onPickScene: (media: SceneMedia) => void;
  poweredBy: boolean;
  poweredByPending: boolean;
  onPoweredBy: (show: boolean) => void;
}) {
  const { preset, state, overrides, onChange } = props;
  return (
    <div className="flex flex-col">
      <PalettePanel preset={preset} overrides={overrides} onChange={onChange} />
      <TypePanel preset={preset} overrides={overrides} onChange={onChange} />
      <LayoutPanel preset={preset} overrides={overrides} onChange={onChange} />
      <MotionPanel preset={preset} overrides={overrides} onChange={onChange} restaurantId={state.restaurantId} sceneMedia={props.sceneMedia} onPickScene={props.onPickScene} />
      <FeaturedPanel state={state} overrides={overrides} onChange={onChange} />
      <DetailsPanel state={state} overrides={overrides} onChange={onChange} poweredBy={props.poweredBy} poweredByPending={props.poweredByPending} onPoweredBy={props.onPoweredBy} />
    </div>
  );
}
