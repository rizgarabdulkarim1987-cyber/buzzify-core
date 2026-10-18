'use client';

import { motion, useMotionValueEvent, useTransform, type MotionValue } from 'motion/react';
import { useState } from 'react';
import { inkOn, mix } from '../engine/color';
import { DomStage, MotionStyle } from '../engine/dom';
import { dishAt, DishPicture, formatPrice, MENU_CSS, TextBar } from '../engine/menu';
import { num, str, type MotionProps } from '../types';

/** A menu row that springs in once the scroll passes its line, and leaves again when the scroll goes back above it. */
function Row({ index, at, progress, ink, line }: { index: number; at: number; progress: MotionValue<number>; ink: string; line: string }) {
  const [shown, setShown] = useState(progress.get() >= at);
  useMotionValueEvent(progress, 'change', (p) => {
    if (p >= at !== shown) setShown(p >= at);
  });
  const dish = dishAt(index);
  return (
    <motion.li
      initial={false}
      animate={shown ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: 24, scale: 0.96 }}
      transition={shown ? { type: 'spring', duration: 0.55, bounce: 0.28 } : { duration: 0.2, ease: [0.4, 0, 1, 1] }}
      style={{ display: 'flex', alignItems: 'center', gap: '3cqmin', padding: '1.8cqmin 0', borderBottom: `1px solid ${line}` }}
    >
      <span style={{ position: 'relative', flex: '0 0 auto', width: '11cqmin', height: '11cqmin', borderRadius: '2.2cqmin', overflow: 'hidden' }}>
        <DishPicture dish={dish} />
      </span>
      <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '1.4cqmin' }}>
        <TextBar width={`${52 + ((index * 17) % 30)}%`} color={ink} style={{ opacity: 0.85 }} />
        <TextBar width={`${34 + ((index * 23) % 24)}%`} height="1.2cqmin" color={ink} style={{ opacity: 0.3 }} />
      </span>
      <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, fontSize: '3.4cqmin', color: ink }}>{formatPrice(dish.price)}</span>
    </motion.li>
  );
}

/**
 * #17 Rows of a menu page spring into place as the scroll reaches each one. The scroll only decides when; each row then
 * moves on its own spring, so a fast flick and a slow read look equally composed.
 */
export default function ScrollTriggered({ params, playing, speed, progress }: MotionProps) {
  const background = str(params, 'background');
  const ink = inkOn(background, str(params, 'accent'));
  const count = num(params, 'count');
  const page = useTransform(progress, [0, 1], ['4cqh', `${-Math.max(0, count - 4) * 9}cqh`]);
  return (
    <DomStage playing={playing} speed={speed} background={background}>
      <MotionStyle id="menu" css={MENU_CSS} />
      <motion.ul style={{ y: page, position: 'absolute', insetInline: '12cqw', top: '8cqh', listStyle: 'none', margin: 0, padding: 0 }}>
        {Array.from({ length: count }, (_, i) => (
          <Row key={i} index={i} at={0.06 + (i / count) * 0.8} progress={progress} ink={ink} line={mix(background, ink, 0.12)} />
        ))}
      </motion.ul>
    </DomStage>
  );
}
