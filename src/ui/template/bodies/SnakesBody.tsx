'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { formatCount } from '@/server/domain/money';
import type { MenuProductView } from '@/server/data/menu-view';
import { useApp } from '@/ui/AppProviders';
import { useTemplate, type MenuCategory } from '../context';
import { Badges, Price, ProductMedia, QuickAction } from '../parts';
import { hueAt, SHAPE_HUES } from './shared/hue';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import { usePlaceOf } from './shared/usePlaceOf';
import './shared/photo-card.css';
import './shared/shapes.css';
import './snake.css';

/** Where square `k` (0 = the start) sits on a board `cols` wide: rows run down, every other row runs back (boustrophedon). */
export function boardCell(k: number, cols: number): { row: number; col: number } {
  const row = Math.floor(k / cols);
  const step = k % cols;
  return { row, col: row % 2 === 1 ? cols - 1 - step : step };
}

/** The board's columns for its width in px: about one per 7rem, three on a phone, six at most. */
export function boardColumns(width: number): number {
  return Math.min(6, Math.max(3, Math.floor(width / 112)));
}

export interface BoardLink {
  kind: 'ladder' | 'snake';
  /** The square a token lands on. */
  from: number;
  /** Where it goes from there: further on up a ladder, back down a snake. */
  to: number;
}

/**
 * The board's ladders and snakes, the same for the same board: about one of each per ten squares, never on the start or
 * the end square, never two on one square, each spanning at least a row (a ladder climbs forward, a snake slides back).
 */
export function boardLinks(total: number, cols: number): BoardLink[] {
  const last = total - 1;
  const span = cols + 1;
  const count = Math.floor((total - 2) / 10);
  if (count < 1 || total < span * 2 + 2) return [];
  const used = new Set<number>([0, last]);
  const links: BoardLink[] = [];
  const add = (kind: BoardLink['kind'], from: number, to: number) => {
    if (from <= 0 || to <= 0 || from >= last || to >= last || used.has(from) || used.has(to)) return;
    used.add(from);
    used.add(to);
    links.push({ kind, from, to });
  };
  const gap = (total - 2) / count;
  for (let at = 0; at < count; at++) {
    const base = 1 + Math.floor(at * gap);
    add('ladder', base, base + span);
    const head = base + Math.floor(gap / 2) + span + 1;
    add('snake', head, head - span - 1);
  }
  return links;
}

/**
 * A roll from square `pos`: the squares the token steps through (one a step, stopping on the end square), then where it
 * rests, after a ladder or a snake at the square it stopped on.
 */
export function diceWalk(pos: number, roll: number, total: number, links: readonly BoardLink[]): { path: number[]; rest: number } {
  const last = total - 1;
  const stop = Math.min(pos + roll, last);
  const path = Array.from({ length: stop - pos }, (_, at) => pos + at + 1);
  const link = links.find((candidate) => candidate.from === stop);
  return { path, rest: link ? link.to : stop };
}

/** The pips a die face shows, as cells (0-8, row by row) of its 3×3 grid. */
export function diePips(face: number): number[] {
  return [[4], [0, 8], [0, 4, 8], [0, 2, 6, 8], [0, 2, 4, 6, 8], [0, 2, 3, 5, 6, 8]][Math.min(6, Math.max(1, face)) - 1]!;
}

/** A wavy snake from square centre to square centre, in board units (one square = 1), as an SVG path. */
export function snakePath(from: { x: number; y: number }, to: { x: number; y: number }, waves = 3): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const nx = -dy / length;
  const ny = dx / length;
  const bend = 0.35;
  let d = `M${from.x.toFixed(2)} ${from.y.toFixed(2)}`;
  for (let at = 0; at < waves; at++) {
    const t1 = (at + 0.5) / waves;
    const t2 = (at + 1) / waves;
    const side = at % 2 === 0 ? 1 : -1;
    const cx = from.x + dx * t1 + nx * bend * side;
    const cy = from.y + dy * t1 + ny * bend * side;
    d += ` Q${cx.toFixed(2)} ${cy.toFixed(2)} ${(from.x + dx * t2).toFixed(2)} ${(from.y + dy * t2).toFixed(2)}`;
  }
  return d;
}

type Square = { kind: 'start' } | { kind: 'end' } | { kind: 'dish'; product: MenuProductView; category: MenuCategory; first: boolean };

/**
 * The snakes family (spec 2026-10-28-menu-styles-77-addendum.md), kind `snake`, «الحيّة والدرج»: the whole menu is one
 * snakes-and-ladders board. Every dish is a numbered square with its photo, name and price, in the colour of its section
 * (on its edge); the numbers run in a zigzag from the start square (the restaurant's name) to the end square. A few
 * ladders and snakes are drawn over the board. The die in the sticky strip rolls (client-side random, a suggestion only):
 * the token walks square by square, climbs a ladder or slides down a snake, and the dish it rests on lights up. Every
 * square is a dish one tap opens, as on any menu.
 *
 * Each section's first square is its anchor (`#cat-<slug>`), with the section's flag on it; the strip jumps there and
 * rings the section's squares.
 */
