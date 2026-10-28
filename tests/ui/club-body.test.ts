import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ARM_PLAY,
  ARM_REST,
  boxBuzzes,
  buzzClock,
  DECK_TURN,
  deckLetter,
  deckPhase,
  holoRarity,
  holoTilt,
  HOLO_LEAN,
  needleAt,
  NEON_TUBES,
  neonTube,
  signFlickers,
} from '@/ui/template/bodies/club-deck';

const css = (file: string) => readFileSync(join(process.cwd(), 'src/ui/template/bodies', file), 'utf8');

describe('the club family (The DJ Decks, Neon Alley, Holo Cards)', () => {
  it('names the sides of the record A to Z, then AA, AB...', () => {
    expect([0, 1, 25, 26, 27, 51, 52].map(deckLetter)).toEqual(['A', 'B', 'Z', 'AA', 'AB', 'AZ', 'BA']);
    expect(deckLetter(-3)).toBe('A');
  });

  it('starts every record somewhere within one turn, the same each time', () => {
    for (let seed = 0; seed < 50; seed++) {
      const phase = deckPhase(seed);
      expect(phase).toBeLessThanOrEqual(0);
      expect(phase).toBeGreaterThan(-DECK_TURN);
      expect(deckPhase(seed)).toBe(phase);
    }
    expect(new Set([0, 1, 2, 3].map(deckPhase)).size).toBe(4);
    expect(css('dj.css')).toContain(`club-dj-spin ${DECK_TURN}s`);
  });

  it('puts the needle on the outer grooves when playing and beside the platter when resting', () => {
    // dj.css: the platter is 70cqi square at the start (centre 35, 35; radius 35), the label 64% of it inside 4% of rim.
    const centre = 35;
    const record = 35 * 0.92;
    const label = record * 0.64;
    const play = needleAt(ARM_PLAY);
    const off = Math.hypot(play.x - centre, play.y - centre);
    expect(off).toBeGreaterThan(label + 2);
    expect(off).toBeLessThan(record);
    const rest = needleAt(ARM_REST);
    expect(rest.x).toBeGreaterThan(70);
    expect(rest.y).toBeLessThan(70 - 26); // above the 2.5rem start button at the column's foot (26cqi on a phone's deck)
    expect(css('dj.css')).toMatch(/--dj-arm: 50;/);
    expect(css('dj.css')).toMatch(/--dj-arm: 6;/);
  });

  it('gives every section a neon tube, repeating, and flickers every other sign', () => {
    expect(NEON_TUBES.map((_, at) => neonTube(at))).toEqual([...NEON_TUBES]);
    expect(neonTube(NEON_TUBES.length)).toBe(NEON_TUBES[0]);
    expect(neonTube(-1)).toBe(NEON_TUBES.at(-1));
    expect([0, 1, 2, 3].map(signFlickers)).toEqual([false, true, false, true]);
  });

  it('buzzes about one lightbox in five, never two neighbours, each on its own clock', () => {
    let buzzing = 0;
    for (let place = 0; place < 20; place++) {
      for (let at = 0; at < 20; at++) {
        if (!boxBuzzes(place, at)) continue;
        buzzing++;
        expect(boxBuzzes(place, at + 1)).toBe(false);
        const clock = buzzClock(place, at);
        expect(clock.time).toBeGreaterThanOrEqual(5);
        expect(clock.time).toBeLessThanOrEqual(9);
        expect(clock.delay).toBeLessThanOrEqual(0);
      }
    }
    expect(buzzing).toBeGreaterThan(30);
    expect(buzzing).toBeLessThan(110);
  });

  it('ranks a card by what the house and its guests say about the dish', () => {
    expect(holoRarity({ isSignature: true })).toBe('legend');
    expect(holoRarity({ mostOrdered: true, percentOff: 20, regularPrice: 10 })).toBe('legend');
    expect(holoRarity({ percentOff: 20, regularPrice: 10 })).toBe('rare');
    expect(holoRarity({ featured: true })).toBe('rare');
    expect(holoRarity({ percentOff: 20 })).toBe('common');
    expect(holoRarity({})).toBe('common');
  });

  it('leans a holo card towards the pointer, flat in the middle, never past its lean', () => {
    expect(holoTilt(0.5, 0.5)).toEqual({ rx: 0, ry: 0, mx: 50, my: 50, fx: 0, fy: 0 });
    expect(holoTilt(1, 0)).toEqual({ rx: HOLO_LEAN, ry: HOLO_LEAN, mx: 100, my: 0, fx: 1, fy: -1 });
    expect(holoTilt(0, 1)).toEqual({ rx: -HOLO_LEAN, ry: -HOLO_LEAN, mx: 0, my: 100, fx: -1, fy: 1 });
    expect(holoTilt(3, -2)).toEqual(holoTilt(1, 0));
    expect(holoTilt(Number.NaN, Number.NaN)).toEqual(holoTilt(0.5, 0.5));
  });

  it('never splits a name mid-word and writes no font under 12px', () => {
    for (const file of ['club.css', 'dj.css', 'neon.css', 'holo.css']) {
      const sheet = css(file);
      expect(sheet, file).not.toMatch(/overflow-wrap:\s*anywhere/);
      expect(sheet, file).not.toMatch(/word-break:\s*break-all/);
      for (const match of sheet.matchAll(/font-size:\s*([\d.]+)(rem|px)\b/g)) {
        const px = match[2] === 'rem' ? Number(match[1]) * 16 : Number(match[1]);
        expect(px, `${file}: ${match[0]}`).toBeGreaterThanOrEqual(12);
      }
    }
  });
});
