'use client';

import { useId, type CSSProperties } from 'react';
import type { ArtKind } from '@/lib/media';
import { ProductArt, ProductCutout } from '@/ui/art/ProductArt';

/**
 * A small sample menu for interface motions: the menu's own still-life drawings and prices. Names are drawn as soft
 * bars rather than words, so a motion reads the same on an English, Arabic or Sorani page.
 */
export interface SampleDish {
  art: ArtKind;
  tone: string;
  price: number;
}

export const SAMPLE_MENU: readonly SampleDish[] = [
  { art: 'cup', tone: '#6B4A2F', price: 4.5 },
  { art: 'pastry', tone: '#C98F4A', price: 3.75 },
  { art: 'burger', tone: '#C98F4A', price: 11 },
  { art: 'glass', tone: '#E9B44C', price: 5.25 },
  { art: 'bowl', tone: '#7C9B5A', price: 9.5 },
  { art: 'plate', tone: '#B5432F', price: 14 },
  { art: 'cup', tone: '#7F9A5E', price: 4.75 },
  { art: 'plate', tone: '#C9A86A', price: 12.5 },
  { art: 'pastry', tone: '#B58B4C', price: 3.5 },
  { art: 'glass', tone: '#B5432F', price: 6 },
  { art: 'bowl', tone: '#C98F4A', price: 8.75 },
  { art: 'burger', tone: '#B58B4C', price: 12 },
];

export const dishAt = (i: number): SampleDish => SAMPLE_MENU[((i % SAMPLE_MENU.length) + SAMPLE_MENU.length) % SAMPLE_MENU.length]!;

/** A dish's drawing filling its box. */
export function DishPicture({ dish, style }: { dish: SampleDish; style?: CSSProperties }) {
  const uid = useId().replace(/:/g, '');
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', ...style }}>
      <ProductArt kind={dish.art} tone={dish.tone} uid={`bzm${uid}`} className="bzm-fill" />
    </div>
  );
}

/** A dish's drawing without its ground, filling its box: for scenes with their own background, light and shadow. */
export function DishCutout({ dish, style, className }: { dish: SampleDish; style?: CSSProperties; className?: string }) {
  const uid = useId().replace(/:/g, '');
  return (
    <div className={className} style={{ position: 'absolute', inset: 0, ...style }}>
      <ProductCutout kind={dish.art} tone={dish.tone} uid={`bzc${uid}`} className="bzm-fill" />
    </div>
  );
}

/** A line of text drawn as a rounded bar: width in percent of its row. */
export function TextBar({ width, height = '1.6cqmin', color, style }: { width: string; height?: string; color: string; style?: CSSProperties }) {
  return <span style={{ display: 'block', width, height, borderRadius: 999, background: color, ...style }} />;
}

/** A price as the menu writes it: two decimals, digits of equal width. */
export function formatPrice(value: number): string {
  return value.toFixed(2);
}

/** CSS every motion with dish pictures needs: the drawing fills its box. */
export const MENU_CSS = `.bzm-fill{position:absolute;inset:0;width:100%;height:100%;display:block}`;
