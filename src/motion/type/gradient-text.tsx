'use client';

import { CENTER, DomStage, MotionStyle } from '../engine/dom';
import { fontStyle } from '../engine/fonts';
import { str, type MotionProps } from '../types';

const CSS = `
@keyframes bzm-gradient-text { from { background-position: 0% 50% } to { background-position: 300% 50% } }
.bzm-gradient-text { -webkit-background-clip: text; background-clip: text; color: transparent; background-size: 300% 100%; animation: bzm-gradient-text calc(6s / var(--m-speed, 1)) linear infinite }
`;

/** #118 A gradient flowing through the letters, its colours sliding along the word in an endless loop. */
export default function GradientText({ params, playing, speed }: MotionProps) {
  const a = str(params, 'color');
  const b = str(params, 'accent');
  return (
    <DomStage playing={playing} speed={speed} background={str(params, 'background')}>
      <MotionStyle id="gradient-text" css={CSS} />
      <div style={CENTER}>
        <span
          dir="auto"
          className="bzm-gradient-text"
          style={{ ...fontStyle(str(params, 'font')), fontSize: '22cqmin', lineHeight: 1.1, whiteSpace: 'nowrap', backgroundImage: `linear-gradient(90deg, ${a}, ${b}, ${a}, ${b}, ${a})`, padding: '0 2cqmin' }}
        >
          {str(params, 'text')}
        </span>
      </div>
    </DomStage>
  );
}
