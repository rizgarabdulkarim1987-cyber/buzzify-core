'use client';

import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { DomStage } from '../engine/dom';
import { useSequence } from '../engine/loop';
import { TAU } from '../engine/math';
import { palette, Panel } from '../engine/ui';
import { str, type MotionProps } from '../types';

const HEART = 'M12 21s-7.5-4.6-9.6-9.3C.9 8.3 2.9 4.5 6.6 4.1c2.1-.2 3.9.9 5.4 2.8 1.5-1.9 3.3-3 5.4-2.8 3.7.4 5.7 4.2 4.2 7.6C19.5 16.4 12 21 12 21z';

/**
 * #98 Saving a dish as a favourite: the heart squashes, then fills and bounces up with a ring and a burst of little
 * dots around it. Pressing again empties it quietly, with no celebration. Untouched, it is liked and unliked in turn.
 */
export default function FavoriteHeart({ params, playing, speed, replay }: MotionProps) {
  const colour = str(params, 'color');
  const colours = palette(str(params, 'background'), colour);
  const [chosen, setChosen] = useState<boolean | null>(null);
  const demo = useSequence([1.4, 2.2], { playing, speed, replay });
  const liked = chosen ?? demo === 1;
  return (
    <DomStage playing={playing} speed={speed} background={colours.background}>
      <Panel width="auto" style={{ alignItems: 'center' }}>
        <button type="button" aria-pressed={liked} aria-label="♥" onClick={() => setChosen(!liked)} style={{ position: 'relative', width: '26cqmin', height: '26cqmin', border: 0, background: 'transparent', cursor: 'pointer' }}>
          <AnimatePresence>
            {liked && (
              <motion.span key="ring" initial={{ scale: 0.3, opacity: 0.9 }} animate={{ scale: 1.6, opacity: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.55, ease: [0.23, 1, 0.32, 1] }} style={{ position: 'absolute', inset: '18%', borderRadius: '50%', border: `0.8cqmin solid ${colour}` }} />
            )}
          </AnimatePresence>
          {liked &&
            Array.from({ length: 10 }, (_, i) => {
              const a = (i / 10) * TAU;
              return (
                <motion.span
                  key={`dot-${i}`}
                  initial={{ x: 0, y: 0, scale: 1, opacity: 1 }}
                  animate={{ x: `${Math.cos(a) * 15}cqmin`, y: `${Math.sin(a) * 15}cqmin`, scale: 0, opacity: 0.9 }}
                  transition={{ duration: 0.65, ease: [0.23, 1, 0.32, 1] }}
                  style={{ position: 'absolute', left: '50%', top: '50%', width: '2.2cqmin', height: '2.2cqmin', margin: '-1.1cqmin', borderRadius: '50%', background: i % 2 === 0 ? colour : colours.accent }}
                />
              );
            })}
          <motion.svg
            viewBox="0 0 24 24"
            animate={liked ? { scale: [1, 0.7, 1.22, 1] } : { scale: 1 }}
            transition={liked ? { duration: 0.6, times: [0, 0.2, 0.55, 1], ease: 'easeOut' } : { duration: 0.2 }}
            style={{ position: 'absolute', inset: '22%', width: '56%', height: '56%', overflow: 'visible' }}
          >
            <motion.path d={HEART} animate={{ fill: liked ? colour : 'rgba(0,0,0,0)' }} transition={{ duration: 0.2 }} stroke={liked ? colour : colours.ink} strokeWidth="1.6" strokeLinejoin="round" />
          </motion.svg>
        </button>
      </Panel>
    </DomStage>
  );
}
