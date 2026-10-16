/**
 * The split-flap rail's board: when a category becomes active, each letter of its name spins through a few
 * random letters before landing, like a station departures board. Names in joined scripts (Arabic, Kurdish)
 * keep their letters together and flip as a whole word.
 */

const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const FLIP: Keyframe[] = [{ transform: 'rotateX(0deg)' }, { transform: 'rotateX(-85deg)' }, { transform: 'rotateX(0deg)' }];
const LETTER_STAGGER_MS = 40;
const GLYPH_MS = 62;

/** The glyphs a cell shows on its way to `char`: a few random letters of the same case, then `char`. */
export function flapSequence(char: string, random: () => number): string[] {
  const isLetter = char.toLowerCase() !== char.toUpperCase();
  if (!isLetter) return [char];
  const pool = char === char.toLowerCase() ? LOWER : UPPER;
  const steps = 3 + Math.floor(random() * 5);
  return [...Array.from({ length: steps }, () => pool[Math.floor(random() * pool.length)]!), char];
}

/**
 * Plays the board on a link's `[data-flap]` cells and returns a function that stops it and puts every cell
 * back to its real text. Cells change their own text node in place, so React's copy of the text stays valid.
 */
export function flipBoard(link: HTMLElement): () => void {
  const timers: number[] = [];
  const cells = [...link.querySelectorAll<HTMLElement>('[data-flap]')];
  const textOf = (cell: HTMLElement) => (cell.firstChild instanceof Text ? cell.firstChild : null);
  cells.forEach((cell, index) => {
    const text = textOf(cell);
    const final = cell.dataset.flap ?? '';
    const glyphs = cell.dataset.word === undefined ? flapSequence(final, Math.random) : [final, final];
    glyphs.forEach((glyph, step) => {
      timers.push(
        window.setTimeout(() => {
          if (text) text.nodeValue = glyph;
          cell.animate?.(FLIP, { duration: cell.dataset.word === undefined ? 110 : 260, easing: 'ease-out' });
        }, index * LETTER_STAGGER_MS + step * GLYPH_MS),
      );
    });
  });
  return () => {
    timers.forEach((timer) => window.clearTimeout(timer));
    cells.forEach((cell) => {
      const text = textOf(cell);
      if (text) text.nodeValue = cell.dataset.flap ?? '';
    });
  };
}
