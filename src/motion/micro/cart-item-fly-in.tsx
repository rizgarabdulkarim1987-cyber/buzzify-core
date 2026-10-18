'use client';

import { ShoppingBag } from 'lucide-react';
import { useRef, useState } from 'react';
import { DomStage, MotionStyle } from '../engine/dom';
import { useLoop } from '../engine/loop';
import { clamp, easeInOutCubic, lerp, smoothstep } from '../engine/math';
import { DishPicture, formatPrice, MENU_CSS, SAMPLE_MENU, TextBar } from '../engine/menu';
import { FONT, icon, palette } from '../engine/ui';
import { str, type MotionProps } from '../types';

const CYCLE = 3.2;
const FLY = [0.7, 1.55] as const;

/**
 * #93 A dish added to the order flies to the bag: a copy of its picture lifts off the card, arcs across the screen
 * shrinking as it goes, and drops into the bag, which jolts and counts one more.
 */
export default function CartItemFlyIn({ params, playing, speed, replay, dir }: MotionProps) {
  const colours = palette(str(params, 'background'), str(params, 'accent'));
  const stage = useRef<HTMLDivElement>(null);
  const source = useRef<HTMLSpanElement>(null);
  const bag = useRef<HTMLSpanElement>(null);
  const flyer = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState(1);
  const counted = useRef(-1);
  useLoop(
    (t) => {
      const root = stage.current?.getBoundingClientRect();
      const from = source.current?.getBoundingClientRect();
      const to = bag.current?.getBoundingClientRect();
      if (!root || !from || !to || !flyer.current || !bag.current) return;
      const local = t % CYCLE;
      const k = easeInOutCubic(clamp((local - FLY[0]) / (FLY[1] - FLY[0])));
      const x0 = from.left - root.left + from.width / 2;
      const y0 = from.top - root.top + from.height / 2;
      const x1 = to.left - root.left + to.width / 2;
      const y1 = to.top - root.top + to.height / 2;
      // A quadratic arc that rises above both ends.
      const cx = (x0 + x1) / 2;
      const cy = Math.min(y0, y1) - root.height * 0.25;
      const x = (1 - k) * (1 - k) * x0 + 2 * (1 - k) * k * cx + k * k * x1;
      const y = (1 - k) * (1 - k) * y0 + 2 * (1 - k) * k * cy + k * k * y1;
      const size = from.width * lerp(1, 0.28, k);
      const visible = local > FLY[0] && local < FLY[1];
      flyer.current.style.opacity = visible ? '1' : '0';
      flyer.current.style.width = flyer.current.style.height = `${size}px`;
      flyer.current.style.transform = `translate(${x - size / 2}px, ${y - size / 2}px) rotate(${k * (dir === 'rtl' ? 25 : -25)}deg)`;
      const jolt = smoothstep(FLY[1], FLY[1] + 0.08, local) * (1 - smoothstep(FLY[1] + 0.08, FLY[1] + 0.45, local));
      bag.current.style.transform = `scale(${1 + jolt * 0.25}) rotate(${jolt * 8}deg)`;
      const round = Math.floor(t / CYCLE);
      if (local > FLY[1] && counted.current !== round) {
        counted.current = round;
        setCount((value) => (value >= 9 ? 1 : value + 1));
      }
    },
    { playing, speed, replay, still: 1.1 },
  );
  const dish = SAMPLE_MENU[3]!;
  return (
    <DomStage ref={stage} playing={playing} speed={speed} background={colours.background}>
      <MotionStyle id="menu" css={MENU_CSS} />
      <span ref={bag} style={{ position: 'absolute', top: '8cqh', insetInlineEnd: '9cqw', color: colours.ink, display: 'inline-flex' }}>
        <ShoppingBag style={icon('7cqmin')} />
        <span style={{ ...FONT, position: 'absolute', top: '-1.2cqmin', insetInlineEnd: '-1.6cqmin', minWidth: '3.8cqmin', height: '3.8cqmin', borderRadius: 999, background: colours.accent, color: colours.onAccent, fontSize: '2.3cqmin', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {count}
        </span>
      </span>
      <div style={{ position: 'absolute', insetInlineStart: '10cqw', bottom: '12cqh', width: '40cqw', borderRadius: '2.6cqmin', background: colours.surface, padding: '2.4cqmin', display: 'flex', flexDirection: 'column', gap: '2cqmin' }}>
        <span ref={source} style={{ position: 'relative', aspectRatio: '1 / 1', borderRadius: '1.8cqmin', overflow: 'hidden' }}>
          <DishPicture dish={dish} />
        </span>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <TextBar width="55%" color={colours.ink} style={{ opacity: 0.8 }} />
          <span style={{ ...FONT, color: colours.ink, fontSize: '3cqmin', fontVariantNumeric: 'tabular-nums' }}>{formatPrice(dish.price)}</span>
        </div>
      </div>
      <div ref={flyer} style={{ position: 'absolute', left: 0, top: 0, borderRadius: '1.8cqmin', overflow: 'hidden', opacity: 0, pointerEvents: 'none', boxShadow: '0 2cqmin 4cqmin -2cqmin rgb(0 0 0 / 0.45)' }}>
        <DishPicture dish={dish} />
      </div>
    </DomStage>
  );
}
