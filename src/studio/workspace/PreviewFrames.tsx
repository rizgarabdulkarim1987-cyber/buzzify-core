'use client';

import { ExternalLink, RotateCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Locale } from '@/lib/locale';
import { useT } from '@/studio/i18n';
import { Button, buttonClasses } from '@/studio/ui/Button';
import { cx } from '@/studio/ui/cx';

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };

/** The language names the frames' buttons show, in their own script whatever the Studio's language. */
const LANGUAGE_NAMES: Record<Locale, string> = { en: 'English', ar: 'العربية', ckb: 'کوردی' };

/** A device's frame: the page drawn at the device's size, scaled down to the room it has, never up. */
function DeviceFrame({
  src,
  title,
  size,
  label,
  className,
}: {
  src: string;
  title: string;
  size: { width: number; height: number };
  label: string;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setScale(Math.min(1, entry.contentRect.width / size.width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [size.width]);

  return (
    <figure className={cx('flex min-w-0 flex-col gap-2', className)}>
      <figcaption className="flex items-baseline justify-between text-sm text-muted">
        <span className="font-medium text-text">{label}</span>
        <span dir="ltr" className="font-mono tabular-nums">
          {size.width} × {size.height}
        </span>
      </figcaption>
      {/* The frame is laid out left to right whatever the page's direction: it is a picture of a screen. */}
      <div ref={box} dir="ltr" className="w-full">
        <div
          className="relative overflow-hidden rounded-lg border border-line bg-surface"
          style={{ height: size.height * scale, width: size.width * scale }}
        >
          <iframe
            src={src}
            title={title}
            className="absolute left-0 top-0 origin-top-left border-0 bg-white"
            style={{ width: size.width, height: size.height, transform: `scale(${scale})` }}
          />
        </div>
      </div>
    </figure>
  );
}

/**
 * The draft as guests would see it, on a phone and on a desktop, in each of the menu's languages (spec 10.4). Each frame
 * loads the preview page, which reads the draft afresh: Reload shows the latest saved changes.
 */
export function PreviewFrames({ menuId, name, locales, defaultLocale }: { menuId: string; name: string; locales: Locale[]; defaultLocale: Locale }) {
  const t = useT();
  const [locale, setLocale] = useState<Locale>(defaultLocale);
  const [round, setRound] = useState(0);
  const src = `/studio/preview/${menuId}/${locale}`;
  const language = LANGUAGE_NAMES[locale];

  return (
    <div className="flex flex-col gap-5 px-8 pb-10 pt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label={t('workspace.preview.languages')} className="inline-flex rounded-md border border-line p-0.5">
          {locales.map((code) => (
            <button
              key={code}
              type="button"
              lang={code}
              aria-pressed={code === locale}
              onClick={() => setLocale(code)}
              className={cx(
                'h-7 rounded-sm px-3 text-sm transition-colors',
                code === locale ? 'bg-text text-bg' : 'text-muted hover:text-text',
              )}
            >
              {LANGUAGE_NAMES[code]}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button size="md" icon={<RotateCw aria-hidden />} onClick={() => setRound((n) => n + 1)}>
            {t('workspace.preview.reload')}
          </Button>
          <a href={src} target="_blank" rel="noopener noreferrer" className={buttonClasses('secondary', 'md')}>
            <ExternalLink aria-hidden />
            {t('workspace.preview.newTab')}
          </a>
        </div>
      </div>

      <div className="flex flex-col items-start gap-8 xl:flex-row">
        <DeviceFrame
          key={`phone-${locale}-${round}`}
          src={src}
          size={PHONE}
          label={t('workspace.preview.phone')}
          title={t('workspace.preview.frameTitle', { name, language, size: t('workspace.preview.phone') })}
          className="w-full max-w-[390px] shrink-0"
        />
        <DeviceFrame
          key={`desktop-${locale}-${round}`}
          src={src}
          size={DESKTOP}
          label={t('workspace.preview.desktop')}
          title={t('workspace.preview.frameTitle', { name, language, size: t('workspace.preview.desktop') })}
          className="w-full flex-1"
        />
      </div>
    </div>
  );
}
