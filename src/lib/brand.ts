export interface Palette {
  bg: string;
  surface: string;
  raised: string;
  accent: string;
  text: string;
  muted: string;
  line: string;
  onAccent: string;
}

export const HEX = /^#[0-9a-fA-F]{6}$/;

export const DEFAULT_PALETTES: { dark: Palette; light: Palette } = {
  dark: {
    bg: '#0E0E0F',
    surface: '#1B1A19',
    raised: '#2A2826',
    accent: '#D6BC8A',
    text: '#EDE8DF',
    muted: '#A7A096',
    line: '#3A3633',
    onAccent: '#0E0E0F',
  },
  light: {
    bg: '#F7F5F1',
    surface: '#FFFFFF',
    raised: '#EFEBE4',
    accent: '#7A5F26',
    text: '#1B1A19',
    muted: '#6B655D',
    line: '#D9D3C9',
    onAccent: '#FFFFFF',
  },
};

const KEYS: Array<keyof Palette> = ['bg', 'surface', 'raised', 'accent', 'text', 'muted', 'line', 'onAccent'];

export function sanitizePalette(input: unknown, fallback: Palette): Palette {
  const source = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  const result = { ...fallback };
  for (const key of KEYS) {
    const value = source[key];
    if (typeof value === 'string' && HEX.test(value)) result[key] = value;
  }
  return result;
}
