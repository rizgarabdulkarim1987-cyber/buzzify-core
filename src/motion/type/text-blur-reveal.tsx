'use client';

import { CENTER, DomStage, MotionStyle } from '../engine/dom';
import { fontStyle } from '../engine/fonts';
import { cycleOffset, SplitText, TITLE } from '../engine/text';
import { str, type MotionProps } from '../types';

const CSS = `
@keyframes bzm-blur-in { 0% { opacity: 0; filter: blur(1.6cqmin); transform: scale(1.08) } 22% { opacity: 1; filter: blur(0); transform: scale(1) } 78% { opacity: 1; filter: blur(0) } 92% { opacity: 0; filter: blur(1cqmin) } 100% { opacity: 0 } }
.bzm-blur-in { animation: bzm-blur-in calc(4.8s / var(--m-speed, 1)) cubic-bezier(.23, 1, .32, 1) infinite both; animation-delay: calc((var(--i) * 0.12s - var(--o)) / var(--m-speed, 1)) }
`;

/** #113 Words coming into focus one after another, as a lens finds them, then blurring away together. */
export default function TextBlurReveal({ params, playing, speed, replay }: MotionProps) {
  return (
    <DomStage key={replay} playing={playing} speed={speed} background={str(params, 'background')} style={cycleOffset(playing, 2)}>
      <MotionStyle id="text-blur-reveal" css={CSS} />
      <div style={CENTER}>
        <SplitText text={str(params, 'text')} by="word" className="bzm-blur-in" style={{ ...TITLE, ...fontStyle(str(params, 'font')), fontSize: '11cqmin', color: str(params, 'color') }} />
      </div>
    </DomStage>
  );
}
