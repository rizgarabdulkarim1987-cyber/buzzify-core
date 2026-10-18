'use client';

import { motion } from 'motion/react';
import { useState } from 'react';
import { shade } from '../engine/color';
import { DomStage } from '../engine/dom';
import { useSequence } from '../engine/loop';
import { FONT, palette, Panel } from '../engine/ui';
import { str, type MotionProps } from '../types';

/**
 * #91 A button that feels pressed: it sinks onto its own edge and shrinks a hair under the finger, its shadow tightening,
 * and springs back up on release. Untouched, it is pressed now and then.
 */
export default function ButtonPress({ params, playing, speed, replay }: MotionProps) {
  const colours = palette(str(params, 'background'), str(params, 'accent'));
  const [held, setHeld] = useState(false);
  const demo = useSequence([1.5, 0.22], { playing, speed, replay });
  const down = held || demo === 1;
  const edge = shade(colours.accent, -0.35);
  return (
    <DomStage playing={playing} speed={speed} background={colours.background}>
      <Panel width="auto" style={{ alignItems: 'center' }}>
        <motion.button
          type="button"
          onPointerDown={() => setHeld(true)}
          onPointerUp={() => setHeld(false)}
          onPointerLeave={() => setHeld(false)}
          animate={{
            y: down ? '0.9cqmin' : '0cqmin',
            scale: down ? 0.97 : 1,
            boxShadow: down ? `0 0.3cqmin 0 ${edge}, 0 0.6cqmin 1.2cqmin -0.6cqmin rgb(0 0 0 / 0.35)` : `0 1.2cqmin 0 ${edge}, 0 3cqmin 4cqmin -2cqmin rgb(0 0 0 / 0.35)`,
          }}
          transition={down ? { duration: 0.08, ease: 'easeOut' } : { type: 'spring', duration: 0.35, bounce: 0.45 }}
          style={{ ...FONT, border: 0, borderRadius: '2.4cqmin', padding: '3.4cqmin 9cqmin', fontSize: '4.6cqmin', background: colours.accent, color: colours.onAccent, cursor: 'pointer' }}
        >
          <span dir="auto">{str(params, 'text')}</span>
        </motion.button>
      </Panel>
    </DomStage>
  );
}
