/**
 * Arabic-script letters (Arabic, Sorani) change shape to join their neighbours, and only text that stays together is
 * shaped: put each letter in a box of its own and every one falls back to its standalone form. A word can still be cut
 * into pieces without harm where its letters do not join anyway, after a letter that never joins the next one.
 */

const ARABIC_SCRIPT = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;

/** Letters that join the letter before them but never the one after (alef, dal, reh, waw and their kin). */
const RIGHT_JOINING = new Set(
  [
    0x0622, 0x0623, 0x0624, 0x0625, 0x0627, 0x0629, 0x062f, 0x0630, 0x0631, 0x0632, 0x0648, 0x0671, 0x0672, 0x0673,
    0x0675, 0x0676, 0x0677, 0x06c0, 0x06cd, 0x06cf, 0x06d2, 0x06d3, 0x06d5, 0x06ee, 0x06ef,
    // ڈ to ڙ (dal and reh with marks, Sorani ڕ and ژ among them) and ۃ to ۋ (Sorani ۆ among them).
    ...Array.from({ length: 0x0699 - 0x0688 + 1 }, (_, i) => 0x0688 + i),
    ...Array.from({ length: 0x06cb - 0x06c3 + 1 }, (_, i) => 0x06c3 + i),
  ].map((code) => String.fromCodePoint(code)),
);

/** Letters that join neither side: hamza. */
const NON_JOINING = new Set(['ء', 'ٴ']);

/** Vowel marks and other signs drawn on a letter: they belong to the letter before them. */
const MARK = /[ؐ-ًؚ-ٰٟۖ-ۜ۟-۪ۨ-ۭ࣓-ࣿ]/;

const ZWNJ = '‌';

/** Whether a text has Arabic-script letters, which must not be split into letters. */
export function hasJoiningScript(text: string): boolean {
  return ARABIC_SCRIPT.test(text);
}

/**
 * The pieces a word may melt or animate in. Latin and other unjoined scripts give one piece per letter; Arabic-script
 * words give runs of letters that join one another, cut only where the script itself leaves a gap, so every piece
 * shapes exactly as it does inside the whole word. The pieces joined again are the word.
 */
export function meltPieces(word: string): string[] {
  const chars = Array.from(word);
  if (!hasJoiningScript(word)) return chars;
  const pieces: string[] = [];
  let current = '';
  const close = () => {
    if (current) pieces.push(current);
    current = '';
  };
  for (const char of chars) {
    if (MARK.test(char) || char === ZWNJ) {
      // A mark rides on its letter; the non-joiner ends the piece it follows.
      if (current) current += char;
      else if (pieces.length > 0) pieces[pieces.length - 1] += char;
      else current = char;
      if (char === ZWNJ) close();
      continue;
    }
    if (NON_JOINING.has(char) || !ARABIC_SCRIPT.test(char)) {
      close();
      pieces.push(char);
      continue;
    }
    current += char;
    if (RIGHT_JOINING.has(char)) close();
  }
  close();
  return pieces;
}
