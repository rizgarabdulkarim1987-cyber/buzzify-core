'use client';

import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { DomStage, MotionStyle } from '../engine/dom';
import { useSequence } from '../engine/loop';
import { dishAt, DishPicture, formatPrice, MENU_CSS, TextBar } from '../engine/menu';
import { FONT, icon, palette } from '../engine/ui';
import { str, type MotionProps } from '../types';

const SPRING = { type: 'spring', duration: 0.5, bounce: 0.12 } as const;

/**
 * #96 A dish card that becomes its own page: pressed, the card's picture, name and price grow into a full sheet (the
 * same elements moving, not a new screen), with the details and an add button arriving inside it. Close shrinks it
 * back into the grid. Untouched, a card opens and closes by itself.
 */
export default function ProductCardExpansion({ params, playing, speed, replay }: MotionProps) {
  const colours = palette(str(params, 'background'), str(params, 'accent'));
  const [chosen, setChosen] = useState<number | null | undefined>(undefined);
  const demo = useSequence([1.6, 2.4, 1.6, 2.4], { playing, speed, replay });
  const open = chosen === undefined ? (demo === 1 ? 0 : demo === 3 ? 1 : null) : chosen;
  return (
    <DomStage playing={playing} speed={speed} background={colours.background}>
      <MotionStyle id="menu" css={MENU_CSS} />
      <LayoutGroup>
        <div style={{ position: 'absolute', inset: '10cqh 12cqw', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4cqw', alignContent: 'center' }}>
          {[0, 1].map((i) => {
            const dish = dishAt(i * 4 + 2);
            return (
              <motion.div key={i} layoutId={`card-${i}`} transition={SPRING} onClick={() => setChosen(i)} style={{ borderRadius: '2.4cqmin', background: colours.surface, overflow: 'hidden', cursor: 'pointer', opacity: open === i ? 0 : 1 }}>
                <motion.div layoutId={`picture-${i}`} transition={SPRING} style={{ position: 'relative', aspectRatio: '1 / 1' }}>
                  <DishPicture dish={dish} />
                </motion.div>
                <div style={{ padding: '2.4cqmin', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <TextBar width="50%" color={colours.ink} style={{ opacity: 0.8 }} />
                  <motion.span layoutId={`price-${i}`} transition={SPRING} style={{ ...FONT, color: colours.ink, fontSize: '3cqmin', fontVariantNumeric: 'tabular-nums' }}>
                    {formatPrice(dish.price)}
                  </motion.span>
                </div>
              </motion.div>
            );
          })}
        </div>
        <AnimatePresence>
          {open !== null && (
            <motion.div key="sheet" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ position: 'absolute', inset: 0, background: 'rgb(20 12 6 / 0.35)' }}>
              <motion.div
                layoutId={`card-${open}`}
                transition={SPRING}
                style={{ position: 'absolute', inset: '6cqh 14cqw', borderRadius: '3cqmin', background: colours.surface, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
              >
                <motion.div layoutId={`picture-${open}`} transition={SPRING} style={{ position: 'relative', height: '52%' }}>
                  <DishPicture dish={dishAt(open * 4 + 2)} />
                  <button
                    type="button"
                    aria-label="×"
                    onClick={() => setChosen(null)}
                    style={{ position: 'absolute', top: '2cqmin', insetInlineEnd: '2cqmin', width: '7cqmin', height: '7cqmin', borderRadius: '50%', border: 0, background: 'rgb(0 0 0 / 0.5)', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                  >
                    <X style={icon('3.6cqmin')} />
                  </button>
                </motion.div>
                <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ ...SPRING, delay: 0.12 }} style={{ padding: '3cqmin', display: 'flex', flexDirection: 'column', gap: '1.6cqmin', flex: 1 }}>
                  <TextBar width="60%" height="2.4cqmin" color={colours.ink} />
                  <TextBar width="90%" height="1.2cqmin" color={colours.ink} style={{ opacity: 0.25 }} />
                  <TextBar width="74%" height="1.2cqmin" color={colours.ink} style={{ opacity: 0.25 }} />
                  <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <motion.span layoutId={`price-${open}`} transition={SPRING} style={{ ...FONT, color: colours.ink, fontSize: '5cqmin', fontVariantNumeric: 'tabular-nums' }}>
                      {formatPrice(dishAt(open * 4 + 2).price)}
                    </motion.span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '1.4cqmin', padding: '1.8cqmin 3.6cqmin', borderRadius: 999, background: colours.accent, color: colours.onAccent }}>
                      <Plus style={icon('3.6cqmin')} />
                    </span>
                  </div>
                </motion.div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </LayoutGroup>
    </DomStage>
  );
}
