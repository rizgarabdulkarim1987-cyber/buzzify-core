'use client';

import dynamic from 'next/dynamic';
import {
  AnimatePresence,
  motion,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
  type MotionValue,
} from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { unitPriceFromMenu } from '@/lib/menu-price';
import { layersFor, selectionFromOptions, NO_EXTRAS, type BurgerSelection } from '@/lib/stage';
import type { MenuProductView, MenuView } from '@/server/data/menu-view';
import { track } from '@/ui/analytics/track';
import { useApp } from '@/ui/AppProviders';
import { ProductVisual } from '@/ui/art/ProductVisual';
import { CartBar } from '@/ui/cart/CartBar';
import { Header } from '@/ui/menu/Header';
import { useProductSheet } from '@/ui/product/useProductSheet';
import { RollingMoney } from '@/ui/RollingMoney';
import { beginDrag, createControls, dragBy, endDrag, nudge, type StageControls } from '@/ui/stage/controls';
import { deviceQualifies } from '@/ui/stage/device';
import { nearestScene, sceneState } from './choreography';
import { buildScenes, type ExploreScene } from './scenes';

// Loaded lazily so three.js is never part of the page's first bytes.
const ExploreCanvas = dynamic(() => import('./ExploreCanvas').then((module) => module.ExploreCanvas), { ssr: false });
const ProductSheet = dynamic(() => import('@/ui/product/ProductSheet').then((module) => module.ProductSheet));

type Mode = 'poster' | 'loading' | 'ready' | 'unavailable';

/** A light of the dish's own colour, so each scene is lit by what is on the plate. */
function SceneGlow({ index, progress, tone }: { index: number; progress: MotionValue<number>; tone: string }) {
  const opacity = useTransform(progress, (p) => sceneState(index, p).focus);
  return (
    <motion.div
      aria-hidden="true"
      style={{
        opacity,
        background: `radial-gradient(64% 46% at 50% 40%, color-mix(in oklab, ${tone} 30%, transparent), transparent 72%)`,
      }}
      className="absolute inset-0"
    />
  );
}

const smooth01 = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

/**
 * One letter of a melting name. A name melts away as its dish does: letters rise and blur out one
 * after another when the guest scrolls past, and condense up from below when the dish arrives.
 */
function MeltLetter({
  char,
  order,
  total,
  index,
  progress,
}: {
  char: string;
  order: number;
  total: number;
  index: number;
  progress: MotionValue<number>;
}) {
  const stagger = (order / Math.max(1, total)) * 0.22;
  const amount = (p: number) => smooth01((Math.abs(index - p) - stagger) / 0.42);
  const opacity = useTransform(progress, (p) => 1 - amount(p));
  const transform = useTransform(progress, (p) => {
    const a = amount(p);
    const direction = index - p < 0 ? -1 : 1;
    return `translate3d(0, ${(direction * a * (26 + order * 3)).toFixed(1)}px, 0) rotate(${(direction * a * (order % 2 ? 6 : -6)).toFixed(1)}deg)`;
  });
  const filter = useTransform(progress, (p) => `blur(${(amount(p) * 7).toFixed(1)}px)`);
  return (
    <motion.span style={{ opacity, transform, filter }} className="inline-block will-change-transform">
      {char}
    </motion.span>
  );
}

/** The dish name set huge behind the object, outlined; it melts letter by letter between dishes. */
function GiantName({ index, progress, name }: { index: number; progress: MotionValue<number>; name: string }) {
  const words = name.split(' ');
  const total = name.replace(/\s/g, '').length;
  let order = 0;
  return (
    <div
      aria-hidden="true"
      className="outline-type pointer-events-none absolute inset-x-0 top-[17dvh] select-none ps-[5vw] font-display text-[clamp(4.4rem,23vw,10.5rem)] leading-[0.86] tracking-[-0.02em]"
    >
      {words.map((word, w) => (
        <span key={`${word}-${w}`} className="block">
          {Array.from(word).map((char, c) => (
            <MeltLetter key={`${char}-${c}`} char={char} order={order++} total={total} index={index} progress={progress} />
          ))}
        </span>
      ))}
    </div>
  );
}

