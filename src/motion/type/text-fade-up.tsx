'use client';

import { mix } from '../engine/color';
import { CENTER, DomStage, MotionStyle } from '../engine/dom';
import { fontStyle } from '../engine/fonts';
import { cycleOffset, SplitText, TITLE } from '../engine/text';
import { str, type MotionProps } from '../types';

const CSS = `
@keyframes bzm-fade-up { 0% { opacity: 0; transform: translateY(0.6em) } 20% { opacity: 1; transform: translateY(0) } 80% { opacity: 1; transform: translateY(0) } 94% { opacity: 0; transform: translateY(-0.2em) } 100% { opacity: 0 } }
.bzm-fade-up { animation: bzm-fade-up calc(4.6s / var(--m-speed, 1)) cubic-bezier(.23, 1, .32, 1) infinite both; animation-delay: calc((var(--i) * 0.08s - var(--o)) / var(--m-speed, 1)) }
`;

/**
 * #114 The quiet entrance of a menu page: the headline's words fade up into place in turn, a small rule and a line of
 * smaller text following after them.
 */
export default function TextFadeUp({ params, playing, speed, replay }: MotionProps) {
  const colour = str(params, 'color');
  const background = str(params, 'background');
  const text = str(params, 'text');
  const count = text.trim().split(/\s+/).length;
  return (
    <DomStage key={replay} playing={playing} speed={speed} background={background} style={cycleOffset(playing, 2)}>
      <MotionStyle id="text-fade-up" css={CSS} />
      <div style={{ ...CENTER, gap: '4cqmin' }}>
        <SplitText text={text} by="word" className="bzm-fade-up" style={{ ...TITLE, ...fontStyle(str(params, 'font')), fontSize: '10cqmin', color: colour }} />
        <span className="bzm-fade-up" style={{ ['--i' as string]: String(count + 1), display: 'block', width: '12cqw', height: '0.5cqmin', borderRadius: 999, background: mix(colour, background, 0.4) }} />
        <span className="bzm-fade-up" style={{ ['--i' as string]: String(count + 2), display: 'block', width: '40cqw', height: '1.6cqmin', borderRadius: 999, background: mix(colour, background, 0.7) }} />
      </div>
    </DomStage>
  );
}
