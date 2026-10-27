import type { CSSProperties } from 'react';
import { appearanceVars, parseStoredAppearance, toneOf, type Appearance } from '@/lib/appearance';

export interface AppearanceHtmlProps {
  style?: CSSProperties;
  'data-shape'?: Appearance['shape'];
  /** Which Buzzify logo to show (studio.css). */
  'data-tone'?: 'dark' | 'light';
}

/**
 * What a root layout adds to `<html>` for the signed-in person's own look: the colour and font variables, and the button
 * shape (`data-shape`, which studio.css reads). Nothing for a visitor or for someone still on the default, so their
 * pages are exactly the stylesheet's. A damaged stored value is repaired by `parseStoredAppearance`.
 */
export function appearanceHtmlProps(stored: Appearance | null | undefined): AppearanceHtmlProps {
  if (!stored) return {};
  const appearance = parseStoredAppearance(stored);
  const vars = appearanceVars(appearance);
  if (Object.keys(vars).length === 0) return {};
  return { style: vars as CSSProperties, 'data-shape': appearance.shape, 'data-tone': toneOf(appearance.bg) };
}
