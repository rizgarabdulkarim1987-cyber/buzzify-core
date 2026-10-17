'use client';

import type { Translate } from '@/lib/i18n';
import type { Locale } from '@/lib/locale';
import type { MediaRow } from '@/server/studio/services/media';
import { formatBytes, numberFormat } from '@/studio/format';
import { useLocale, useT } from '@/studio/i18n';
import { cx } from '@/studio/ui/cx';

/** A file type as people name it: PNG, JPEG, SVG. */
export function typeName(mime: string): string {
  const subtype = mime.split('/')[1] ?? mime;
  if (subtype === 'svg+xml') return 'SVG';
  if (subtype === 'x-icon' || subtype === 'vnd.microsoft.icon') return 'ICO';
  if (subtype === 'webp') return 'WebP';
  return subtype.toUpperCase();
}

/** An asset's alt text in the person's language, else in English, else in any language it has. */
const altOf = (locale: Locale, row: MediaRow) => row.alt[locale] || row.alt.en || Object.values(row.alt).find(Boolean);

/** An asset's name in a list: its alt text, else its type and size in pixels. */
export function assetName(t: Translate, locale: Locale, row: MediaRow): string {
  const alt = altOf(locale, row);
  if (alt) return alt;
  const size = row.width && row.height ? `${numberFormat(locale).format(row.width)} × ${numberFormat(locale).format(row.height)}` : '';
  return t('media.library.untitled', { type: typeName(row.mime), size }).trim();
}

/** The library's pictures as tiles; one is chosen at a time and shown in the details panel. */
export function MediaGrid({ rows, selectedId, onSelect }: { rows: MediaRow[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const t = useT();
  const { locale } = useLocale();
  return (
    <ul aria-label={t('media.library.grid')} className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-3">
      {rows.map((row) => {
        const name = assetName(t, locale, row);
        const selected = row.id === selectedId;
        return (
          <li key={row.id}>
            <button
              type="button"
              aria-pressed={selected}
              aria-label={name}
              onClick={() => onSelect(row.id)}
              className={cx(
                'group flex w-full flex-col overflow-hidden rounded-lg border bg-raised text-start transition-[border-color,box-shadow] duration-150',
                selected ? 'border-ink shadow-[0_0_0_1px_var(--color-ink)]' : 'border-line hover:border-line-strong',
              )}
            >
              <span className="studio-checker flex aspect-square items-center justify-center p-2">
                {/* eslint-disable-next-line @next/next/no-img-element -- library thumbnails come from storage at their own size */}
                <img data-asset-id={row.id} src={row.thumbUrl} alt="" loading="lazy" className="max-h-full max-w-full object-contain" />
              </span>
              <span className="flex flex-col gap-0.5 border-t border-line px-2.5 py-2">
                <span dir="auto" className="truncate text-sm text-text">
                  {name}
                </span>
                <span className="truncate text-xs text-muted">
                  {/* An untitled picture is named by its type already. */}
                  {[altOf(locale, row) ? typeName(row.mime) : null, formatBytes(row.bytes, locale), row.folder].filter(Boolean).join(' · ')}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