/** Without 3D, the dish's illustration crossfades in place, on the same plinth position. */
function PosterScene({
  index,
  progress,
  scene,
}: {
  index: number;
  progress: MotionValue<number>;
  scene: ExploreScene;
}) {
  const scale = useTransform(progress, (p) => 1 - 0.08 * smooth01(Math.abs(index - p) / 0.6));
  const opacity = useTransform(progress, (p) => 1 - smooth01(Math.abs(index - p) / 0.55));
  return (
    <motion.div
      aria-hidden="true"
      style={{ scale, opacity }}
      className="absolute inset-x-0 top-[26dvh] mx-auto grid w-[68vw] max-w-[22rem] place-items-center"
    >
      <ProductVisual
        media={scene.product.media}
        name={scene.product.name}
        slug={`${scene.slug}-explore`}
        priority={index === 0}
        sizes="70vw"
        className="plate aspect-square w-full"
      />
    </motion.div>
  );
}

/** A small burst of champagne sparks from the add button. */
function Sparks({ burst }: { burst: number }) {
  return (
    <AnimatePresence>
      {burst > 0 &&
        Array.from({ length: 10 }, (_, i) => {
          const angle = (i / 10) * Math.PI * 2 + burst;
          return (
            <motion.span
              key={`${burst}-${i}`}
              aria-hidden="true"
              initial={{ opacity: 1, x: 0, y: 0, scale: 1 }}
              animate={{ opacity: 0, x: Math.cos(angle) * 46, y: Math.sin(angle) * 36 - 10, scale: 0.3 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.55, ease: [0.23, 1, 0.32, 1] }}
              className="pointer-events-none absolute start-1/2 top-1/2 size-1.5 rounded-full bg-accent"
            />
          );
        })}
    </AnimatePresence>
  );
}