export function SnakeBody() {
  const { locale, tenant, t, announce } = useApp();
  const { categories, byCategory, reduced, openProduct } = useTemplate();
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);
  const placeOf = usePlaceOf();
  const board = useRef<HTMLDivElement>(null);
  const timers = useRef<number[]>([]);
  const [cols, setCols] = useState(3);
  const [pos, setPos] = useState(0);
  const [face, setFace] = useState(1);
  const [rolling, setRolling] = useState(false);
  const [landed, setLanded] = useState<number | null>(null);
  const [picked, setPicked] = useState<string | null>(null);

  const squares: Square[] = [
    { kind: 'start' },
    ...categories.flatMap((category) => (byCategory.get(category.id) ?? []).map((product, at) => ({ kind: 'dish' as const, product, category, first: at === 0 }))),
    { kind: 'end' },
  ];
  const total = squares.length;
  const rows = Math.ceil(total / cols);
  const links = boardLinks(total, cols);
  const at = Math.min(pos, total - 1);
  const token = boardCell(at, cols);
  const centre = (k: number) => {
    const cell = boardCell(k, cols);
    return { x: cell.col + 0.5, y: cell.row + 0.5 };
  };

  // The board's columns follow its width (three on a phone).
  useEffect(() => {
    const host = board.current;
    if (!host || typeof ResizeObserver === 'undefined') return;
    const watch = new ResizeObserver(([entry]) => setCols(boardColumns(entry!.contentRect.width)));
    watch.observe(host);
    return () => watch.disconnect();
  }, []);
  useEffect(() => () => timers.current.forEach((timer) => window.clearTimeout(timer)), []);
  // A search changes the board under a roll: the walk in flight is dropped and the token starts over.
  const [boardSize, setBoardSize] = useState(total);
  if (boardSize !== total) {
    setBoardSize(total);
    setRolling(false);
    setLanded(null);
    setPos(0);
  }
  useEffect(() => {
    timers.current.forEach((timer) => window.clearTimeout(timer));
    timers.current = [];
  }, [total]);

  const land = (k: number, roll: number) => {
    setRolling(false);
    const square = squares[k];
    if (square?.kind !== 'dish') {
      setLanded(null);
      announce(n(roll));
      if (k === total - 1) timers.current.push(window.setTimeout(() => setPos(0), reduced ? 0 : 900));
      return;
    }
    setLanded(k);
    announce(`${n(roll)} · ${square.product.name}`);
    board.current
      ?.querySelector(`[data-square="${k}"]`)
      ?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center', inline: 'nearest' });
  };

  const roll = () => {
    if (rolling || total < 3) return;
    const value = 1 + Math.floor(Math.random() * 6);
    const { path, rest } = diceWalk(at, value, total, links);
    setFace(value);
    setLanded(null);
    setPicked(null);
    if (reduced) {
      setPos(rest);
      land(rest, value);
      return;
    }
    setRolling(true);
    path.forEach((k, step) => timers.current.push(window.setTimeout(() => setPos(k), 260 + step * 150)));
    const walked = 260 + path.length * 150;
    const stop = path.at(-1) ?? at;
    if (rest !== stop) timers.current.push(window.setTimeout(() => setPos(rest), walked + 220));
    timers.current.push(window.setTimeout(() => land(rest, value), walked + (rest !== stop ? 620 : 120)));
  };

  // A dish added: its square hops like a counter put down on it.
  const hop = (button: HTMLButtonElement) => {
    if (reduced) return;
    button
      .closest('[data-row]')
      ?.querySelector('[data-photo]')
      ?.animate([{ translate: '0 0' }, { translate: '0 -0.375rem' }, { translate: '0 0' }], { duration: 320, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
  };

  const hue = (category: MenuCategory) => ({ '--h': hueAt(SHAPE_HUES, placeOf(category)) }) as CSSProperties;

  return (
    <div className="tpl-body" data-body="snake">
      <SectionStrip
        marker="colours"
        prefix="sk"
        chipStyle={(category) => hue(category)}
        onPick={(category) => {
          setPicked(category.id);
          setLanded(null);
        }}
        lead={
          <button type="button" onClick={roll} aria-label={t('tpl.snake.roll')} aria-disabled={rolling || undefined} data-rolling={rolling || undefined} className="sk-dice">
            <span aria-hidden className="sk-die">
              {Array.from({ length: 9 }, (_, cell) => (
                <i key={cell} data-pip={diePips(face).includes(cell) || undefined} />
              ))}
            </span>
          </button>
        }
      >
        {(category) => (
          <>
            <i aria-hidden className="sk-chip-mark" />
            <span>{category.name}</span>
          </>
        )}
      </SectionStrip>
      <main id="menu" className="min-w-0 sk-main">
        <div ref={board} className="sk-board" style={{ '--cols': cols, '--rows': rows } as CSSProperties}>
          <ol className="sk-squares">
            {squares.map((square, k) => {
              const cell = boardCell(k, cols);
              const place = { gridRow: cell.row + 1, gridColumn: cell.col + 1 } as CSSProperties;
              const shade = (cell.row + cell.col) % 2 === 0 ? 'even' : 'odd';
              if (square.kind === 'start')
                return (
                  <li key="start" data-square={k} data-shade={shade} className="sk-sq sk-start" style={place}>
                    <span aria-hidden className="sk-start-flag" />
                    <span className="sk-brand">{tenant.logoText}</span>
                  </li>
                );
              if (square.kind === 'end')
                return (
                  <li key="end" aria-hidden data-square={k} data-shade={shade} className="sk-sq sk-end" style={place}>
                    <span className="sk-cup" />
                    <span className="sk-num">{n(k)}</span>
                  </li>
                );
              const { product, category, first } = square;
              return (
                <li
                  key={product.id}
                  data-row
                  data-square={k}
                  data-shade={shade}
                  data-landed={landed === k || undefined}
                  data-picked={picked === category.id || undefined}
                  id={first ? `cat-${category.slug}` : undefined}
                  aria-labelledby={first ? `h-${category.slug}` : undefined}
                  className="sk-sq"
                  style={{ ...place, ...hue(category) }}
                >
                  {first ? (
                    <ShapeHeading
                      id={`h-${category.slug}`}
                      name={category.name}
                      label={n(k)}
                      count={n(byCategory.get(category.id)?.length ?? 0)}
                      className="sk-head"
                      title="sk-flag"
                    />
                  ) : (
                    <span aria-hidden className="sk-num">
                      {n(k)}
                    </span>
                  )}
                  <div data-photo className="sk-photo tpl-plate">
                    <ProductMedia product={product} suffix="snake" sizes="(min-width: 640px) 140px, 33vw" priority={k < 10} rounded={false} className="sk-img" />
                    <Badges product={product} className="sk-badges" />
                  </div>
                  <button type="button" onClick={() => openProduct(product.id)} className="tpl-open sk-name text-start">
                    {product.name}
                  </button>
                  <span className="sk-meta">
                    <Price product={product} className="sk-price tpl-price-tight" />
                    <QuickAction product={product} variant="icon" className="sk-add relative z-[2]" onAdded={hop} />
                  </span>
                </li>
              );
            })}
          </ol>
          <svg aria-hidden className="sk-art" viewBox={`0 0 ${cols} ${rows}`} preserveAspectRatio="none">
            {links.map((link) => {
              const a = centre(link.from);
              const b = centre(link.to);
              if (link.kind === 'snake')
                return (
                  <g key={`s${link.from}`} className="sk-snake">
                    <path d={snakePath(a, b)} className="sk-snake-body" vectorEffect="non-scaling-stroke" />
                    <path d={snakePath(a, b)} className="sk-snake-belly" vectorEffect="non-scaling-stroke" />
                    <circle cx={a.x} cy={a.y} r={0.09} className="sk-snake-head" />
                  </g>
                );
              const dx = b.x - a.x;
              const dy = b.y - a.y;
              const length = Math.hypot(dx, dy);
              const ox = (-dy / length) * 0.12;
              const oy = (dx / length) * 0.12;
              const rungs = Math.max(3, Math.round(length * 3));
              return (
                <g key={`l${link.from}`} className="sk-ladder">
                  <line x1={a.x + ox} y1={a.y + oy} x2={b.x + ox} y2={b.y + oy} vectorEffect="non-scaling-stroke" />
                  <line x1={a.x - ox} y1={a.y - oy} x2={b.x - ox} y2={b.y - oy} vectorEffect="non-scaling-stroke" />
                  {Array.from({ length: rungs }, (_, r) => {
                    const f = (r + 0.5) / rungs;
                    return (
                      <line
                        key={r}
                        x1={a.x + dx * f + ox}
                        y1={a.y + dy * f + oy}
                        x2={a.x + dx * f - ox}
                        y2={a.y + dy * f - oy}
                        className="sk-rung"
                        vectorEffect="non-scaling-stroke"
                      />
                    );
                  })}
                </g>
              );
            })}
          </svg>
          <span
            aria-hidden
            className="sk-token-cell"
            style={{ insetInlineStart: `calc(${token.col} * 100% / ${cols})`, insetBlockStart: `calc(${token.row} * 100% / ${rows})` }}
          >
            <i className="sk-token" />
          </span>
        </div>
      </main>
    </div>
  );
}
