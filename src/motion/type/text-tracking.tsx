'use client';

import { CENTER, DomStage, MotionStyle } from '../engine/dom';
import { fontStyle } from '../engine/fonts';
import { canTrack, cycleOffset } from '../engine/text';
import { str, type MotionProps } from '../types';

const CSS = `
@keyframes bzm-track { 0% { letter-spacing: 0.8em; opacity: 0; filter: blur(0.5cqmin) } 40% { letter-spacing: 0.04em; opacity: 1; filter: blur(0) } 80% { letter-spacing: 0.04em; opacity: 1 } 100% { letter-spacing: 0.04em; opacity: 0 } }
@keyframes bzm-track-words { 0% { word-spacing: 1.2em; opacity: 0; filter: blur(0.5cqmin) } 40% { word-spacing: 0.1em; opacity: 1; filter: blur(0) } 80% { word-spacing: 0.1em; opacity: 1 } 100% { word-spacing: 0.1em; opacity: 0 } }
.bzm-track { animation: bzm-track calc(4.4s / var(--m-speed, 1)) cubic-bezier(.23, 1, .32, 1) infinite both; animation-delay: calc(var(--o) * -1 / var(--m-speed, 1)) }
.bzm-track-words { animation: bzm-track-words calc(4.4s / var(--m-speed, 1)) cubic-bezier(.23, 1, .32, 1) infinite both; animation-delay: calc(var(--o) * -1 / var(--m-speed, 1)) }
`;

/**
 * #112 The brand's name closing in from wide to tight, as a title card does: its letters arrive far apart and soft and
 * draw together into focus. Joined scripts close their word spacing instead, since spacing letters breaks their joins.
 */
export default function TextTracking({ params, playing, speed, replay }: MotionProps) {
  const text = str(params, 'text');
  return (
    <DomStage key={replay} playing={playing} speed={speed} background={str(params, 'background')} style={cycleOffset(playing, 2.4)}>
      <MotionStyle id="text-tracking" css={CSS} />
      <div style={CENTER}>
        <span dir="auto" className={canTrack(text) ? 'bzm-track' : 'bzm-track-words'} style={{ ...fontStyle(str(params, 'font')), fontSize: '12cqmin', color: str(params, 'color'), whiteSpace: 'nowrap', textTransform: canTrack(text) ? 'uppercase' : 'none' }}>
          {text}
        </span>
      </div>
    </DomStage>
  );
}
