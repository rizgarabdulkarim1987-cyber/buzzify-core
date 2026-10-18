'use client';

import { Clock3, MousePointer2, MoveVertical, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Motion, preloadMotion } from '@/motion/Motion';
import type { MotionDrive, MotionMeta, MotionParams } from '@/motion/types';
import { useLocale, useT } from '@/studio/i18n';
import { cx } from '@/studio/ui/cx';
import { studioDefaults } from './samples';

export const DRIVE_ICONS: Record<MotionDrive, LucideIcon> = { time: Clock3, progress: MoveVertical, pointer: MousePointer2 };

/**
 * Whether an element is near the viewport: a preview mounts within `margin` of the screen and unmounts beyond it, so a
 * gallery of 150 holds only the canvases around what the viewer sees.
 */
function useNear(margin: string): [React.RefObject<HTMLDivElement | null>, boolean] {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => setNear(entries.some((entry) => entry.isIntersecting)), { rootMargin: margin });
    observer.observe(element);
    return () => observer.disconnect();
  }, [margin]);
  return [ref, near];
}

/**
 * A motion's live preview in a box of the caller's shape, drawn on its background: mounted only near the viewport (its
 * code preloads as it comes near), and inert, since it only shows. Still while `playing` is false.
 */
export function MotionPreview({
  meta,
  params,
  playing,
  className,
  style,
}: {
  meta: MotionMeta;
  params: MotionParams;
  playing: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const { dir } = useLocale();
  const [ref, near] = useNear('300px 0px');
  const ground = typeof params.background === 'string' ? params.background : '#0d0b09';

  useEffect(() => {
    if (near) preloadMotion(meta.id);
  }, [near, meta.id]);

  return (
    <div ref={ref} inert aria-hidden className={cx('relative overflow-hidden', className)} style={{ background: ground, ...style }}>
      {near && <Motion id={meta.id} params={params} playing={playing} respectReducedMotion={false} dir={dir} />}
    </div>
  );
}

/** One motion in the gallery: its live preview (still when previews are off), number, name and what moves it. */
export const MotionCard = memo(function MotionCard({ meta, playing }: { meta: MotionMeta; playing: boolean }) {
  const t = useT();
  const params = useMemo(() => studioDefaults(meta, t), [meta, t]);
  const name = t(`motion.${meta.id}.name`);
  const DriveIcon = DRIVE_ICONS[meta.drive];

  return (
    <li>
      <Link
        href={`/studio/motion/${meta.id}`}
        className="group flex flex-col gap-2.5 rounded-lg outline-offset-4"
        aria-describedby={`motion-${meta.id}-drive`}
      >
        <MotionPreview
          meta={meta}
          params={params}
          playing={playing}
          className="aspect-[4/3] rounded-lg ring-1 ring-line transition-[box-shadow] duration-150 ease-out group-hover:ring-2 group-hover:ring-ink"
        />
        <div className="flex min-w-0 flex-col gap-0.5 px-0.5">
          <div className="flex items-baseline gap-2">
            <span className="shrink-0 text-xs text-muted tabular-nums">{t('motion.detail.number', { number: meta.number })}</span>
            <span className="truncate text-base font-medium text-text group-hover:underline group-hover:underline-offset-2">{name}</span>
          </div>
          <span id={`motion-${meta.id}-drive`} className="flex items-center gap-1.5 text-sm text-muted">
            <DriveIcon aria-hidden className="size-3.5 shrink-0" />
            {t(`motion.drive.${meta.drive}`)}
          </span>
        </div>
      </Link>
    </li>
  );
});
