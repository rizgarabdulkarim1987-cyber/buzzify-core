import { contrastRatio, luminance } from '@/lib/palette';

/**
 * A printed QR code's rules (spec 10.8), pure so the QR tab checks a style as it is chosen and the server checks it
 * again on save: its look, whether scanners can read it, and the address it opens.
 */

export interface QrStyle {
  /** The modules, `#RRGGBB`. */
  foreground: string;
  /** The quiet zone and the space between modules, `#RRGGBB`. */
  background: string;
  /** Whether the brand's logo sits in the middle. */
  logo: boolean;
  /** A line below the code ("Scan for the menu"); empty for none. */
  frameText: string;
}

export const DEFAULT_QR_STYLE: QrStyle = { foreground: '#000000', background: '#FFFFFF', logo: false, frameText: '' };

/** The longest frame text: one line under the code at a size a phone can read from a table. */
export const QR_FRAME_MAX = 40;

/** Scanners need a dark code on a light ground with at least this contrast. */
export const QR_MIN_CONTRAST = 4.5;

const HEX = /^#[0-9A-Fa-f]{6}$/;

/** A stored style, with the default for each part that is missing or not of its shape. */
export function parseQrStyle(json: unknown): QrStyle {
  const value = json !== null && typeof json === 'object' ? (json as Record<string, unknown>) : {};
  const color = (key: 'foreground' | 'background') => {
    const given = value[key];
    return typeof given === 'string' && HEX.test(given) ? given.toUpperCase() : DEFAULT_QR_STYLE[key];
  };
  return {
    foreground: color('foreground'),
    background: color('background'),
    logo: value.logo === true,
    frameText: typeof value.frameText === 'string' ? value.frameText : '',
  };
}

export type QrStyleProblem = 'LOW_CONTRAST' | 'INVERTED' | 'FRAME_TOO_LONG';

/**
 * Why scanners may not read a code of this style, or null. Many scanners read only dark modules on a light ground, so
 * a light-on-dark code is refused even with good contrast.
 */
export function qrStyleProblem(style: QrStyle): QrStyleProblem | null {
  if (luminance(style.foreground) >= luminance(style.background)) return 'INVERTED';
  if (contrastRatio(style.foreground, style.background) < QR_MIN_CONTRAST) return 'LOW_CONTRAST';
  if ([...style.frameText].length > QR_FRAME_MAX) return 'FRAME_TOO_LONG';
  return null;
}

/**
 * The address a code opens: the menu, or its table's page, with the code's id so the visit counts as its scan. It names
 * the menu's current slug; a code printed before a slug change still works, since a former slug redirects.
 */
export function qrTargetUrl(origin: string, slug: string, code: { id: string; tableNumber: number | null }): string {
  const path = code.tableNumber === null ? `/${slug}` : `/${slug}/t/${code.tableNumber}`;
  return `${origin}${path}?qr=${encodeURIComponent(code.id)}`;
}
