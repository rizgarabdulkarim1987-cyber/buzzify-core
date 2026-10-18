'use client';

import { animate, motion, useMotionValue, useTransform, type PanInfo } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { inkOn } from '../engine/color';
import { CENTER, DomStage, MotionStyle } from '../engine/dom';
import { useSequence } from '../engine/loop';
import { dishAt, DishPicture, formatPrice, MENU_CSS, TextBar } from '../engine/menu';
import { str, type MotionProps } from '../types';

const DEPTH = 3;

/**
 * #71 Dishes as a stack of cards to swipe through: drag the top card sideways and let go past the line to throw it
 * off; the next card rises to the top. Short of the line it springs back. Left alone, the stack swipes itself.
 */
export default function SwipeProductTransition({ params, playing, speed, replay, dir }: MotionProps) {
  const background = str(params, 'background');
  const ink = inkOn(background, str(params, 'accent'));
  const [first, setFirst] = useState(0);
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-300, 300], [-14, 14]);
  const stage = useRef<HTMLDivElement>(null);
  const tick = useSequence([2.2, 0.3], { playing, speed, replay });

  const throwCard = (direction: number) => {
    const width = stage.current?.getBoundingClientRect().width ?? 600;
    void animate(x, direction * width, { type: 'spring', duration: 0.45, bounce: 0 }).then(() => {
      setFirst((value) => value + 1);
      x.set(0);
    });
  };

  // The stack swipes itself between visits from a real hand.
  useEffect(() => {
    if (tick === 1 && playing) throwCard(dir === 'rtl' ? 1 : -1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  const end = (_: unknown, info: PanInfo) => {
    const width = stage.current?.getBoundingClientRect().width ?? 600;
    if (Math.abs(info.offset.x) > width * 0.18 || Math.abs(info.velocity.x) > 600) throwCard(Math.sign(info.offset.x || info.velocity.x));
    else void animate(x, 0, { type: 'spring', duration: 0.4, bounce: 0.3 });
  };

  return (
    <DomStage ref={stage} playing={playing} speed={speed} background={background}>
      <MotionStyle id="menu" css={MENU_CSS} />
      <div style={CENTER}>
        <div style={{ position: 'relative', width: '42cqmin', height: '58cqmin' }}>
          {Array.from({ length: DEPTH }, (_, k) => DEPTH - 1 - k).map((k) => {
            const dish = dishAt(first + k);
            const top = k === 0;
            const card = (
              <>
                <div style={{ position: 'relative', height: '74%' }}>
                  <DishPicture dish={dish} />
                </div>
                <div style={{ padding: '2.6cqmin', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '2cqmin' }}>
                  <TextBar width="55%" color={ink} style={{ opacity: 0.8 }} />
                  <span style={{ color: ink, fontWeight: 600, fontSize: '3.4cqmin', fontVariantNumeric: 'tabular-nums' }}>{formatPrice(dish.price)}</span>
                </div>
              </>
            );
            const look = { position: 'absolute' as const, inset: 0, borderRadius: '3cqmin', overflow: 'hidden', background: '#fffaf2', boxShadow: '0 3cqmin 6cqmin -3cqmin rgb(40 24 12 / 0.5)' };
            return top ? (
              <motion.div key={first + k} drag="x" dragMomentum={false} onDragEnd={end} style={{ ...look, x, rotate, cursor: 'grab', touchAction: 'pan-y' }}>
                {card}
              </motion.div>
            ) : (
              <motion.div key={first + k} animate={{ scale: 1 - k * 0.05, y: `${k * 3}cqmin` }} transition={{ type: 'spring', duration: 0.4, bounce: 0.2 }} style={look}>
                {card}
              </motion.div>
            );
          })}
        </div>
      </div>
    </DomStage>
  );
}
