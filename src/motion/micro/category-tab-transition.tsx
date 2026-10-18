'use client';

import { AnimatePresence, motion } from 'motion/react';
import { Coffee, Croissant, IceCreamCone, Sandwich, type LucideIcon } from 'lucide-react';
import { useId, useState } from 'react';
import { DomStage, MotionStyle } from '../engine/dom';
import { useSequence } from '../engine/loop';
import { dishAt, DishPicture, MENU_CSS } from '../engine/menu';
import { icon, palette } from '../engine/ui';
import { str, type MotionProps } from '../types';

const TABS: LucideIcon[] = [Coffee, Croissant, Sandwich, IceCreamCone];
const SPRING = { type: 'spring', duration: 0.42, bounce: 0.14 } as const;

/**
 * #97 Category tabs that show where the guest is going: the highlight slides to the chosen tab, and the dishes slide
 * in from that side, so moving right feels like moving right. Untouched, the tabs are walked through in turn.
 */
export default function CategoryTabTransition({ params, playing, speed, replay, dir }: MotionProps) {
  const id = useId();
  const colours = palette(str(params, 'background'), str(params, 'accent'));
  const [chosen, setChosen] = useState<number | null>(null);
  const demo = useSequence(TABS.map(() => 1.7), { playing, speed, replay });
  const tab = chosen ?? demo;
  // Which way the last change went, kept with the tab it went to (state adjusted while rendering, not in an effect).
  const [seen, setSeen] = useState(tab);
  const [direction, setDirection] = useState(1);
  if (seen !== tab) {
    setDirection(tab > seen ? 1 : -1);
    setSeen(tab);
  }
  const side = (dir === 'rtl' ? -1 : 1) * direction;
  return (
    <DomStage playing={playing} speed={speed} background={colours.background}>
      <MotionStyle id="menu" css={MENU_CSS} />
      <div style={{ position: 'absolute', top: '9cqh', insetInline: '10cqw', display: 'flex', gap: '1.6cqmin', padding: '1.2cqmin', borderRadius: 999, background: colours.surface }}>
        {TABS.map((Icon, i) => (
          <button key={i} type="button" aria-label={`${i + 1}`} onClick={() => setChosen(i)} style={{ position: 'relative', flex: 1, height: '9cqmin', border: 0, background: 'transparent', borderRadius: 999, cursor: 'pointer', color: tab === i ? colours.onAccent : colours.ink }}>
            {tab === i && <motion.span layoutId={`${id}-pill`} transition={SPRING} style={{ position: 'absolute', inset: 0, borderRadius: 999, background: colours.accent }} />}
            <span style={{ position: 'relative', display: 'inline-flex' }}>
              <Icon style={icon('4.4cqmin')} />
            </span>
          </button>
        ))}
      </div>
      <div style={{ position: 'absolute', top: '26cqh', bottom: '8cqh', insetInline: '10cqw', overflow: 'hidden' }}>
        <AnimatePresence initial={false} custom={side} mode="popLayout">
          <motion.div
            key={tab}
            custom={side}
            initial={{ x: `${side * 70}cqw`, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: `${-side * 70}cqw`, opacity: 0 }}
            transition={SPRING}
            style={{ position: 'absolute', inset: 0, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '3cqmin' }}
          >
            {[0, 1, 2].map((k) => (
              <div key={k} style={{ position: 'relative', borderRadius: '2cqmin', overflow: 'hidden' }}>
                <DishPicture dish={dishAt(tab * 3 + k)} />
              </div>
            ))}
          </motion.div>
        </AnimatePresence>
      </div>
    </DomStage>
  );
}
