'use client';

import { AnimatePresence, motion } from 'motion/react';
import { Check, CreditCard } from 'lucide-react';
import { mix } from '../engine/color';
import { DomStage } from '../engine/dom';
import { useSequence } from '../engine/loop';
import { formatPrice, TextBar } from '../engine/menu';
import { FONT, icon, palette } from '../engine/ui';
import { str, type MotionProps } from '../types';

const SPRING = { type: 'spring', duration: 0.55, bounce: 0.2 } as const;

/**
 * #104 Paying, then paid: the pay button presses and shrinks into a round badge, the badge turns green with a tick,
 * and a receipt slides up out of it line by line with the total at the foot.
 */
export default function CheckoutSuccess({ params, playing, speed, replay }: MotionProps) {
  const success = str(params, 'color');
  const colours = palette(str(params, 'background'), '#2b1a12');
  const step = useSequence([1.4, 0.6, 2.8], { playing, speed, replay });
  const paid = step === 2;
  return (
    <DomStage playing={playing} speed={speed} background={colours.background}>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '3cqmin' }}>
        <AnimatePresence>
          {paid && (
            <motion.div
              key="receipt"
              initial={{ y: '10cqh', opacity: 0, clipPath: 'inset(100% 0 0 0)' }}
              animate={{ y: 0, opacity: 1, clipPath: 'inset(0% 0 0 0)' }}
              exit={{ opacity: 0 }}
              transition={{ ...SPRING, delay: 0.25 }}
              style={{ width: '44cqw', padding: '3cqmin', borderRadius: '1.6cqmin', background: '#fffdf9', boxShadow: '0 2cqmin 5cqmin -2cqmin rgb(40 24 12 / 0.35)', display: 'flex', flexDirection: 'column', gap: '1.6cqmin', order: 2 }}
            >
              {[0, 1, 2].map((i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <TextBar width={`${40 + i * 12}%`} height="1.3cqmin" color={colours.ink} style={{ opacity: 0.35 }} />
                  <span style={{ ...FONT, fontSize: '2.6cqmin', color: colours.muted, fontVariantNumeric: 'tabular-nums' }}>{formatPrice([4.5, 11, 3.75][i]!)}</span>
                </div>
              ))}
              <div style={{ borderTop: `1px dashed ${colours.line}`, paddingTop: '1.6cqmin', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <TextBar width="22%" height="1.6cqmin" color={colours.ink} />
                <span style={{ ...FONT, fontSize: '3.6cqmin', color: colours.ink, fontVariantNumeric: 'tabular-nums' }}>{formatPrice(19.25)}</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <motion.div
          layout
          transition={SPRING}
          animate={{ scale: step === 1 ? 0.94 : 1 }}
          style={{
            order: 1,
            height: '12cqmin',
            width: step === 0 ? '44cqw' : '12cqmin',
            borderRadius: 999,
            background: paid ? success : colours.ink,
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '2cqmin',
            boxShadow: paid ? `0 0 0 2cqmin ${mix(success, colours.background, 0.75)}` : 'none',
          }}
        >
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span key={paid ? 'tick' : step === 1 ? 'press' : 'pay'} initial={{ opacity: 0, scale: 0.4 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.4 }} transition={{ duration: 0.2 }} style={{ display: 'inline-flex', alignItems: 'center', gap: '2cqmin' }}>
              {paid ? <Check style={icon('6cqmin')} /> : <CreditCard style={icon('5cqmin')} />}
              {step === 0 && <span style={{ ...FONT, fontSize: '3.6cqmin', fontVariantNumeric: 'tabular-nums' }}>{formatPrice(19.25)}</span>}
            </motion.span>
          </AnimatePresence>
        </motion.div>
      </div>
    </DomStage>
  );
}
