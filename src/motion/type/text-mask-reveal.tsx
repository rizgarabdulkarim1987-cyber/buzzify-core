'use client';

import { CENTER, DomStage, MotionStyle } from '../engine/dom';
import { fontStyle } from '../engine/fonts';
import { cycleOffset } from '../engine/text';
import { str, type MotionProps } from '../types';

const CSS = `
@keyframes bzm-mask-flow { from { background-position: 0% 50% } to { background-position: 200% 50% } }
@keyframes bzm-mask-wipe { 0% { clip-path: inset(0 100% 0 0) } 25% { clip-path: inset(0 0 0 0) } 80% { clip-path: inset(0 0 0 0) } 95% { clip-path: inset(0 0 0 100%) } 100% { clip-path: inset(0 0 0 100%) } }
.bzm-mask-word { -webkit-background-clip: text; background-clip: text; color: transparent; background-size: 200% 100%;
  animation: bzm-mask-flow calc(3s / var(--m-speed, 1)) linear infinite, bzm-mask-wipe calc(5s / var(--m-speed, 1)) cubic-bezier(.65, 0, .35, 1) infinite both;
  animation-delay: 0s, calc(var(--o) * -1 / var(--m-speed, 1)) }
[dir=rtl] .bzm-mask-word { animation-name: bzm-mask-flow, bzm-mask-wipe-rtl }
@keyframes bzm-mask-wipe-rtl { 0% { clip-path: inset(0 0 0 100%) } 25% { clip-path: inset(0 0 0 0) } 80% { clip-path: inset(0 0 0 0) } 95% { clip-path: inset(0 100% 0 0) } 100% { clip-path: inset(0 100% 0 0) } }
`;

/**
 * #111 A word used as a window: moving stripes of colour flow through the letters and nowhere else, and the word is
 * wiped on from its first letter and off past its last, in the reading direction.
 */
export default function TextMaskReveal({ params, playing, speed, replay }: MotionProps) {
  const a = str(params, 'color');
  const b = str(params, 'accent');
  return (
    <DomStage key={replay} playing={playing} speed={speed} background={str(params, 'background')} style={cycleOffset(playing, 2.2)}>
      <MotionStyle id="text-mask-reveal" css={CSS} />
      <div style={CENTER}>
        <span
          dir="auto"
          className="bzm-mask-word"
          style={{
            ...fontStyle(str(params, 'font')),
            fontSize: '24cqmin',
            lineHeight: 1.05,
            whiteSpace: 'nowrap',
            maxWidth: '92cqw',
            backgroundImage: `repeating-linear-gradient(115deg, ${a} 0 4cqmin, ${b} 4cqmin 8cqmin, ${a} 8cqmin 12cqmin)`,
          }}
        >
          {str(params, 'text')}
        </span>
      </div>
    </DomStage>
  );
}
