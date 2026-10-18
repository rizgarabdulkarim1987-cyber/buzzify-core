'use client';

import { motion } from 'motion/react';
import type { CSSProperties } from 'react';

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

/**
 * A number shown as rolling digits, like an odometer: each digit is a column of 0–9 that springs to its value, so a
 * change from 4.50 to 5.25 rolls each column the shortest honest way. Separators stand still.
 */
export function RollingNumber({ value, style, digitStyle }: { value: string; style?: CSSProperties; digitStyle?: CSSProperties }) {
  return (
    <span dir="ltr" style={{ display: 'inline-flex', overflow: 'hidden', lineHeight: 1, fontVariantNumeric: 'tabular-nums', ...style }}>
      {Array.from(value).map((char, i) => {
        const index = DIGITS.indexOf(char);
        if (index < 0) return <span key={`s${i}`}>{char}</span>;
        return (
          <span key={`d${value.length - i}`} style={{ position: 'relative', display: 'inline-block', height: '1em', width: '0.62em', overflow: 'hidden', ...digitStyle }}>
            <motion.span
              initial={false}
              animate={{ y: `${-index}em` }}
              transition={{ type: 'spring', duration: 0.55, bounce: 0.15 }}
              style={{ position: 'absolute', insetInline: 0, top: 0, display: 'flex', flexDirection: 'column', alignItems: 'center' }}
            >
              {DIGITS.map((digit) => (
                <span key={digit} style={{ height: '1em' }}>
                  {digit}
                </span>
              ))}
            </motion.span>
          </span>
        );
      })}
    </span>
  );
}
