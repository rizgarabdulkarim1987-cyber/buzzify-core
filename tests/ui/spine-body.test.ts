import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TEMPLATES } from '@/lib/templates';
import { cometOffset, countdownSteps, newrozSparks, SPINE_MOTIFS, spineNoise, spineSide, torchSway } from '@/ui/template/bodies/SpineBody';

describe('the spine body (The Prayer Beads)', () => {
  it('puts the dishes on alternate sides of the thread, the first at the start', () => {
    expect([0, 1, 2, 3].map(spineSide)).toEqual(['start', 'end', 'start', 'end']);
  });

  it('is The Prayer Beads preset, number 66, on the spine body', () => {
    const preset = TEMPLATES['the-prayer-beads'];
    expect(preset.number).toBe(66);
    expect(preset.layout.body).toBe('spine');
  });
});

describe('the spine family', () => {
  it('has the prayer beads first and six more motifs, each its own kind', () => {
    expect(SPINE_MOTIFS).toEqual(['spine', 'space-count', 'newroz', 'klash', 'dengbej', 'space-comet', 'manus']);
  });

  it('counts the countdown down across every section shown, ending at T-01', () => {
    expect(countdownSteps([3, 2])).toEqual([
      [5, 4, 3],
      [2, 1],
    ]);
    expect(countdownSteps([0, 1])).toEqual([[], [1]]);
    expect(countdownSteps([])).toEqual([]);
  });

  it('staggers the meteors in a ragged diagonal that repeats', () => {
    expect([0, 1, 2, 3, 4, 5].map(cometOffset)).toEqual([8, 22, 12, 24, 10, 20]);
    expect(cometOffset(6)).toBe(8);
    expect(cometOffset(-1)).toBe(20);
  });

  it('gives every fire steady sparks and every torch its own sway', () => {
    const sparks = newrozSparks(10, 3);
    expect(sparks).toHaveLength(10);
    expect(newrozSparks(10, 3)).toEqual(sparks);
    for (const spark of sparks) {
      expect(spark.time).toBeGreaterThanOrEqual(1.6);
      expect(spark.time).toBeLessThanOrEqual(3);
      expect(spark.delay).toBeLessThanOrEqual(0);
      expect(Math.abs(spark.drift)).toBeLessThanOrEqual(35);
    }
    const sway = torchSway(4);
    expect(sway.time).toBeGreaterThanOrEqual(4);
    expect(sway.time).toBeLessThanOrEqual(6.5);
    expect(torchSway(5)).not.toEqual(sway);
    for (const seed of [0, 1, 2, 99]) expect(spineNoise(seed)).toBeGreaterThanOrEqual(0);
  });

  it('scopes each motif sheet under its own kind', () => {
    const dir = join(process.cwd(), 'src/ui/template/bodies');
    for (const motif of SPINE_MOTIFS.filter((kind) => kind !== 'spine')) {
      const css = readFileSync(join(dir, `${motif}.css`), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      for (const [, selectors] of css.matchAll(/([^{}]+)\{/g)) {
        const rule = selectors!.trim();
        if (/^(from|to|\d+%)/.test(rule) || rule.startsWith('@')) continue;
        for (const selector of rule.split(/,(?![^(]*\))/)) expect(selector.trim(), `${motif}.css`).toMatch(new RegExp(`^\\[data-body='${motif}'\\]`));
      }
    }
  });
});
