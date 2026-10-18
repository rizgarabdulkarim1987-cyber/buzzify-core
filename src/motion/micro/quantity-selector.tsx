'use client';

import { Minus, Plus } from 'lucide-react';
import { useState } from 'react';
import { RollingNumber } from '../engine/digits';
import { DomStage, MotionStyle } from '../engine/dom';
import { useSequence } from '../engine/loop';
import { FONT, icon, palette, Panel } from '../engine/ui';
import { str, type MotionProps } from '../types';

/** The demo's presses: +, +, +, −, −, −. */
const PRESSES = [1, 1, 1, -1, -1, -1];

const CSS = `
@keyframes bzm-press { 0% { transform: scale(1) } 35% { transform: scale(0.86) } 100% { transform: scale(1) } }
.bzm-press { display: inline-flex; animation: bzm-press calc(0.32s / var(--m-speed, 1)) cubic-bezier(.23, 1, .32, 1) both }
`;

/**
 * #94 A quantity stepper: minus and plus press in on a spring, and the number rolls up or down to its new value, so
 * the change is seen as well as read. Minus is dimmed at one. Untouched, it counts up to four and back.
 */
export default function QuantitySelector({ params, playing, speed, replay }: MotionProps) {
  const colours = palette(str(params, 'background'), str(params, 'accent'));
  const [quantity, setQuantity] = useState(1);
  // The last press, counted, so each press replays the button's dip even when it is the same button twice.
  const [press, setPress] = useState({ delta: 0, count: 0 });
  const step = useSequence(PRESSES.map(() => 0.9), { playing, speed, replay });
  const apply = (delta: number) => {
    setPress((last) => ({ delta, count: last.count + 1 }));
    setQuantity((value) => Math.max(1, Math.min(9, value + delta)));
  };
  // Each step of the demo presses a button (state adjusted while rendering, not in an effect).
  const [seen, setSeen] = useState(step);
  if (seen !== step) {
    setSeen(step);
    if (playing) apply(PRESSES[step]!);
  }
  const round = (delta: number, disabled: boolean) => (
    <button
      type="button"
      aria-label={delta > 0 ? '+' : '−'}
      onClick={() => apply(delta)}
      disabled={disabled}
      style={{ width: '12cqmin', height: '12cqmin', borderRadius: '50%', border: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: delta > 0 ? colours.accent : colours.surface, color: delta > 0 ? colours.onAccent : colours.ink, opacity: disabled ? 0.4 : 1, cursor: 'pointer' }}
    >
      <span key={press.delta === delta ? press.count : 'rest'} className={press.delta === delta ? 'bzm-press' : undefined} style={{ display: 'inline-flex' }}>
        {delta > 0 ? <Plus style={icon('5cqmin')} /> : <Minus style={icon('5cqmin')} />}
      </span>
    </button>
  );
  return (
    <DomStage playing={playing} speed={speed} background={colours.background}>
      <MotionStyle id="quantity-press" css={CSS} />
      <Panel width="auto" style={{ flexDirection: 'row', alignItems: 'center', gap: '5cqmin', padding: '2.4cqmin', borderRadius: 999, background: colours.surface, boxShadow: `inset 0 0 0 1px ${colours.line}` }}>
        {round(-1, quantity <= 1)}
        <RollingNumber value={String(quantity)} style={{ ...FONT, fontSize: '9cqmin', color: colours.ink }} />
        {round(1, quantity >= 9)}
      </Panel>
    </DomStage>
  );
}
