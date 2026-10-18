/** Colour helpers for motions that draw with code: parameters arrive as `#rrggbb`. */

export type RGB = readonly [number, number, number];

export function rgb(hex: string): RGB {
  const value = Number.parseInt(hex.slice(1, 7), 16);
  if (!Number.isFinite(value)) return [0, 0, 0];
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = rgb(hex);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, alpha))})`;
}

const toHex = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');

export function hex([r, g, b]: RGB): string {
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** The colour between `a` and `b`. */
export function mix(a: string, b: string, t: number): string {
  const x = rgb(a);
  const y = rgb(b);
  return hex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}

/** Lighter toward white for `amount` > 0, darker toward black for `amount` < 0. */
export function shade(color: string, amount: number): string {
  return amount >= 0 ? mix(color, '#ffffff', amount) : mix(color, '#000000', -amount);
}

/** Relative luminance, 0 (black) to 1 (white). */
export function luminance(color: string): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = rgb(color);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Black or white, whichever reads better on `background`. */
export function inkOn(background: string, dark = '#14110e', light = '#fbf7f0'): string {
  return luminance(background) > 0.36 ? dark : light;
}

/** The colour as three numbers from 0 to 1, for shader uniforms (kept in sRGB: the shaders write colour as is). */
export function unit(color: string): [number, number, number] {
  const [r, g, b] = rgb(color);
  return [r / 255, g / 255, b / 255];
}
