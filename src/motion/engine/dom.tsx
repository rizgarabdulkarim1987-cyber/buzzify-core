'use client';

import type { CSSProperties, HTMLAttributes, ReactNode, Ref } from 'react';

/**
 * The box every DOM motion draws in: it fills the motion's host, clips what leaves it, and is a size container, so a
 * motion measures itself in `cqw`, `cqh` and `cqmin` and looks the same in a gallery card and on a full stage.
 * `--m-speed` scales CSS durations (`calc(2s / var(--m-speed))`); a still motion pauses its CSS animations.
 */
const BASE_CSS = `
[data-bzm]{position:absolute;inset:0;overflow:hidden;container-type:size;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent}
[data-bzm] *,[data-bzm] *::before,[data-bzm] *::after{box-sizing:border-box}
[data-bzm][data-still] *,[data-bzm][data-still] *::before,[data-bzm][data-still] *::after{animation-play-state:paused!important}
[data-bzm]{--bzm-start:left}
[dir=rtl] [data-bzm]{--bzm-start:right}
`;

/** A motion's own CSS, added to the document once however many copies of the motion are on the page (React 19). */
export function MotionStyle({ id, css }: { id: string; css: string }) {
  return (
    <style href={`bzm-${id}`} precedence="motion">
      {css}
    </style>
  );
}

export interface DomStageProps extends Omit<HTMLAttributes<HTMLDivElement>, 'style'> {
  playing: boolean;
  speed: number;
  background?: string;
  color?: string;
  style?: CSSProperties;
  ref?: Ref<HTMLDivElement>;
  children?: ReactNode;
}

export function DomStage({ playing, speed, background, color, style, ref, children, ...rest }: DomStageProps) {
  return (
    <div
      ref={ref}
      data-bzm=""
      data-still={playing ? undefined : ''}
      {...rest}
      style={{ background, color, ['--m-speed' as string]: String(speed), ...style }}
    >
      <MotionStyle id="base" css={BASE_CSS} />
      {children}
    </div>
  );
}

/** Centred column filling the stage: the frame most text motions sit in. */
export const CENTER: CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexDirection: 'column',
  textAlign: 'center',
};
