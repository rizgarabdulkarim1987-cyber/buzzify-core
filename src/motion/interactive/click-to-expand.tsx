'use client';

import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { inkOn, mix } from '../engine/color';
import { DomStage, MotionStyle } from '../engine/dom';
import { useSequence } from '../engine/loop';
import { dishAt, DishPicture, formatPrice, MENU_CSS, TextBar } from '../engine/menu';
import { str, type MotionProps } from '../types';

const SPRING = { type: 'spring', duration: 0.45, bounce: 0.12 } as const;

/**
 * #67 Menu rows that open in place: pressing a row grows it into its details (a larger picture, a description and an
 * add button) while the rows below slide down to make room. Without a press, the rows open in turn on their own.
 */
export default function ClickToExpand({ params, playing, speed, replay }: MotionProps) {
  const background = str(params, 'background');
  const accent = str(params, 'accent');
  const ink = inkOn(background, accent);
  const [chosen, setChosen] = useState<number | null>(null);
  const demo = useSequence([2.2, 2.2, 2.2], { playing, speed, replay });
  const open = chosen ?? demo;
  return (
    <DomStage playing={playing} speed={speed} background={background}>
      <MotionStyle id="menu" css={MENU_CSS} />
      <LayoutGroup>
        <div style={{ position: 'absolute', insetInline: '12cqw', top: '7cqh', display: 'flex', flexDirection: 'column', gap: '2cqmin' }}>
          {[0, 1, 2].map((i) => {
            const dish = dishAt(i * 3);
            const expanded = open === i;
            return (
              <motion.div
                key={i}
                layout
                transition={SPRING}
                onClick={() => setChosen(expanded ? null : i)}
                style={{ borderRadius: '2.2cqmin', background: mix(background, '#ffffff', 0.55), padding: '2cqmin', cursor: 'pointer', overflow: 'hidden', boxShadow: expanded ? '0 10px 24px -14px rgb(40 24 12 / 0.5)' : 'none' }}
              >
                <motion.div layout="position" style={{ display: 'flex', alignItems: 'center', gap: '3cqmin' }}>
                  <motion.span layout transition={SPRING} style={{ position: 'relative', flex: '0 0 auto', width: expanded ? '18cqmin' : '9cqmin', height: expanded ? '18cqmin' : '9cqmin', borderRadius: '1.6cqmin', overflow: 'hidden' }}>
                    <DishPicture dish={dish} />
                  </motion.span>
                  <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '1.4cqmin' }}>
                    <TextBar width="58%" color={ink} style={{ opacity: 0.85 }} />
                    <TextBar width="32%" height="1.2cqmin" color={ink} style={{ opacity: 0.3 }} />
                  </span>
                  <span style={{ color: ink, fontWeight: 600, fontSize: '3.2cqmin', fontVariantNumeric: 'tabular-nums' }}>{formatPrice(dish.price)}</span>
                </motion.div>
                <AnimatePresence initial={false}>
                  {expanded && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={SPRING}
                      style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '3cqmin' }}
                    >
                      <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '1.2cqmin', paddingTop: '2.4cqmin' }}>
                        <TextBar width="92%" height="1.1cqmin" color={ink} style={{ opacity: 0.25 }} />
                        <TextBar width="84%" height="1.1cqmin" color={ink} style={{ opacity: 0.25 }} />
                        <TextBar width="60%" height="1.1cqmin" color={ink} style={{ opacity: 0.25 }} />
                      </span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '8cqmin', height: '8cqmin', borderRadius: '50%', background: accent, color: inkOn(accent) }}>
                        <Plus style={{ width: '4cqmin', height: '4cqmin' }} />
                      </span>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
      </LayoutGroup>
    </DomStage>
  );
}
