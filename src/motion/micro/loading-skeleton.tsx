'use client';

import { AnimatePresence, motion } from 'motion/react';
import { mix } from '../engine/color';
import { DomStage, MotionStyle } from '../engine/dom';
import { useSequence } from '../engine/loop';
import { dishAt, DishPicture, formatPrice, MENU_CSS, TextBar } from '../engine/menu';
import { FONT, palette } from '../engine/ui';
import { num, str, type MotionProps } from '../types';

const CSS = `
@keyframes bzm-shimmer { from { transform: translateX(-100%) } to { transform: translateX(100%) } }
.bzm-bone { position: relative; overflow: hidden }
.bzm-bone::after { content: ''; position: absolute; inset: 0; background: linear-gradient(90deg, transparent, rgb(255 255 255 / 0.55), transparent); animation: bzm-shimmer calc(1.3s / var(--m-speed, 1)) ease-in-out infinite }
`;

/**
 * #100 While the menu loads, its shape is already there: grey shapes where the pictures, names and prices will be,
 * with a sheen passing over them. When the dishes arrive they fade in over the shapes.
 */
export default function LoadingSkeleton({ params, playing, speed, replay }: MotionProps) {
  const colours = palette(str(params, 'background'), '#2b1a12');
  const bone = str(params, 'color');
  const count = num(params, 'count');
  const step = useSequence([2.6, 2.2], { playing, speed, replay });
  const loaded = step === 1;
  return (
    <DomStage playing={playing} speed={speed} background={colours.background}>
      <MotionStyle id="menu" css={MENU_CSS} />
      <MotionStyle id="skeleton" css={CSS} />
      <div style={{ position: 'absolute', inset: '8cqh 10cqw', display: 'flex', flexDirection: 'column', gap: '3cqmin', justifyContent: 'center' }}>
        {Array.from({ length: count }, (_, i) => (
          <div key={i} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '3cqmin', height: `${Math.min(18, 70 / count)}cqh` }}>
            <AnimatePresence mode="popLayout" initial={false}>
              {loaded ? (
                <motion.div key="dish" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.35, delay: i * 0.08 }} style={{ display: 'flex', alignItems: 'center', gap: '3cqmin', width: '100%', height: '100%' }}>
                  <span style={{ position: 'relative', height: '100%', aspectRatio: '1 / 1', borderRadius: '1.8cqmin', overflow: 'hidden' }}>
                    <DishPicture dish={dishAt(i)} />
                  </span>
                  <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '1.4cqmin' }}>
                    <TextBar width="62%" color={colours.ink} style={{ opacity: 0.85 }} />
                    <TextBar width="40%" height="1.2cqmin" color={colours.ink} style={{ opacity: 0.3 }} />
                  </span>
                  <span style={{ ...FONT, color: colours.ink, fontSize: '3cqmin', fontVariantNumeric: 'tabular-nums' }}>{formatPrice(dishAt(i).price)}</span>
                </motion.div>
              ) : (
                <motion.div key="bone" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ display: 'flex', alignItems: 'center', gap: '3cqmin', width: '100%', height: '100%' }}>
                  <span className="bzm-bone" style={{ height: '100%', aspectRatio: '1 / 1', borderRadius: '1.8cqmin', background: bone }} />
                  <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '1.4cqmin' }}>
                    <span className="bzm-bone" style={{ height: '1.8cqmin', width: '62%', borderRadius: 999, background: bone }} />
                    <span className="bzm-bone" style={{ height: '1.2cqmin', width: '40%', borderRadius: 999, background: mix(bone, colours.background, 0.3) }} />
                  </span>
                  <span className="bzm-bone" style={{ height: '2.6cqmin', width: '10cqw', borderRadius: 999, background: bone }} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ))}
      </div>
    </DomStage>
  );
}
