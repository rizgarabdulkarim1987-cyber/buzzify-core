'use client';

import type { CSSProperties } from 'react';
import { hasJoiningScript, meltPieces } from '@/lib/joining';

/**
 * Text split for animation without breaking a script. Words split on spaces; letters split with `meltPieces`, so an
 * Arabic or Sorani word comes apart only where its letters do not join anyway, and each piece keeps its shapes.
 */
export interface Piece {
  text: string;
  /** Running index among the animated pieces (spaces are not counted). */
  index: number;
  word: number;
  space: boolean;
}

export function splitText(text: string, by: 'word' | 'letter'): Piece[] {
  const out: Piece[] = [];
  let index = 0;
  text
    .trim()
    .split(/(\s+)/)
    .filter((part) => part !== '')
    .forEach((part, w) => {
      if (/^\s+$/.test(part)) {
        out.push({ text: ' ', index: -1, word: w, space: true });
        return;
      }
      const pieces = by === 'word' ? [part] : meltPieces(part);
      for (const piece of pieces) out.push({ text: piece, index: index++, word: w, space: false });
    });
  return out;
}

/** How many animated pieces a split has. */
export const pieceCount = (pieces: readonly Piece[]) => pieces.filter((piece) => !piece.space).length;

/** Whether letter spacing may be animated: never on joined scripts, where it pulls the joins apart. */
export const canTrack = (text: string) => !hasJoiningScript(text);

/**
 * Text split into pieces, each an inline block with `--i` (its index) and `--n` (how many) for CSS to stagger by.
 * Spaces stay real spaces so lines wrap where they should.
 */
export function SplitText({ text, by, className, style, pieceStyle }: { text: string; by: 'word' | 'letter'; className?: string; style?: CSSProperties; pieceStyle?: CSSProperties }) {
  const pieces = splitText(text, by);
  const n = pieceCount(pieces);
  return (
    <span dir="auto" style={{ ...style, ['--n' as string]: String(n) }}>
      {pieces.map((piece, i) =>
        piece.space ? (
          ' '
        ) : (
          <span key={i} className={className} style={{ display: 'inline-block', whiteSpace: 'pre', ...pieceStyle, ['--i' as string]: String(piece.index) }}>
            {piece.text}
          </span>
        ),
      )}
    </span>
  );
}

/**
 * CSS text motions run on keyframes, each piece delayed by its index. While still, they are started `stillAt` seconds
 * into their cycle (a moment when the text is shown), so a paused motion shows its words rather than an empty stage.
 * Use as `animation-delay: calc((var(--i) * 60ms - var(--o)) / var(--m-speed, 1))`.
 */
export function cycleOffset(playing: boolean, stillAt: number): CSSProperties {
  return { ['--o' as string]: playing ? '0s' : `${stillAt}s` };
}

/** The look most text motions share: a centred, balanced block that wraps inside the stage. */
export const TITLE: CSSProperties = { display: 'block', maxWidth: '84cqw', textAlign: 'center', textWrap: 'balance', lineHeight: 1.12 };
