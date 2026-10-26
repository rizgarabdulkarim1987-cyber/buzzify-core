/**
 * A person's own look for the Studio and the till: font, four colours and the button shape. Pure rules, shared by the
 * picker (what to refuse), the account actions (what to store) and the layouts (what to apply). The stored value is only
 * ever read through `parseStoredAppearance`, so a row that is old, damaged or edited by hand can never break a page.
 */

export const FONT_KEYS = ['studio', 'system', 'serif', 'rounded'] as const;
export type FontKey = (typeof FONT_KEYS)[number];

export const SHAPES = ['round', 'square'] as const;
export type Shape = (typeof SHAPES)[number];

/**
 * Only faces that are already on the device or already bundled with the Studio: nothing new to download, so the till
 * keeps its look offline. Each stack ends in faces with Arabic letters, and nothing here splits text per character.
 */
export const FONTS: Record<FontKey, { label: string; stack: string | null }> = {
  // null: leave the Studio's own stack alone (it leads with the interface language's script).
  studio: { label: 'Studio', stack: null },
  system: { label: 'System', stack: "system-ui, 'Segoe UI', Tahoma, 'Noto Sans Arabic', sans-serif" },
  serif: { label: 'Serif', stack: "Georgia, 'Times New Roman', 'Noto Naskh Arabic', 'Traditional Arabic', serif" },
  rounded: { label: 'Rounded', stack: "ui-rounded, 'Nunito', 'Segoe UI', 'Noto Sans Arabic', system-ui, sans-serif" },
};

export interface Appearance {
  font: FontKey;
  bg: string;
  text: string;
  button: string;
  buttonText: string;
  shape: Shape;
}

/** The Studio's own tokens (src/studio/studio.css): what a person who never chose anything sees. */
export const DEFAULT_APPEARANCE: Appearance = {
  font: 'studio',
  bg: '#ffffff',
  text: '#111111',
  button: '#000000',
  buttonText: '#ffffff',
  shape: 'square',
};

export const MIN_TEXT_CONTRAST = 4.5;
export const MIN_BUTTON_CONTRAST = 3;

const HEX = /^#[0-9a-fA-F]{6}$/;

type RGB = [number, number, number];

