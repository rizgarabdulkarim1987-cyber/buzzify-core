'use client';

import { AnimatePresence, motion } from 'motion/react';
import { BellRing, ChefHat, Gift, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { DomStage } from '../engine/dom';
import { useSequence } from '../engine/loop';
import { TextBar } from '../engine/menu';
import { icon, palette } from '../engine/ui';
import { str, type MotionProps } from '../types';

const KINDS: LucideIcon[] = [ChefHat, BellRing, Gift];
const MOST = 3;

/**
 * #102 Notices that arrive without interrupting: each slides down from the top on a spring and the ones before it step
 * back and shrink into a stack; the oldest leaves when a fourth arrives. Untouched, notices keep arriving.
 */
export default function NotificationSlideIn({ params, playing, speed, replay }: MotionProps) {
  const colours = palette(str(params, 'background'), str(params, 'accent'));
  const tick = useSequence([1.3, 1.3], { playing, speed, replay });
  const [notices, setNotices] = useState<number[]>([0]);
  // A new notice arrives with each step of the sequence (state adjusted while rendering, not in an effect).
  const [seen, setSeen] = useState(tick);
  if (seen !== tick) {
    setSeen(tick);
    if (playing) setNotices((list) => [(list[0] ?? 0) + 1, ...list].slice(0, MOST));
  }
  return (
    <DomStage playing={playing} speed={speed} background={colours.background}>
      <div style={{ position: 'absolute', top: '10cqh', insetInline: '16cqw' }}>
        <AnimatePresence initial={false}>
          {notices.map((id, depth) => {
            const Icon = KINDS[id % KINDS.length]!;
            return (
              <motion.div
                key={id}
                initial={{ y: '-30cqh', opacity: 0, scale: 1 }}
                animate={{ y: `${depth * 4}cqh`, opacity: 1 - depth * 0.25, scale: 1 - depth * 0.06 }}
                exit={{ opacity: 0, scale: 0.85, y: `${MOST * 4}cqh` }}
                transition={{ type: 'spring', duration: 0.55, bounce: 0.22 }}
                style={{
                  position: 'absolute',
                  insetInline: 0,
                  top: 0,
                  zIndex: MOST - depth,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '3cqmin',
                  padding: '2.6cqmin 3cqmin',
                  borderRadius: '2.6cqmin',
                  background: colours.surface,
                  boxShadow: '0 2cqmin 5cqmin -2cqmin rgb(40 24 12 / 0.4)',
                }}
              >
                <span style={{ width: '9cqmin', height: '9cqmin', borderRadius: '50%', background: colours.accent, color: colours.onAccent, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}>
                  <Icon style={icon('4.6cqmin')} />
                </span>
                <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '1.4cqmin' }}>
                  <TextBar width={`${50 + ((id * 13) % 30)}%`} color={colours.ink} style={{ opacity: 0.85 }} />
                  <TextBar width={`${30 + ((id * 17) % 30)}%`} height="1.2cqmin" color={colours.ink} style={{ opacity: 0.3 }} />
                </span>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </DomStage>
  );
}
