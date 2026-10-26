'use client';

import { Box, Play, Sparkles } from 'lucide-react';
import type { Locale } from '@/lib/locale';
import type { MediaRow } from '@/server/studio/services/media';
import { numberFormat } from '@/studio/format';
import { useLocale, useT } from '@/studio/i18n';

/** A length in seconds, one decimal at most: `8 s`, `2.5 s`. */
export function formatSeconds(ms: number, locale: Locale): string {
  return numberFormat(locale, { maximumFractionDigits: 1 }).format(ms / 1000);
}

/**
 * What a library tile shows: the picture itself; a video's poster with its length; and for a model or a Lottie
 * animation, which have no picture of their own, a mark of their kind. Decorative: the tile's button names the asset.
 */
export function AssetThumb({ row }: { row: MediaRow }) {
  const t = useT();
  const { locale } = useLocale();
  if (row.kind === 'MODEL' || row.kind === 'LOTTIE') {
    const Icon = row.kind === 'MODEL' ? Box : Sparkles;
    return (
      <span className="flex flex-col items-center gap-1.5 text-muted">
        <Icon aria-hidden className="size-7" strokeWidth={1.5} />
        <span className="text-xs font-medium">{t(`media.kind.${row.kind}`)}</span>
      </span>
    );
  }
  return (
    <>
      {/* Sized against the square tile itself, so a portrait picture or video poster stays inside it. */}
      {/* eslint-disable-next-line @next/next/no-img-element -- library thumbnails come from storage at their own size */}
      <img data-asset-id={row.id} src={row.thumbUrl} alt="" loading="lazy" className="absolute inset-0 m-auto max-h-[calc(100%-1rem)] max-w-[calc(100%-1rem)] object-contain" />
      {row.kind === 'VIDEO' && (
        <span className="absolute bottom-1.5 start-1.5 inline-flex items-center gap-1 rounded-sm bg-ink/80 px-1.5 py-0.5 text-xs font-medium text-on-ink">
          <Play aria-hidden className="size-3" fill="currentColor" />
          {row.durationMs ? t('media.details.seconds', { seconds: formatSeconds(row.durationMs, locale) }) : t('media.kind.VIDEO')}
        </span>
      )}
    </>
  );
}