function rgb(hex: string): RGB {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

function hex(c: RGB): string {
  return `#${c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;
}

function luminance(hexColour: string): number {
  const [r, g, b] = rgb(hexColour).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as RGB;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The WCAG contrast ratio of two `#rrggbb` colours: 1 (identical) to 21 (black on white). */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** `from` moved `amount` (0 to 1) of the way to `to`. */
function mix(from: string, to: string, amount: number): string {
  const a = rgb(from);
  const b = rgb(to);
  return hex([a[0] + (b[0] - a[0]) * amount, a[1] + (b[1] - a[1]) * amount, a[2] + (b[2] - a[2]) * amount]);
}

export function isDark(background: string): boolean {
  return HEX.test(background) && luminance(background) < 0.18;
}

/** Which Buzzify logo suits a background: the white one on dark pages, the black one otherwise. */
export function toneOf(background: string): 'dark' | 'light' {
  return isDark(background) ? 'dark' : 'light';
}

type Field = 'font' | 'bg' | 'text' | 'button' | 'buttonText' | 'shape';
/** Why a field was refused: written wrongly, too close in contrast to what it sits on, or not one of the choices. */
export type AppearanceCode = 'format' | 'contrast' | 'choice';
export type AppearanceCheck = { ok: true; value: Appearance } | { ok: false; field: Field; code: AppearanceCode; reason: string };

/** Whether the choice may be saved. The reason is a one-line English message; the picker shows it next to the field. */
export function checkAppearance(input: unknown): AppearanceCheck {
  const a = (input ?? {}) as Record<string, unknown>;
  if (typeof a.font !== 'string' || !(FONT_KEYS as readonly string[]).includes(a.font)) {
    return { ok: false, field: 'font', code: 'choice', reason: 'Choose one of the fonts offered' };
  }
  if (typeof a.shape !== 'string' || !(SHAPES as readonly string[]).includes(a.shape)) {
    return { ok: false, field: 'shape', code: 'choice', reason: 'Choose round or square' };
  }
  for (const field of ['bg', 'text', 'button', 'buttonText'] as const) {
    const v = a[field];
    if (typeof v !== 'string' || !HEX.test(v)) return { ok: false, field, code: 'format', reason: 'Use a colour such as #1a2b3c' };
  }
  const value: Appearance = {
    font: a.font as FontKey,
    shape: a.shape as Shape,
    bg: (a.bg as string).toLowerCase(),
    text: (a.text as string).toLowerCase(),
    button: (a.button as string).toLowerCase(),
    buttonText: (a.buttonText as string).toLowerCase(),
  };
  if (contrast(value.text, value.bg) < MIN_TEXT_CONTRAST) {
    return { ok: false, field: 'text', code: 'contrast', reason: 'The text is too close to the background colour to read' };
  }
  if (contrast(value.buttonText, value.button) < MIN_TEXT_CONTRAST) {
    return { ok: false, field: 'buttonText', code: 'contrast', reason: 'The button text is too close to the button colour to read' };
  }
  if (contrast(value.button, value.bg) < MIN_BUTTON_CONTRAST) {
    return { ok: false, field: 'button', code: 'contrast', reason: 'The button is too close to the background colour to see' };
  }
  return { ok: true, value };
}

/** What a stored value means. Never throws: bad fields take the default, and unreadable colour sets are dropped whole. */
export function parseStoredAppearance(raw: unknown): Appearance {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return DEFAULT_APPEARANCE;
  const r = raw as Record<string, unknown>;
  const pick = <K extends keyof Appearance>(key: K, valid: (v: unknown) => boolean): Appearance[K] =>
    valid(r[key]) ? (r[key] as Appearance[K]) : DEFAULT_APPEARANCE[key];
  const candidate: Appearance = {
    font: pick('font', (v) => typeof v === 'string' && (FONT_KEYS as readonly string[]).includes(v)),
    shape: pick('shape', (v) => typeof v === 'string' && (SHAPES as readonly string[]).includes(v)),
    bg: pick('bg', (v) => typeof v === 'string' && HEX.test(v)),
    text: pick('text', (v) => typeof v === 'string' && HEX.test(v)),
    button: pick('button', (v) => typeof v === 'string' && HEX.test(v)),
    buttonText: pick('buttonText', (v) => typeof v === 'string' && HEX.test(v)),
  };
  const checked = checkAppearance(candidate);
  return checked.ok ? checked.value : DEFAULT_APPEARANCE;
}

function sameAsDefault(a: Appearance): boolean {
  return (Object.keys(DEFAULT_APPEARANCE) as (keyof Appearance)[]).every((k) => a[k] === DEFAULT_APPEARANCE[k]);
}

/** Muted text: the text colour eased toward the background as far as it stays at 4.5:1. */
function mutedOn(text: string, bg: string): string {
  for (let amount = 0.35; amount > 0; amount -= 0.05) {
    const candidate = mix(text, bg, amount);
    if (contrast(candidate, bg) >= MIN_TEXT_CONTRAST) return candidate;
  }
  return text;
}

/**
 * The CSS variables that put the look on the page (set on `<html>`). A person who kept the default gets none, so their
 * pages are exactly the stylesheet's. Status colours (danger, success, info, accent) are never in here.
 */
export function appearanceVars(a: Appearance): Record<string, string> {
  return sameAsDefault(a) ? {} : fullAppearanceVars(a);
}

/** Every variable for a look, the default included: what the picker's preview needs. */
export function fullAppearanceVars(a: Appearance): Record<string, string> {
  const vars: Record<string, string> = {
    '--s-bg': a.bg,
    '--s-raised': a.bg,
    '--s-surface': mix(a.bg, a.text, 0.04),
    '--s-line': mix(a.bg, a.text, 0.12),
    '--s-line-strong': mix(a.bg, a.text, 0.22),
    '--s-hover': mix(a.bg, a.text, 0.07),
    '--s-pressed': mix(a.bg, a.text, 0.12),
    '--s-text': a.text,
    '--s-muted': mutedOn(a.text, a.bg),
    '--s-ink': a.button,
    '--s-ink-hover': mix(a.button, a.buttonText, 0.15),
    '--s-on-ink': a.buttonText,
    '--s-btn-radius': a.shape === 'round' ? '9999px' : '6px',
  };
  const stack = FONTS[a.font].stack;
  if (stack) vars['--s-font'] = stack;
  return vars;
}

/** Starting points in the picker; each passes the readability check. */
export const PRESETS: ReadonlyArray<{ key: 'light' | 'dark' | 'cream' | 'ocean'; appearance: Appearance }> = [
  { key: 'light', appearance: DEFAULT_APPEARANCE },
  { key: 'dark', appearance: { font: 'studio', bg: '#121212', text: '#f2f2f2', button: '#f2b705', buttonText: '#111111', shape: 'square' } },
  { key: 'cream', appearance: { font: 'studio', bg: '#faf3e3', text: '#2b2118', button: '#7a3e11', buttonText: '#ffffff', shape: 'round' } },
  { key: 'ocean', appearance: { font: 'studio', bg: '#eef5fb', text: '#0b2540', button: '#1d4ed8', buttonText: '#ffffff', shape: 'round' } },
];
