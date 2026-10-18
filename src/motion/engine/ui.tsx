'use client';

import type { CSSProperties, ReactNode } from 'react';
import { inkOn, mix } from './color';

/**
 * The small interface the micro-animations are acted out on: a phone-width panel in the middle of the stage, in the
 * motion's background colour, with its ink and surfaces derived from it.
 */
export interface Palette {
  background: string;
  surface: string;
  line: string;
  ink: string;
  muted: string;
  accent: string;
  onAccent: string;
}

export function palette(background: string, accent: string): Palette {
  const ink = inkOn(background, '#1d140e');
  return {
    background,
    surface: mix(background, '#ffffff', 0.62),
    line: mix(background, ink, 0.12),
    ink,
    muted: mix(background, ink, 0.45),
    accent,
    onAccent: inkOn(accent),
  };
}

export const FONT: CSSProperties = { fontFamily: "'DM Sans', 'IBM Plex Sans Arabic', system-ui, sans-serif", fontWeight: 600 };

/** A centred column, like a phone screen, that the scene sits in. */
export function Panel({ children, width = '62cqw', style }: { children: ReactNode; width?: string; style?: CSSProperties }) {
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'relative', width, display: 'flex', flexDirection: 'column', gap: '3cqmin', ...style }}>{children}</div>
    </div>
  );
}

/** An icon from the drawing set, sized in the stage's units. */
export const icon = (size: string): CSSProperties => ({ width: size, height: size, flex: '0 0 auto' });
