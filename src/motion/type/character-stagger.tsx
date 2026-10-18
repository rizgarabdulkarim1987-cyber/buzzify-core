'use client';

import { CENTER, DomStage, MotionStyle } from '../engine/dom';
import { fontStyle } from '../engine/fonts';
import { SplitText, TITLE } from '../engine/text';
import { str, type MotionProps } from '../types';

const CSS = `
@keyframes bzm-wave { 0%, 100% { transform: translateY(0) rotate(0deg) } 25% { transform: translateY(-0.28em) rotate(-3deg) } 50% { transform: translateY(0) rotate(0deg) } }
.bzm-wave { animation: bzm-wave calc(2.2s / var(--m-speed, 1)) cubic-bezier(.45, 0, .55, 1) infinite; animation-delay: calc(var(--i) * 0.06s / var(--m-speed, 1)) }
`;

/**
 * #119 Letters riding a wave: each lifts and falls a moment after the one before, so a ripple runs through the line
 * from its first letter to its last and starts again. Arabic and Sorani ride it in joined runs.
 */
export default function CharacterStagger({ params, playing, speed }: MotionProps) {
  return (
    <DomStage playing={playing} speed={speed} background={str(params, 'background')}>
      <MotionStyle id="character-stagger" css={CSS} />
      <div style={CENTER}>
        <SplitText text={str(params, 'text')} by="letter" className="bzm-wave" style={{ ...TITLE, ...fontStyle(str(params, 'font')), fontSize: '10cqmin', color: str(params, 'color') }} />
      </div>
    </DomStage>
  );
}