function ScenePanel({
  scene,
  index,
  progress,
  active,
  selected,
  layerKeys,
  apart,
  added,
  onToggleOption,
  onToggleApart,
  onAdd,
  onCustomise,
}: {
  scene: ExploreScene;
  index: number;
  progress: MotionValue<number>;
  active: boolean;
  selected: string[];
  /** The model's current layers, comma separated; also exposed for tests. */
  layerKeys: string;
  apart: boolean;
  added: number;
  onToggleOption: (product: MenuProductView, optionId: string) => void;
  onToggleApart: (productId: string) => void;
  onAdd: (product: MenuProductView) => void;
  onCustomise: (productId: string) => void;
}) {
  const { t, money } = useApp();
  const product = scene.product;
  const opacity = useTransform(progress, (p) => sceneState(index, p).opacity);
  const y = useTransform(progress, (p) => `${(1 - sceneState(index, p).opacity) * 28}px`);
  const unit = unitPriceFromMenu(product, null, selected);
  const chips = product.groups.flatMap((group) =>
    group.options
      .filter((option) => option.visualKey !== null && option.isAvailable)
      .map((option) => ({ option, group })),
  );
  const canAdd = product.orderState === 'OK' && !product.needsChoices;
  const titleId = `${scene.id}-title`;
  const hasParts = scene.art !== 'croissant';

  return (
    <motion.section
      aria-labelledby={titleId}
      data-stage-layers={layerKeys}
      data-explore-panel
      inert={!active}
      aria-hidden={!active}
      style={{ opacity, y }}
      className="pointer-events-none absolute inset-x-0 bottom-0 px-5 pb-[5.75rem]"
    >
      <div className="pointer-events-auto mx-auto max-w-xl">
        <p className="text-sm text-muted">{scene.categoryName}</p>
        <h2 id={titleId} className="mt-0.5 font-display text-[2rem] leading-none tracking-[-0.01em]">
          {product.name}
        </h2>
        {product.description && <p className="mt-1.5 line-clamp-2 max-w-[34ch] text-[0.95rem] leading-snug text-muted">{product.description}</p>}

        {chips.length > 0 && (
          <div
            role="group"
            aria-label={t('explore.extras')}
            className="scroll-hidden -mx-5 mt-3 flex gap-2 overflow-x-auto px-5"
          >
            {chips.map(({ option, group }) => {
              const on = selected.includes(option.id);
              const chosenInGroup = group.options.filter((o) => selected.includes(o.id)).length;
              const full = !on && group.maxSelect > 1 && chosenInGroup >= group.maxSelect;
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={on}
                  aria-disabled={full || undefined}
                  onClick={() => {
                    if (!full) onToggleOption(product, option.id);
                  }}
                  className={`min-h-11 shrink-0 rounded-full border px-4 text-sm whitespace-nowrap transition-colors duration-150 active:scale-[0.97] ${
                    on ? 'border-accent bg-accent text-on-accent' : 'border-line text-text'
                  } ${full ? 'opacity-45' : ''}`}
                >
                  {option.name}
                  {option.priceDelta > 0 ? <span className="ms-2 tabular-nums opacity-80">+{money(option.priceDelta)}</span> : null}
                </button>
              );
            })}
          </div>
        )}

        <div className="mt-3 flex items-center gap-3">
          <RollingMoney value={unit} className="text-xl tabular-nums text-accent" />
          {canAdd ? (
            <span className="relative ms-auto">
              <button
                type="button"
                onClick={() => onAdd(product)}
                className="flex min-h-12 items-center rounded-full bg-accent px-7 text-on-accent transition-transform duration-150 active:scale-[0.97]"
              >
                {added > 0 ? t('explore.added') : t('product.add')}
              </button>
              <Sparks burst={added} />
            </span>
          ) : (
            <button
              type="button"
              onClick={() => onCustomise(product.id)}
              className="ms-auto flex min-h-12 items-center rounded-full bg-accent px-7 text-on-accent transition-transform duration-150 active:scale-[0.97]"
            >
              {t('explore.customise')}
            </button>
          )}
        </div>

        <div className="mt-1 flex items-center gap-1">
          {hasParts && (
            <button
              type="button"
              aria-pressed={apart}
              onClick={() => onToggleApart(product.id)}
              className="min-h-11 rounded-full px-3 text-sm text-text underline decoration-accent decoration-1 underline-offset-[6px]"
            >
              {apart ? t('explore.together') : t('explore.inside')}
            </button>
          )}
          {canAdd && (
            <button
              type="button"
              onClick={() => onCustomise(product.id)}
              className="min-h-11 rounded-full px-3 text-sm text-muted"
            >
              {t('explore.customise')}
            </button>
          )}
        </div>
      </div>
    </motion.section>
  );
}

