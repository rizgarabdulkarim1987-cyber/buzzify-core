import { describe, expect, it } from 'vitest';
import { hasJoiningScript, meltPieces } from '@/lib/joining';

describe('meltPieces', () => {
  it('splits Latin words into letters', () => {
    expect(meltPieces('Small')).toEqual(['S', 'm', 'a', 'l', 'l']);
  });

  it('keeps Arabic-script letters that join together, and splits only where the script does not join', () => {
    // Sorani "small": ب and چ join on to و; the next و and ک stand apart, as they do in the word itself.
    expect(meltPieces('بچووک')).toEqual(['بچو', 'و', 'ک']);
    // Arabic "small": every letter joins the next until the final ر.
    expect(meltPieces('صغير')).toEqual(['صغير']);
    // إ and ا never join the letter after them.
    expect(meltPieces('إضافي')).toEqual(['إ', 'ضا', 'في']);
    // Sorani letters of their own: ڕ, ۆ and ە join only the letter before them.
    expect(meltPieces('گۆشت')).toEqual(['گۆ', 'شت']);
    expect(meltPieces('مریشک')).toEqual(['مر', 'یشک']);
    expect(meltPieces('زیادە')).toEqual(['ز', 'یا', 'د', 'ە']);
  });

  it('keeps vowel marks on their letter, lets hamza stand alone and ends a piece at the non-joiner', () => {
    expect(meltPieces('مُحَمَّد')).toEqual(['مُحَمَّد']);
    expect(meltPieces('ماء')).toEqual(['ما', 'ء']);
    expect(meltPieces('می‌خوام')).toEqual(['می‌', 'خو', 'ا', 'م']);
  });

  it('puts the pieces back together as the word', () => {
    for (const word of ['بچووک', 'إضافي', 'مُحَمَّد', 'Doritos', 'زیادە']) expect(meltPieces(word).join('')).toBe(word);
  });
});

describe('hasJoiningScript', () => {
  it('knows Arabic and Sorani text from Latin', () => {
    expect(hasJoiningScript('زاميتوس دجاج')).toBe(true);
    expect(hasJoiningScript('ژامیتۆس مریشک')).toBe(true);
    expect(hasJoiningScript('Zhamitos Chicken')).toBe(false);
  });
});
