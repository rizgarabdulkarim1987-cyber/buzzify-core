'use client';

import { useReducedMotion } from 'motion/react';
import dynamic from 'next/dynamic';
import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  layersFor,
  qualifiesFor3D,
  selectionFromOptions,
  stageOf,
  type StageEnvironment,
} from '@/lib/stage';
import type { MenuProductView } from '@/server/data/menu-view';
import { useApp } from '@/ui/AppProviders';
import { ProductVisual } from '@/ui/art/ProductVisual';
import { beginDrag, createControls, dragBy, endDrag, nudge, resetTurn } from './controls';
import { syncStagePreference } from './preference';

// The 3D chunk (three.js and the scene) is never part of the menu route's initial JavaScript.
const StageCanvas = dynamic(() => import('./StageCanvas').then((module) => module.StageCanvas), {
  ssr: false,
});

type StageState = 'poster' | 'loading' | 'ready' | 'unavailable';

const TAP_SLOP_PX = 6;

function probeEnvironment(): StageEnvironment {
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  const forced = syncStagePreference();
  let webgl = false;
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    webgl = context !== null;
    // Give the probe context back so it does not count against the page's limit.
    (context as WebGLRenderingContext | null)?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    webgl = false;
  }
  return {
    webgl,
    saveData: nav.connection?.saveData === true,
    deviceMemory: nav.deviceMemory,
    cores: nav.hardwareConcurrency,
    forced,
  };
}

class StageBoundary extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onError();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

interface Props {
  product: MenuProductView;
  /** Option ids the customer has chosen; they decide which layers the model shows. */
  selectedIds?: readonly string[];
  variant: 'hero' | 'sheet';
  testId: string;
  /** Unique art id so the poster's SVG gradients do not collide with other posters on the page. */
  posterSlug: string;
  className?: string;
  /** True while something covers the stage (the product sheet); the scene stops drawing. */
  suspended?: boolean;
  /** Called on a tap that was not a drag. Double tap to reset the turn only applies when this is absent. */
  onActivate?: () => void;
}

/**
 * Shows a product's server-rendered art first and swaps in the live 3D stage once the device has
 * been judged capable. Anywhere 3D cannot run, the art simply stays.
 */
