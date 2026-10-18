'use client';

import { motion, useTransform } from 'motion/react';
import { inkOn, mix } from '../engine/color';
import { DomStage, MotionStyle } from '../engine/dom';
import { DishPicture, MENU_CSS, SAMPLE_MENU, TextBar } from '../engine/menu';
import { easeInOutCubic } from '../engine/math';
import { str, type MotionProps } from '../types';

type Shape = 'circle' | 'arch' | 'diamond';

/**
 * #19 A window in the dark page opens over the dish as the scroll goes on: a circle, an arch or a diamond drawn in the
 * accent colour grows from a point to frame the dish, which settles from a slight zoom. Its caption fades in last.
 */
export default function ScrollProductReveal({ params, playing, speed, progress }: MotionProps) {
  const background = str(params, 'background');
  const accent = str(params, 'accent');
  const shape = str(params, 'shape') as Shape;
  const ink = inkOn(background);
  // Half the window's size, in the stage's smaller side.
  const half = useTransform(progress, (p) => 4 + easeInOutCubic(Math.min(1, p / 0.8)) * 38);
  const width = useTransform(half, (h) => `${(shape === 'arch' ? h * 0.8 : shape === 'diamond' ? h * Math.SQRT2 : h) * 2}cqmin`);
  const height = useTransform(half, (h) => `${(shape === 'arch' ? h * 1.12 : shape === 'diamond' ? h * Math.SQRT2 : h) * 2}cqmin`);
  const radius = useTransform(half, (h) => (shape === 'circle' ? '50%' : shape === 'arch' ? `${h * 0.8}cqmin ${h * 0.8}cqmin 1cqmin 1cqmin` : '1.2cqmin'));
  const zoom = useTransform(progress, [0, 0.85], [1.35, 1]);
  const caption = useTransform(progress, [0.7, 0.95], [0, 1]);
  const captionY = useTransform(progress, [0.7, 0.95], ['3cqh', '0cqh']);
  const turn = shape === 'diamond' ? 45 : 0;

  return (
    <DomStage playing={playing} speed={speed} background={background}>
      <MotionStyle id="menu" css={MENU_CSS} />
      <motion.div
        style={{
          position: 'absolute',
          left: '50%',
          top: '46%',
          width,
          height,
          x: '-50%',
          y: '-50%',
          rotate: turn,
          borderRadius: radius,
          overflow: 'hidden',
          boxShadow: `0 0 0 0.5cqmin ${accent}, 0 3cqmin 8cqmin -3cqmin rgb(0 0 0 / 0.6)`,
        }}
      >
        <motion.div style={{ position: 'absolute', left: '50%', top: '50%', width: '100cqmax', height: '100cqmax', x: '-50%', y: '-50%', rotate: -turn, scale: zoom }}>
          <DishPicture dish={SAMPLE_MENU[5]!} />
        </motion.div>
      </motion.div>
      <motion.div style={{ position: 'absolute', insetInline: 0, bottom: '7cqh', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.6cqmin', opacity: caption, y: captionY }}>
        <TextBar width="28cqw" height="2cqmin" color={ink} />
        <TextBar width="18cqw" height="1.3cqmin" color={mix(ink, background, 0.5)} />
      </motion.div>
    </DomStage>
  );
}