export function ExploreApp({ view }: { view: MenuView }) {
  const { t, addLine, announce, href } = useApp();
  const scenes = useMemo(() => buildScenes(view), [view]);
  const reduced = useReducedMotion() ?? false;
  const count = scenes.length;

  const [mode, setMode] = useState<Mode>('poster');
  const [active, setActive] = useState(0);
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [apart, setApart] = useState<Record<string, boolean>>({});
  const [added, setAdded] = useState<Record<string, number>>({});
  const apartRef = useRef<Record<string, boolean>>({});
  const controls = useRef<StageControls>(createControls());
  const labels = useRef<Record<string, HTMLElement | null>>({});
  const press = useRef<{ lastX: number; lastT: number } | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  // The screen between the header and the tallest text panel, where the dish must stay. Measured from layout, which
  // ignores the panels' scroll-driven transforms, so it holds still while the guest scrolls.
  const band = useRef<{ top: number; bottom: number } | null>(null);
  useEffect(() => {
    const stage = stageRef.current;
    const header = headerRef.current;
    if (!stage || !header) return;
    const panels = Array.from(stage.querySelectorAll<HTMLElement>('[data-explore-panel]'));
    const measure = () => {
      const bottom = Math.min(stage.clientHeight, ...panels.map((panel) => panel.offsetTop));
      band.current = { top: header.offsetTop + header.offsetHeight, bottom };
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    observer.observe(header);
    panels.forEach((panel) => observer.observe(panel));
    return () => observer.disconnect();
  }, [count]);

  const { opened, openProduct, closeProduct } = useProductSheet(view.products, '/explore');

  // Scroll is the film strip: one viewport of scrolling is one scene, and each scene snaps into place.
  const { scrollY } = useScroll();
  const raw = useTransform(scrollY, (y) => y / (typeof window === 'undefined' ? 800 : Math.max(1, window.innerHeight)));
  const spring = useSpring(raw, { stiffness: 130, damping: 24, mass: 0.7, restDelta: 0.0005 });
  const progress = reduced ? raw : spring;
  useMotionValueEvent(progress, 'change', (value) => {
    const next = nearestScene(value, count);
    setActive((current) => (current === next ? current : next));
  });

  useEffect(() => {
    document.documentElement.classList.add('explore-snap');
    return () => document.documentElement.classList.remove('explore-snap');
  }, []);

  // Judge the device once the page is idle; until then and wherever 3D cannot run, posters glide.
  useEffect(() => {
    let cancelled = false;
    const decide = () => {
      if (!cancelled) setMode(deviceQualifies() ? 'loading' : 'unavailable');
    };
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(decide, { timeout: 1000 });
      return () => {
        cancelled = true;
        window.cancelIdleCallback(id);
      };
    }
    const id = window.setTimeout(decide, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, []);

  const selections = useMemo(() => {
    const result: Record<string, BurgerSelection> = {};
    for (const scene of scenes) {
      const options = scene.product.groups.flatMap((group) => group.options);
      result[scene.productId] = selectionFromOptions(options, selected[scene.productId] ?? []);
    }
    return result;
  }, [scenes, selected]);

  const toggleOption = useCallback((product: MenuProductView, optionId: string) => {
    setSelected((current) => {
      const chosen = current[product.id] ?? [];
      const group = product.groups.find((candidate) => candidate.options.some((o) => o.id === optionId));
      if (!group) return current;
      if (chosen.includes(optionId)) return { ...current, [product.id]: chosen.filter((id) => id !== optionId) };
      const inGroup = group.options.map((o) => o.id);
      const sameGroup = chosen.filter((id) => inGroup.includes(id));
      if (group.maxSelect === 1) {
        return { ...current, [product.id]: [...chosen.filter((id) => !inGroup.includes(id)), optionId] };
      }
      if (sameGroup.length >= group.maxSelect) return current;
      return { ...current, [product.id]: [...chosen, optionId] };
    });
  }, []);

  const toggleApart = useCallback((productId: string) => {
    const next = { ...apartRef.current, [productId]: !apartRef.current[productId] };
    apartRef.current = next;
    setApart(next);
  }, []);

  const add = useCallback(
    (product: MenuProductView) => {
      addLine({ productId: product.id, variantId: null, optionIds: selected[product.id] ?? [], quantity: 1 });
      track('ADD_TO_CART', { productId: product.id, payload: { source: 'explore' } });
      announce(t('cart.added', { name: product.name }));
      setAdded((current) => ({ ...current, [product.id]: (current[product.id] ?? 0) + 1 }));
      window.setTimeout(() => setAdded((current) => ({ ...current, [product.id]: 0 })), 1400);
    },
    [addLine, announce, selected, t],
  );

  const jumpTo = (index: number) => {
    window.scrollTo({ top: index * window.innerHeight, behavior: reduced ? 'auto' : 'smooth' });
  };

  const live = mode === 'loading' || mode === 'ready';

  if (count === 0) {
    return (
      <div className="mx-auto min-h-dvh max-w-2xl">
        <Header current="explore" />
        <p className="px-5 py-16 text-muted">{t('menu.noResults', { query: '' })}</p>
      </div>
    );
  }

  return (
    <>
      <div ref={stageRef} className="fixed inset-0 overflow-hidden bg-bg" data-testid="explore-stage" data-explore-mode={mode}>
        {scenes.map((scene, index) => (
          <SceneGlow key={scene.id} index={index} progress={progress} tone={scene.tone} />
        ))}
        <div aria-hidden="true" className="grain absolute inset-0" />
        {scenes.map((scene, index) => (
          <GiantName key={scene.id} index={index} progress={progress} name={scene.product.name} />
        ))}

        {!live && scenes.map((scene, index) => <PosterScene key={scene.id} index={index} progress={progress} scene={scene} />)}

        {live && (
          <div
            className="absolute inset-0 touch-pan-y"
            style={{ opacity: mode === 'ready' ? 1 : 0, transition: 'opacity 600ms cubic-bezier(0.23, 1, 0.32, 1)' }}
            onPointerDown={(event) => {
              if (event.pointerType === 'mouse' && event.button !== 0) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              beginDrag(controls.current);
              press.current = { lastX: event.clientX, lastT: performance.now() };
            }}
            onPointerMove={(event) => {
              const current = press.current;
              if (!current) return;
              const now = performance.now();
              dragBy(controls.current, event.clientX - current.lastX, (now - current.lastT) / 1000);
              current.lastX = event.clientX;
              current.lastT = now;
            }}
            onPointerUp={() => {
              press.current = null;
              endDrag(controls.current);
            }}
            onPointerCancel={() => {
              press.current = null;
              endDrag(controls.current);
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft') nudge(controls.current, -1);
              else if (event.key === 'ArrowRight') nudge(controls.current, 1);
            }}
          >
            <ExploreCanvas
              scenes={scenes}
              progress={progress}
              selections={selections}
              apart={apartRef}
              controls={controls}
              reduced={reduced}
              paused={false}
              labels={labels}
              band={band}
              onReady={() => setMode((current) => (current === 'loading' ? 'ready' : current))}
              onFailure={() => setMode('unavailable')}
            />
          </div>
        )}

        {/* Ingredient labels, positioned every frame by the scene they belong to. */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 [direction:ltr]">
          {scenes.map((scene) =>
            layersFor(scene.art, selections[scene.productId] ?? NO_EXTRAS).map((layer) => (
              <span
                key={`${scene.id}:${layer.key}`}
                ref={(element) => {
                  labels.current[`${scene.id}:${layer.key}`] = element;
                }}
                className="absolute left-0 top-0 opacity-0 will-change-transform"
              >
                <span className="flex w-[8.6rem] -translate-y-1/2 items-center gap-2 text-xs leading-tight text-text">
                  <i className="block h-px w-6 shrink-0 bg-accent/70" />
                  <span dir="auto">{t(`layer.${layer.key}`)}</span>
                </span>
              </span>
            )),
          )}
        </div>

        <div ref={headerRef} className="relative z-10">
          <Header current="explore" overlay />
        </div>

        {scenes.map((scene, index) => (
          <ScenePanel
            key={scene.id}
            scene={scene}
            index={index}
            progress={progress}
            active={index === active}
            selected={selected[scene.productId] ?? []}
            layerKeys={layersFor(scene.art, selections[scene.productId] ?? NO_EXTRAS)
              .map((layer) => layer.key)
              .join(',')}
            apart={apart[scene.productId] ?? false}
            added={added[scene.productId] ?? 0}
            onToggleOption={toggleOption}
            onToggleApart={toggleApart}
            onAdd={add}
            onCustomise={openProduct}
          />
        ))}

        <nav
          aria-label={t('explore.chapters')}
          className="absolute end-1 top-1/2 z-10 flex -translate-y-1/2 flex-col items-center"
        >
          {scenes.map((scene, index) => (
            <button
              key={scene.id}
              type="button"
              aria-label={scene.categoryName}
              aria-current={index === active ? 'true' : undefined}
              onClick={() => jumpTo(index)}
              className="grid size-11 place-items-center"
            >
              <span
                className={`block w-0.5 rounded-full bg-accent transition-all duration-300 ease-out-strong ${
                  index === active ? 'h-8 opacity-100' : 'h-3 opacity-40'
                }`}
              />
            </button>
          ))}
        </nav>

        <CartBar />
        {opened && <ProductSheet product={opened} close={closeProduct} open={openProduct} />}
        <a href={href()} className="sr-only focus:not-sr-only focus:absolute focus:start-3 focus:top-3 focus:z-30 focus:rounded-full focus:bg-accent focus:px-4 focus:py-2 focus:text-on-accent">
          {t('mode.menu')}
        </a>
      </div>

      {/* The distance to scroll, and where each scene snaps. */}
      <div aria-hidden="true">
        {scenes.map((scene) => (
          <div key={scene.id} className="h-dvh snap-start" />
        ))}
      </div>
    </>
  );
}
