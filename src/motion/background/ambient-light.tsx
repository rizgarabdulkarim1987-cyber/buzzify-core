'use client';

import type { CSSProperties } from 'react';
import { mix, rgba } from '../engine/color';
import { DomStage, MotionStyle } from '../engine/dom';
import { str, type MotionProps } from '../types';

const CSS = `
@keyframes bzm-ambient-a { 0%, 100% { transform: translate(-10%, -6%) scale(1) } 50% { transform: translate(18%, 12%) scale(1.15) } }
@keyframes bzm-ambient-b { 0%, 100% { transform: translate(12%, 10%) scale(1.1) } 50% { transform: translate(-16%, -8%) scale(0.92) } }
@keyframes bzm-ambient-c { 0%, 100% { transform: translate(0%, 14%) scale(0.95) } 50% { transform: translate(6%, -14%) scale(1.12) } }
.bzm-ambient { position: absolute; width: 70%; height: 80%; border-radius: 50%; filter: blur(8cqmin); mix-blend-mode: screen }
`;

/**
 * #82 Pools of soft coloured light drifting over a dark room, as from candles and a bar's lamps: three glows, each on
 * its own long, slow path, overlapping into new colours where they meet.
 */
export default function AmbientLight({ params, playing, speed }: MotionProps) {
  const a = str(params, 'color');
  const b = str(params, 'accent');
  const glow = (colour: string, animation: string, duration: number, place: CSSProperties): CSSProperties => ({
    ...place,
    background: `radial-gradient(closest-side, ${rgba(colour, 0.85)}, ${rgba(colour, 0)})`,
    animation: `${animation} calc(${duration}s / var(--m-speed, 1)) ease-in-out infinite`,
  });
  return (
    <DomStage playing={playing} speed={speed} background={str(params, 'background')}>
      <MotionStyle id="ambient-light" css={CSS} />
      <div className="bzm-ambient" style={glow(a, 'bzm-ambient-a', 17, { left: '-10%', top: '-10%' })} />
      <div className="bzm-ambient" style={glow(b, 'bzm-ambient-b', 21, { right: '-12%', top: '10%' })} />
      <div className="bzm-ambient" style={glow(mix(a, b, 0.5), 'bzm-ambient-c', 25, { left: '15%', bottom: '-20%' })} />
    </DomStage>
  );
}
