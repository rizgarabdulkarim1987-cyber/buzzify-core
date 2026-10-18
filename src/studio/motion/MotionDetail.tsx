'use client';

import { ArrowLeft, ChevronLeft, ChevronRight, Pause, Play, RotateCcw, Undo2 } from 'lucide-react';
import { useMotionValue, useScroll, type MotionValue } from 'motion/react';
import Link from 'next/link';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { MOTIONS } from '@/motion/catalog';
import { Motion } from '@/motion/Motion';
import { resolveParams } from '@/motion/params';
import type { MotionMeta, MotionParams, ParamValue } from '@/motion/types';
import { useLocale, useT } from '@/studio/i18n';
import { Alert } from '@/studio/ui/Alert';
import { Button, buttonClasses } from '@/studio/ui/Button';
import { CopyButton } from '@/studio/ui/CopyButton';
import { cx } from '@/studio/ui/cx';
import { PageHeader } from '@/studio/ui/PageHeader';
import { DRIVE_ICONS } from './MotionCard';
import { ParamControls, RangeControl } from './ParamControls';
import { useReducedMotion } from './play-preference';
import { studioDefaults } from './samples';
import { usageSnippet } from './snippet';

type Mode = 'auto' | 'scrub' | 'scroll';
const MODES: readonly Mode[] = ['auto', 'scrub', 'scroll'];

/** The stage in Scroll mode: a tall page inside the preview, the motion pinned while its scroll drives it. */
function ScrollStage({ children }: { children: (progress: MotionValue<number>) => ReactNode }) {
  const container = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ container });
  return (
    <div ref={container} className="absolute inset-0 overflow-y-auto overscroll-contain" tabIndex={0}>
      <div className="relative h-[400%]">
        <div className="sticky top-0 h-[25%]">{children(scrollYProgress)}</div>
      </div>
    </div>
  );
}

/** A segmented choice of how a progress motion is driven. */
function ModeSwitch({ mode, onChange }: { mode: Mode; onChange: (mode: Mode) => void }) {
  const t = useT();
  return (
    <div role="radiogroup" aria-label={t('motion.detail.mode')} className="inline-flex rounded-md border border-line-strong bg-surface p-0.5">
      {MODES.map((value) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={mode === value}
          onClick={() => onChange(value)}
          className={cx(
            'h-7 rounded-[5px] px-2.5 text-sm transition-colors duration-150',
            mode === value ? 'bg-raised font-medium text-text shadow-[0_1px_2px_rgb(0_0_0/0.08)]' : 'text-muted hover:text-text',
          )}
        >
          {t(`motion.detail.mode.${value}`)}
        </button>
      ))}
    </div>
  );
}

/**
 * One motion on a full stage: play, pause, play again and speed; for progress motions a choice of what drives them
 * (their own loop, a slider, or scrolling inside the preview); a control for every parameter; and the code that puts
 * the motion on a page with the chosen values.
 */