export function ProductStage({
  product,
  selectedIds = [],
  variant,
  testId,
  posterSlug,
  className = '',
  suspended = false,
  onActivate,
}: Props) {
  const { t, locale } = useApp();
  const stage = stageOf(product.media);
  const tone = stage?.tone ?? null;
  const art = stage?.art ?? 'burger';
  const reduced = useReducedMotion() ?? false;
  const [state, setState] = useState<StageState>('poster');
  // Why the stage fell back to its illustration; shown as data-stage-reason to make failures diagnosable.
  const [reason, setReason] = useState<'device' | 'error' | 'context-lost' | null>(null);
  const [inView, setInView] = useState(true);
  const [pageVisible, setPageVisible] = useState(true);
  const root = useRef<HTMLDivElement>(null);
  const controls = useRef(createControls());
  const press = useRef<{ startX: number; lastX: number; lastT: number; moved: boolean } | null>(null);

  const options = useMemo(() => product.groups.flatMap((group) => group.options), [product.groups]);
  const { cheese, patty, bacon } = selectionFromOptions(options, selectedIds);
  const layers = useMemo(() => layersFor(art, { cheese, patty, bacon }), [art, cheese, patty, bacon]);
  const layerKeys = layers.map((layer) => layer.key).join(',');

  const extras = options
    .filter((option) => option.visualKey !== null && selectedIds.includes(option.id))
    .map((option) => option.name);
  const label =
    extras.length > 0
      ? t('stage.labelWith', {
          name: product.name,
          extras: new Intl.ListFormat(locale === 'en' ? 'en' : 'ar', { type: 'conjunction' }).format(extras),
        })
      : t('stage.label', { name: product.name });

  // Decide once the page is idle, so judging the device never competes with first paint.
  useEffect(() => {
    if (tone === null) return;
    let cancelled = false;
    const decide = () => {
      if (cancelled) return;
      const qualified = qualifiesFor3D(probeEnvironment());
      setState(qualified ? 'loading' : 'unavailable');
      if (!qualified) setReason('device');
    };
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(decide, { timeout: 1200 });
      return () => {
        cancelled = true;
        window.cancelIdleCallback(id);
      };
    }
    const id = window.setTimeout(decide, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [tone]);

  // Stop drawing while the stage is offscreen or the tab is hidden.
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => setInView(entry?.isIntersecting ?? true));
    observer.observe(element);
    const onVisibility = () => setPageVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  if (tone === null) {
    return (
      <ProductVisual media={product.media} name={product.name} slug={posterSlug} className={className} priority />
    );
  }

  const paused = !inView || !pageVisible || suspended;
  const live = state === 'loading' || state === 'ready';

  return (
    <>
      <div
        ref={root}
        role="img"
        aria-label={label}
        tabIndex={0}
        data-testid={testId}
        data-stage-state={state}
        data-stage-layers={layerKeys}
        data-stage-reason={state === 'unavailable' ? (reason ?? undefined) : undefined}
        data-stage-turning={String(state === 'ready' && !reduced && !paused)}
        className={`relative isolate touch-pan-y overflow-hidden select-none ${live ? 'cursor-grab active:cursor-grabbing' : ''} ${className}`}
        onPointerDown={(event) => {
          if (event.pointerType === 'mouse' && event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          beginDrag(controls.current);
          press.current = { startX: event.clientX, lastX: event.clientX, lastT: performance.now(), moved: false };
        }}
        onPointerMove={(event) => {
          const current = press.current;
          if (!current) return;
          const now = performance.now();
          dragBy(controls.current, event.clientX - current.lastX, (now - current.lastT) / 1000);
          current.lastX = event.clientX;
          current.lastT = now;
          if (Math.abs(event.clientX - current.startX) > TAP_SLOP_PX) current.moved = true;
        }}
        onPointerUp={() => {
          const current = press.current;
          press.current = null;
          endDrag(controls.current);
          if (current && !current.moved) onActivate?.();
        }}
        onPointerCancel={() => {
          press.current = null;
          endDrag(controls.current);
        }}
        onDoubleClick={() => {
          if (!onActivate) resetTurn(controls.current);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') nudge(controls.current, -1);
          else if (event.key === 'ArrowRight') nudge(controls.current, 1);
          else if (event.key === 'Home') resetTurn(controls.current);
          else return;
          event.preventDefault();
        }}
      >
        <div
          aria-hidden="true"
          className="absolute inset-0 transition-opacity duration-500 ease-out"
          style={{ opacity: state === 'ready' ? 0 : 1 }}
        >
          <ProductVisual
            media={product.media}
            name={product.name}
            slug={posterSlug}
            className="size-full"
            priority
          />
        </div>
        {live && (
          <StageBoundary
            onError={() => {
              setReason('error');
              setState('unavailable');
            }}
          >
            <div
              className="absolute inset-0 transition-opacity duration-500 ease-out"
              style={{ opacity: state === 'ready' ? 1 : 0 }}
            >
              <StageCanvas
                layers={layers}
                tone={tone}
                reveal={!reduced}
                idleTurn={!reduced}
                paused={paused}
                variant={variant}
                model={art}
                controls={controls}
                onReady={() => setState((current) => (current === 'loading' ? 'ready' : current))}
                onFailure={() => {
                  setReason('context-lost');
                  setState('unavailable');
                }}
              />
            </div>
          </StageBoundary>
        )}
      </div>
      <span className="sr-only" aria-live="polite">
        {extras.length > 0 ? label : ''}
      </span>
    </>
  );
}
