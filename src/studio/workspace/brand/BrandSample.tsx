'use client';

import { Plus } from 'lucide-react';
import { HEX, type Palette } from '@/lib/brand';
import { FONT_PAIR_VARIABLES, type FontPairId } from '@/lib/font-pairs';
import { useT } from '@/studio/i18n';
import { face } from './FontPairPicker';

/**
 * A small piece of the public menu drawn from the kit as it stands, saved or not: the header with the logo (or its
 * text), the category rail, two products with a price and an add button. It is a picture, hidden from assistive
 * technology; the menu's real look is on the Preview tab.
 */
export function BrandSample({ palette, pair, logoUrl, logoText }: { palette: Palette; pair: FontPairId; logoUrl: string | null; logoText: string }) {
  const t = useT();
  const safe = (key: keyof Palette, fallback: string) => (HEX.test(palette[key]) ? palette[key] : fallback);
  const colours = {
    bg: safe('bg', '#ffffff'),
    surface: safe('surface', '#ffffff'),
    accent: safe('accent', '#000000'),
    onAccent: safe('onAccent', '#ffffff'),
    text: safe('text', '#000000'),
    muted: safe('muted', '#666666'),
    line: safe('line', '#dddddd'),
  };
  const fonts = FONT_PAIR_VARIABLES[pair];
  const products = [
    { name: 'Flat white', description: 'Double shot, steamed milk', price: '4.50' },
    { name: 'Almond croissant', description: 'Baked this morning', price: '3.75' },
  ];

  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="text-sm font-medium text-text">{t('brand.sample')}</figcaption>
      <div aria-hidden className="overflow-hidden rounded-lg border border-line" style={{ background: colours.bg, color: colours.text }}>
        <div className="flex items-center justify-between px-5 pb-3 pt-5">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- the chosen logo, as guests would see it
            <img src={logoUrl} alt="" className="h-9 w-auto max-w-[12rem] object-contain object-left" />
          ) : (
            <span className="text-[1.4rem] tracking-[0.14em]" style={{ fontFamily: face(fonts.display) }}>
              {logoText}
            </span>
          )}
          <span className="text-sm" style={{ color: colours.muted, fontFamily: face(fonts.text, 'sans-serif') }}>
            English · العربية
          </span>
        </div>
        <div className="flex gap-5 border-b px-5 pb-2 text-sm" style={{ borderColor: colours.line, fontFamily: face(fonts.text, 'sans-serif') }}>
          {['Coffee', 'Breakfast', 'Pastry'].map((label, index) => (
            <span key={label} className="pb-1" style={index === 0 ? { borderBottom: `2px solid ${colours.accent}` } : { color: colours.muted }}>
              {label}
            </span>
          ))}
        </div>
        <div className="flex flex-col gap-3 p-5">
          {products.map((product) => (
            <div key={product.name} className="flex items-center gap-4 rounded-md p-3" style={{ background: colours.surface }}>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-lg leading-tight" style={{ fontFamily: face(fonts.display) }}>
                  {product.name}
                </span>
                <span className="text-sm" style={{ color: colours.muted, fontFamily: face(fonts.text, 'sans-serif') }}>
                  {product.description}
                </span>
                <span className="text-sm tabular-nums" style={{ fontFamily: face(fonts.text, 'sans-serif') }}>
                  ${product.price}
                </span>
              </div>
              <span className="flex size-9 items-center justify-center rounded-full" style={{ background: colours.accent, color: colours.onAccent }}>
                <Plus className="size-4" />
              </span>
            </div>
          ))}
        </div>
      </div>
    </figure>
  );
}
