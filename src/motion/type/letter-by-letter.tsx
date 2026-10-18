'use client';

import { CENTER, DomStage, MotionStyle } from '../engine/dom';
import { fontStyle } from '../engine/fonts';
import { cycleOffset, SplitText, TITLE } from '../engine/text';
import { str, type MotionProps } from '../types';

const CSS = `
@keyframes bzm-letter { 0% { opacity: 0; transform: translateY(0.3em) } 8% { opacity: 1; transform: translateY(0) } 80% { opacity: 1; transform: translateY(0) } 90% { opacity: 0 } 100% { opacity: 0 } }
.bzm-letter { animation: bzm-letter calc(5s / var(--m-speed, 1)) cubic-bezier(.23, 1, .32, 1) infinite both; animation-delay: calc((var(--i) * 0.055s - var(--o)) / var(--m-speed, 1)) }
`;

/**
 * #109 The headline written out a letter at a time, each settling up into place. Arabic and Sorani are written in their
 * joined runs, cut only where the script itself leaves a gap, so no letter is ever drawn in a form it would not have.
 */
export default function LetterByLetter({ params, playing, speed, replay }: MotionProps) {
  return (
    <DomStage key={replay} playing={playing} speed={speed} background={str(params, 'background')} style={cycleOffset(playing, 3)}>
      <MotionStyle id="letter-by-letter" css={CSS} />
      <div style={CENTER}>
        <SplitText text={str(params, 'text')} by="letter" className="bzm-letter" style={{ ...TITLE, ...fontStyle(str(params, 'font')), fontSize: '10cqmin', color: str(params, 'color') }} />
      </div>
    </DomStage>
  );
}