export function MotionDetail({ meta }: { meta: MotionMeta }) {
  const t = useT();
  const { dir } = useLocale();
  const reduced = useReducedMotion();
  const defaults = useMemo(() => studioDefaults(meta, t), [meta, t]);
  const [params, setParams] = useState<MotionParams>(defaults);
  const [chosenPlaying, setPlaying] = useState<boolean | null>(null);
  const playing = chosenPlaying ?? !reduced;
  const [speed, setSpeed] = useState(1);
  const [replay, setReplay] = useState(0);
  const [mode, setMode] = useState<Mode>('auto');
  const scrub = useMotionValue(0.5);
  const [scrubValue, setScrubValue] = useState(0.5);

  const index = MOTIONS.findIndex((motion) => motion.id === meta.id);
  const previous = MOTIONS[(index - 1 + MOTIONS.length) % MOTIONS.length]!;
  const next = MOTIONS[(index + 1) % MOTIONS.length]!;
  const resolved = useMemo(() => resolveParams(meta, params), [meta, params]);
  const snippet = usageSnippet(meta, resolved);
  const DriveIcon = DRIVE_ICONS[meta.drive];
  const progressMotion = meta.drive === 'progress';
  const changed = JSON.stringify(resolved) !== JSON.stringify(defaults);

  const stage = (progress?: MotionValue<number>) => (
    <Motion
      id={meta.id}
      params={resolved}
      playing={playing}
      speed={speed}
      replay={replay}
      dir={dir}
      respectReducedMotion={false}
      pauseOffscreen={false}
      {...(progress ? { progress } : {})}
    />
  );

  const Back = dir === 'rtl' ? ChevronRight : ChevronLeft;
  const Forward = dir === 'rtl' ? ChevronLeft : ChevronRight;

  return (
    <>
      <PageHeader
        above={
          <Link href="/studio/motion" className="inline-flex items-center gap-1.5 self-start rounded-sm text-sm text-muted hover:text-text">
            <ArrowLeft aria-hidden className="size-4 rtl:-scale-x-100" />
            {t('motion.detail.back')}
          </Link>
        }
        title={
          <span className="flex items-baseline gap-3">
            <span className="text-base font-normal text-muted tabular-nums">{t('motion.detail.number', { number: meta.number })}</span>
            {t(`motion.${meta.id}.name`)}
          </span>
        }
        description={t(`motion.${meta.id}.desc`)}
        actions={
          <div className="flex items-center gap-1.5">
            <Link href={`/studio/motion/${previous.id}`} className={buttonClasses('secondary', 'md')} aria-label={t('motion.detail.previous')} title={t('motion.detail.previous')}>
              <Back aria-hidden className="size-4" />
            </Link>
            <Link href={`/studio/motion/${next.id}`} className={buttonClasses('secondary', 'md')} aria-label={t('motion.detail.next')} title={t('motion.detail.next')} data-next>
              <Forward aria-hidden className="size-4" />
            </Link>
          </div>
        }
      />

      <div className="flex flex-col gap-8 px-8 pb-16 xl:flex-row xl:items-start">
        <section aria-label={t('motion.detail.stage')} className="flex min-w-0 flex-1 flex-col gap-3">
          <div
            data-stage={meta.id}
            className="relative aspect-[16/10] max-h-[72vh] w-full overflow-hidden rounded-lg ring-1 ring-line"
            style={{ background: typeof resolved.background === 'string' ? resolved.background : '#0d0b09' }}
          >
            {progressMotion && mode === 'scroll' ? <ScrollStage>{(progress) => stage(progress)}</ScrollStage> : stage(progressMotion && mode === 'scrub' ? scrub : undefined)}
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            <div className="flex items-center gap-1.5">
              <Button variant="primary" icon={playing ? <Pause aria-hidden /> : <Play aria-hidden />} onClick={() => setPlaying(!playing)}>
                {playing ? t('motion.detail.pause') : t('motion.detail.play')}
              </Button>
              <Button icon={<RotateCcw aria-hidden />} onClick={() => setReplay((value) => value + 1)}>
                {t('motion.detail.replay')}
              </Button>
            </div>
            <div className="w-48">
              <RangeControl label={t('motion.detail.speed')} value={speed} min={0.25} max={2} step={0.25} format={(value) => `${value}×`} onChange={setSpeed} />
            </div>
            {progressMotion && (
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-text">{t('motion.detail.mode')}</span>
                <ModeSwitch mode={mode} onChange={setMode} />
              </div>
            )}
            {progressMotion && mode === 'scrub' && (
              <div className="w-56">
                <RangeControl
                  label={t('motion.detail.progress')}
                  value={scrubValue}
                  min={0}
                  max={1}
                  step={0.01}
                  format={(value) => `${Math.round(value * 100)}%`}
                  onChange={(value) => {
                    setScrubValue(value);
                    scrub.set(value);
                  }}
                />
              </div>
            )}
          </div>
          {progressMotion && mode === 'scroll' && <p className="text-sm text-muted">{t('motion.detail.scrollHint')}</p>}
          {meta.drive === 'pointer' && <p className="text-sm text-muted">{t('motion.detail.pointerHint')}</p>}
          {reduced && chosenPlaying === null && <Alert>{t('motion.detail.reduced')}</Alert>}
        </section>

        <aside className="flex w-full shrink-0 flex-col gap-8 xl:w-80">
          {Object.keys(meta.params).length > 0 && (
            <section aria-labelledby="motion-controls" className="flex flex-col gap-4">
              <div className="flex items-center justify-between gap-3">
                <h2 id="motion-controls" className="text-md font-semibold text-text">
                  {t('motion.detail.controls')}
                </h2>
                <Button variant="ghost" size="sm" icon={<Undo2 aria-hidden className="rtl:-scale-x-100" />} disabled={!changed} onClick={() => setParams(defaults)}>
                  {t('motion.detail.reset')}
                </Button>
              </div>
              <ParamControls specs={meta.params} values={params} onChange={(name: string, value: ParamValue) => setParams((current) => ({ ...current, [name]: value }))} />
            </section>
          )}

          <section aria-labelledby="motion-usage" className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <h2 id="motion-usage" className="text-md font-semibold text-text">
                {t('motion.detail.usage')}
              </h2>
              <CopyButton value={snippet} />
            </div>
            <p className="text-sm text-muted">{t('motion.detail.usageIntro')}</p>
            <pre dir="ltr" className="overflow-x-auto rounded-md border border-line bg-surface p-3 text-start text-xs leading-5 text-text">
              <code data-snippet>{snippet}</code>
            </pre>
          </section>

          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted">{t('motion.detail.category')}</dt>
            <dd className="text-text">
              <Link href={`/studio/motion?group=${meta.category}`} className="underline-offset-2 hover:underline">
                {t(`motion.category.${meta.category}`)}
              </Link>
            </dd>
            <dt className="text-muted">{t('motion.detail.engine')}</dt>
            <dd className="text-text">{t(`motion.engine.${meta.engine}`)}</dd>
            <dt className="text-muted">{t('motion.detail.drive')}</dt>
            <dd className="flex items-center gap-1.5 text-text">
              <DriveIcon aria-hidden className="size-3.5 text-muted" />
              {t(`motion.drive.${meta.drive}`)}
            </dd>
          </dl>
        </aside>
      </div>
    </>
  );
}
