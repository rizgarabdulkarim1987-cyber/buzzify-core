'use client';

import { ArrowLeft, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import type { CSSProperties } from 'react';
import { useLocale, useT } from '@/studio/i18n';
import { buttonClasses } from '@/studio/ui/Button';
import { PageHeader } from '@/studio/ui/PageHeader';
import { MENU_STYLES, type MenuStyle } from './catalog';

/** The phone the styles were drawn for: the mockups' device is 430 by 900 CSS pixels. */
const PHONE_WIDTH = 430;
const PHONE_HEIGHT = 900;

/**
 * The phone keeps its 430×900 page and is scaled down to the height the screen leaves it (`--chrome` is what the
 * header and the padding take). `tan(atan2(a, b))` is CSS's way to divide one length by another into a plain number;
 * it never grows past full size, and never shrinks below half so the menu stays readable.
 */
const SCALE = `clamp(0.5, tan(atan2(100dvh - var(--chrome), ${PHONE_HEIGHT}px)), 1)`;

/**
 * One menu style alive in a phone frame: the style's own page in solo mode (the style open full size, its gallery
 * hidden), with the way back, the styles before and after it, and a link to open it full screen in a new tab.
 */
export function StyleDetail({ style }: { style: MenuStyle }) {
  const t = useT();
  const { dir } = useLocale();
  const name = t(`styles.${style.id}.name`);
  const src = `/studio/style-files/page/${style.page}?style=${style.key}`;

  const index = MENU_STYLES.findIndex((other) => other.id === style.id);
  const previous = MENU_STYLES[(index - 1 + MENU_STYLES.length) % MENU_STYLES.length]!;
  const next = MENU_STYLES[(index + 1) % MENU_STYLES.length]!;
  const Back = dir === 'rtl' ? ChevronRight : ChevronLeft;
  const Forward = dir === 'rtl' ? ChevronLeft : ChevronRight;

  return (
    // Wide screens put the phone beside the header, so it gets the full height; narrower ones stack them.
    <div className="flex flex-col [--chrome:15rem] lg:flex-row lg:items-start lg:[--chrome:3rem]">
      <PageHeader
        className="min-w-0 lg:w-[24rem] lg:flex-none"
        above={
          <nav aria-label={t('styles.detail.back')} className="flex items-center gap-2 text-sm text-muted">
            <Link href="/studio/styles" className="inline-flex items-center gap-1.5 rounded-sm hover:text-text">
              <ArrowLeft aria-hidden className="size-4 rtl:-scale-x-100" />
              {t('styles.detail.back')}
            </Link>
            <span aria-hidden className="text-line-strong">
              /
            </span>
            <Link href={`/studio/styles?group=${style.group}`} className="rounded-sm hover:text-text">
              {t(`styles.group.${style.group}`)}
            </Link>
          </nav>
        }
        title={
          <span className="flex items-baseline gap-3">
            <span className="text-base font-normal text-muted tabular-nums">{t('styles.detail.number', { number: style.number })}</span>
            {name}
          </span>
        }
        description={t(`styles.${style.id}.line`)}
        actions={
          <>
            <a href={src} target="_blank" rel="noopener" className={buttonClasses('secondary', 'md')}>
              <ExternalLink aria-hidden className="size-4 rtl:-scale-x-100" />
              {t('styles.detail.open')}
            </a>
            <div className="flex items-center gap-1.5">
              <Link
                href={`/studio/styles/${previous.id}`}
                rel="prev"
                className={buttonClasses('secondary', 'md')}
                aria-label={t('styles.detail.previous')}
                title={`${t('styles.detail.previous')}: ${t(`styles.${previous.id}.name`)}`}
              >
                <Back aria-hidden className="size-4" />
              </Link>
              <Link
                href={`/studio/styles/${next.id}`}
                rel="next"
                className={buttonClasses('secondary', 'md')}
                aria-label={t('styles.detail.next')}
                title={`${t('styles.detail.next')}: ${t(`styles.${next.id}.name`)}`}
              >
                <Forward aria-hidden className="size-4" />
              </Link>
            </div>
          </>
        }
      />

      <section aria-label={t('styles.detail.frame')} className="flex min-w-0 justify-[safe_center] px-8 pb-6 lg:flex-1 lg:pt-6">
        <div
          data-phone
          className="rounded-[calc(34px*var(--s)+8px)] bg-text p-2 ring-1 ring-line-strong"
          style={{ '--s': SCALE } as CSSProperties}
        >
          {/* The screen is laid out at the phone's own size, then scaled: a narrower iframe would reflow the menu. */}
          <div
            className="relative overflow-hidden rounded-[calc(34px*var(--s))] bg-black"
            style={{ width: `calc(${PHONE_WIDTH}px * var(--s))`, height: `calc(${PHONE_HEIGHT}px * var(--s))` }}
          >
            <iframe
              key={style.id}
              title={name}
              src={src}
              width={PHONE_WIDTH}
              height={PHONE_HEIGHT}
              className="absolute top-0 left-0 max-w-none origin-top-left border-0"
              style={{ transform: 'scale(var(--s))' }}
            />
          </div>
        </div>
      </section>
    </div>
  );
}
