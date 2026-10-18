'use client';

import { DomStage, MotionStyle } from '../engine/dom';
import { str, type MotionProps } from '../types';

const CSS = `
@keyframes bzm-gradient-pan { 0% { background-position: 0% 30% } 50% { background-position: 100% 70% } 100% { background-position: 0% 30% } }
@keyframes bzm-gradient-glow { 0% { transform: translate(-18%, -12%) } 50% { transform: translate(14%, 10%) } 100% { transform: translate(-18%, -12%) } }
.bzm-gradient { position: absolute; inset: 0; background-size: 280% 280%; animation: bzm-gradient-pan calc(16s / var(--m-speed, 1)) ease-in-out infinite }
.bzm-gradient-glow { position: absolute; inset: -30%; mix-blend-mode: soft-light; animation: bzm-gradient-glow calc(11s / var(--m-speed, 1)) ease-in-out infinite }
`;

/**
 * #76 A slow gradient through three colours that never stops moving: the colours pan across a wide field, and a soft
 * light drifts over them out of step, so the background breathes without ever repeating the same moment.
 */
export default function AnimatedGradient({ params, playing, speed }: MotionProps) {
  const a = str(params, 'color');
  const b = str(params, 'accent');
  const c = str(params, 'background');
  return (
    <DomStage playing={playing} speed={speed} background={c}>
      <MotionStyle id="animated-gradient" css={CSS} />
      <div className="bzm-gradient" style={{ backgroundImage: `linear-gradient(125deg, ${a}, ${b} 35%, ${c} 65%, ${a})` }} />
      <div className="bzm-gradient-glow" style={{ background: 'radial-gradient(40% 40% at 50% 50%, rgb(255 255 255 / 0.55), transparent 70%)' }} />
    </DomStage>
  );
}
