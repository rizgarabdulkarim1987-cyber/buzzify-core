'use client';

import { motion, useTransform } from 'motion/react';
import { inkOn, mix } from '../engine/color';
import { DomStage, MotionStyle } from '../engine/dom';
import { dishAt, DishPicture, MENU_CSS } from '../engine/menu';
import { str, type MotionProps } from '../types';

/**
 * #29 A menu page that moves from its morning colours to its evening ones as it scrolls: the ground, the ink and the
 * rules all blend between the two palettes, and the sun in the corner wanes into a crescent moon.
 */
export default function ScrollColorTransition({ params, playing, speed, progress }: MotionProps) {
  const morning = str(params, 'color');
  const evening = str(params, 'accent');
  const inkMorning = inkOn(morning);
  const inkEvening = inkOn(evening);
  const ground = useTransform(progress, [0, 1], [morning, evening]);
  const ink = useTransform(progress, [0, 1], [inkMorning, inkEvening]);
  const rule = useTransform(progress, [0, 1], [mix(morning, inkMorning, 0.14), mix(evening, inkEvening, 0.16)]);
  const sun = useTransform(progress, [0, 1], ['#f6b73c', '#f2ead6']);
  // The moon's shadow slides over the sun from the side.
  const shadowX = useTransform(progress, [0, 1], ['130%', '38%']);
  const glow = useTransform(progress, [0, 1], ['0 0 6cqmin 1cqmin rgb(246 183 60 / 0.55)', '0 0 4cqmin 0 rgb(242 234 214 / 0.25)']);

  return (
    <DomStage playing={playing} speed={speed}>
      <MotionStyle id="menu" css={MENU_CSS} />
      <motion.div style={{ position: 'absolute', inset: 0, background: ground }} />
      <motion.span style={{ position: 'absolute', top: '9cqh', insetInlineEnd: '9cqw', width: '11cqmin', height: '11cqmin', borderRadius: '50%', background: sun, boxShadow: glow, overflow: 'hidden' }}>
        <motion.span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: ground, x: shadowX, y: '-12%' }} />
      </motion.span>
      <div style={{ position: 'absolute', top: '10cqh', insetInlineStart: '9cqw', display: 'flex', flexDirection: 'column', gap: '2cqmin', width: '46cqw' }}>
        <motion.span style={{ display: 'block', height: '3.4cqmin', width: '70%', borderRadius: 999, background: ink }} />
        <motion.span style={{ display: 'block', height: '1.6cqmin', width: '45%', borderRadius: 999, background: ink, opacity: 0.45 }} />
      </div>
      <div style={{ position: 'absolute', top: '30cqh', insetInline: '9cqw', display: 'flex', flexDirection: 'column' }}>
        {[0, 1, 2].map((i) => (
          <motion.div key={i} style={{ display: 'flex', alignItems: 'center', gap: '3cqmin', padding: '2.2cqmin 0', borderBottom: '1px solid', borderColor: rule }}>
            <span style={{ position: 'relative', width: '12cqmin', height: '12cqmin', borderRadius: '50%', overflow: 'hidden', flex: '0 0 auto' }}>
              <DishPicture dish={dishAt(i * 2)} />
            </span>
            <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '1.4cqmin' }}>
              <motion.span style={{ display: 'block', height: '1.8cqmin', width: `${62 - i * 9}%`, borderRadius: 999, background: ink, opacity: 0.85 }} />
              <motion.span style={{ display: 'block', height: '1.2cqmin', width: `${40 + i * 6}%`, borderRadius: 999, background: ink, opacity: 0.35 }} />
            </span>
          </motion.div>
        ))}
      </div>
    </DomStage>
  );
}
