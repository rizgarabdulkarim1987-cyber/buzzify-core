'use client';

import { CENTER, DomStage, MotionStyle } from '../engine/dom';
import { fontStyle } from '../engine/fonts';
import { metal } from '../engine/metal';
import { canTrack, cycleOffset } from '../engine/text';
import { str, type MotionProps } from '../types';

const CSS = `
@keyframes bzm-metal-rise { 0% { clip-path: inset(100% 0 0 0); transform: translateY(0.12em) } 26% { clip-path: inset(0 0 0 0); transform: translateY(0) } 82% { clip-path: inset(0 0 0 0); opacity: 1 } 96% { opacity: 0 } 100% { opacity: 0; clip-path: inset(0 0 0 0) } }
@keyframes bzm-metal-shine { 0%, 28% { background-position: 160% 0 } 58%, 100% { background-position: -60% 0 } }
.bzm-metal { -webkit-background-clip: text; background-clip: text; color: transparent;
  animation: bzm-metal-rise calc(5s / var(--m-speed, 1)) cubic-bezier(.23, 1, .32, 1) infinite both;
  animation-delay: calc(var(--o) * -1 / var(--m-speed, 1)) }
.bzm-metal-shine { position: absolute; inset: 0; -webkit-background-clip: text; background-clip: text; color: transparent; background-size: 250% 100%;
  animation: bzm-metal-shine calc(5s / var(--m-speed, 1)) ease-in-out infinite both, bzm-metal-rise calc(5s / var(--m-speed, 1)) cubic-bezier(.23, 1, .32, 1) infinite both;
  animation-delay: calc(var(--o) * -1 / var(--m-speed, 1)) }
`;

/**
 * #117 Letters of polished metal rising out of the dark: the word lifts into view from its baseline, a bright reflection
 * runs along it from end to end, and it fades for the next pass.
 */
export default function MetallicTextReveal({ params, playing, speed, replay }: MotionProps) {
  const [shadow, body, highlight, edge] = metal(str(params, 'metal'));
  const text = str(params, 'text');
  const look = { ...fontStyle(str(params, 'font')), fontSize: '17cqmin', lineHeight: 1.1, whiteSpace: 'nowrap' as const, letterSpacing: canTrack(text) ? '0.04em' : 0 };
  return (
    <DomStage key={replay} playing={playing} speed={speed} background={str(params, 'background')} style={cycleOffset(playing, 1.8)}>
      <MotionStyle id="metallic-text-reveal" css={CSS} />
      <div style={CENTER}>
        <span style={{ position: 'relative', display: 'inline-block' }}>
          <span dir="auto" className="bzm-metal" style={{ ...look, display: 'block', backgroundImage: `linear-gradient(180deg, ${highlight} 0%, ${body} 38%, ${shadow} 52%, ${edge} 70%, ${highlight} 100%)` }}>
            {text}
          </span>
          <span dir="auto" aria-hidden className="bzm-metal-shine" style={{ ...look, backgroundImage: 'linear-gradient(105deg, transparent 40%, rgb(255 255 255 / 0.95) 50%, transparent 60%)' }}>
            {text}
          </span>
        </span>
      </div>
    </DomStage>
  );
}
