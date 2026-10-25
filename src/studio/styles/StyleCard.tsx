'use client';

import Link from 'next/link';
import { memo } from 'react';
import { useT } from '@/studio/i18n';
import type { MenuStyle } from './catalog';

/** The poster's size on disk (a phone-shaped still of the style's menu); the frame keeps its 43:90 shape. */
const POSTER_WIDTH = 344;
const POSTER_HEIGHT = 720;

/** One style in the gallery: its poster, number, name and a line on what makes it. */
export const StyleCard = memo(function StyleCard({ style }: { style: MenuStyle }) {
  const t = useT();
  const name = t(`styles.${style.id}.name`);

  return (
    <li>
      <Link
        href={`/studio/styles/${style.id}`}
        className="group flex flex-col gap-2.5 rounded-lg outline-offset-4"
        aria-describedby={`style-${style.id}-line`}
      >
        <div className="relative aspect-[43/90] overflow-hidden rounded-lg bg-surface ring-1 ring-line transition-[box-shadow] duration-150 ease-out group-hover:ring-2 group-hover:ring-ink">
          {/* A signed-in route serves the poster, so it is a plain image: the optimizer would fetch it without the session. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/studio/style-files/poster/${style.id}`}
            alt=""
            width={POSTER_WIDTH}
            height={POSTER_HEIGHT}
            loading="lazy"
            decoding="async"
            className="absolute inset-0 size-full object-cover"
          />
        </div>
        <div className="flex min-w-0 flex-col gap-0.5 px-0.5">
          <div className="flex items-baseline gap-2">
            <span className="shrink-0 text-xs text-muted tabular-nums">{t('styles.detail.number', { number: style.number })}</span>
            <span className="truncate text-base font-medium text-text group-hover:underline group-hover:underline-offset-2">{name}</span>
          </div>
          <span id={`style-${style.id}-line`} className="line-clamp-2 text-sm text-muted">
            {t(`styles.${style.id}.line`)}
          </span>
        </div>
      </Link>
    </li>
  );
});
