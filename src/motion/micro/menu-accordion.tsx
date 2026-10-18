'use client';

import { AnimatePresence, motion } from 'motion/react';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { DomStage, MotionStyle } from '../engine/dom';
import { useSequence } from '../engine/loop';
import { dishAt, DishPicture, formatPrice, MENU_CSS, TextBar } from '../engine/menu';
import { FONT, icon, palette } from '../engine/ui';
import { str, type MotionProps } from '../types';

const SPRING = { type: 'spring', duration: 0.45, bounce: 0.08 } as const;

/**
 * #103 A menu in folded sections: opening one unfolds its dishes as the others fold away, the chevron turning to show
 * which way each section goes. Untouched, the sections open in turn.
 */
export default function MenuAccordion({ params, playing, speed, replay }: MotionProps) {
  const colours = palette(str(params, 'background'), str(params, 'accent'));
  const [chosen, setChosen] = useState<number | null>(null);
  const demo = useSequence([2, 2, 2], { playing, speed, replay });
  const open = chosen ?? demo;
  return (
    <DomStage playing={playing} speed={speed} background={colours.background}>
      <MotionStyle id="menu" css={MENU_CSS} />
      <div style={{ position: 'absolute', insetInline: '12cqw', top: '7cqh', display: 'flex', flexDirection: 'column', gap: '1.6cqmin' }}>
        {[0, 1, 2].map((section) => {
          const expanded = open === section;
          return (
            <div key={section} style={{ borderRadius: '2.2cqmin', background: colours.surface, overflow: 'hidden' }}>
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setChosen(expanded ? -1 : section)}
                style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '2cqmin', padding: '2.8cqmin 3cqmin', border: 0, background: 'transparent', cursor: 'pointer', color: colours.ink }}
              >
                <TextBar width={`${34 + section * 8}%`} height="2cqmin" color={colours.ink} style={{ opacity: 0.85 }} />
                <motion.span animate={{ rotate: expanded ? 180 : 0 }} transition={SPRING} style={{ display: 'inline-flex' }}>
                  <ChevronDown style={icon('4cqmin')} />
                </motion.span>
              </button>
              <AnimatePresence initial={false}>
                {expanded && (
                  <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} transition={SPRING} style={{ overflow: 'hidden' }}>
                    <div style={{ padding: '0 3cqmin 2.6cqmin', display: 'flex', flexDirection: 'column', gap: '2cqmin' }}>
                      {[0, 1].map((k) => {
                        const dish = dishAt(section * 2 + k);
                        return (
                          <motion.div key={k} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ ...SPRING, delay: 0.06 + k * 0.05 }} style={{ display: 'flex', alignItems: 'center', gap: '2.4cqmin' }}>
                            <span style={{ position: 'relative', width: '9cqmin', height: '9cqmin', borderRadius: '1.4cqmin', overflow: 'hidden', flex: '0 0 auto' }}>
                              <DishPicture dish={dish} />
                            </span>
                            <TextBar width="50%" height="1.4cqmin" color={colours.ink} style={{ opacity: 0.4 }} />
                            <span style={{ ...FONT, marginInlineStart: 'auto', color: colours.ink, fontSize: '2.8cqmin', fontVariantNumeric: 'tabular-nums' }}>{formatPrice(dish.price)}</span>
                          </motion.div>
                        );
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </DomStage>
  );
}
