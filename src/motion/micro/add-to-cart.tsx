'use client';

import { AnimatePresence, motion } from 'motion/react';
import { Check, LoaderCircle, Plus, ShoppingBag } from 'lucide-react';
import { DomStage, MotionStyle } from '../engine/dom';
import { useSequence } from '../engine/loop';
import { DishPicture, formatPrice, MENU_CSS, SAMPLE_MENU, TextBar } from '../engine/menu';
import { FONT, icon, palette, Panel } from '../engine/ui';
import { str, type MotionProps } from '../types';

const CSS = '@keyframes bzm-spin { to { transform: rotate(360deg) } } .bzm-spin { animation: bzm-spin calc(0.8s / var(--m-speed, 1)) linear infinite }';

/**
 * #92 Adding a dish to the order: the add button narrows to a spinner while the order is updated, turns to a tick
 * once it is in, and the bag's count bumps up. Then the button is ready for the next one.
 */
export default function AddToCart({ params, playing, speed, replay }: MotionProps) {
  const colours = palette(str(params, 'background'), str(params, 'accent'));
  const step = useSequence([1.6, 0.9, 1.6], { playing, speed, replay });
  const count = step === 2 ? 3 : 2;
  const dish = SAMPLE_MENU[1]!;
  const content = step === 0 ? <Plus style={icon('4cqmin')} /> : step === 1 ? <LoaderCircle className="bzm-spin" style={icon('4cqmin')} /> : <Check style={icon('4.2cqmin')} />;
  return (
    <DomStage playing={playing} speed={speed} background={colours.background}>
      <MotionStyle id="menu" css={MENU_CSS} />
      <MotionStyle id="spin" css={CSS} />
      <div style={{ position: 'absolute', top: '7cqh', insetInlineEnd: '8cqw', color: colours.ink }}>
        <ShoppingBag style={icon('6cqmin')} />
        <motion.span
          key={count}
          initial={{ scale: 0.4 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', duration: 0.4, bounce: 0.6 }}
          style={{ ...FONT, position: 'absolute', top: '-1.4cqmin', insetInlineEnd: '-1.8cqmin', minWidth: '3.6cqmin', height: '3.6cqmin', borderRadius: 999, background: colours.accent, color: colours.onAccent, fontSize: '2.2cqmin', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          {count}
        </motion.span>
      </div>
      <Panel width="56cqw">
        <div style={{ display: 'flex', alignItems: 'center', gap: '3cqmin', padding: '2.4cqmin', borderRadius: '2.4cqmin', background: colours.surface }}>
          <span style={{ position: 'relative', width: '14cqmin', height: '14cqmin', borderRadius: '1.8cqmin', overflow: 'hidden', flex: '0 0 auto' }}>
            <DishPicture dish={dish} />
          </span>
          <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '1.4cqmin' }}>
            <TextBar width="70%" color={colours.ink} style={{ opacity: 0.85 }} />
            <span style={{ ...FONT, color: colours.ink, fontSize: '3cqmin', fontVariantNumeric: 'tabular-nums' }}>{formatPrice(dish.price)}</span>
          </span>
          <motion.span
            layout
            transition={{ type: 'spring', duration: 0.4, bounce: 0.2 }}
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', height: '9cqmin', width: step === 1 ? '9cqmin' : '16cqmin', borderRadius: 999, background: step === 2 ? '#2fa36b' : colours.accent, color: colours.onAccent }}
          >
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span key={step} initial={{ opacity: 0, scale: 0.5 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.5 }} transition={{ duration: 0.18 }} style={{ display: 'inline-flex' }}>
                {content}
              </motion.span>
            </AnimatePresence>
          </motion.span>
        </div>
      </Panel>
    </DomStage>
  );
}
