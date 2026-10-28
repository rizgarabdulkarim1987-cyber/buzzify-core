import { describe, expect, it } from 'vitest';
import { DRIFT_MOTIFS, leadsWithCloth, swayClock } from '@/ui/template/bodies/DriftBody';
import { DABKA_BEAT, beatPace, driftDirection, driftStart, driftStep, fromScrollLeft, toScrollLeft } from '@/ui/template/bodies/drift-motion';

describe('the drift family', () => {
  it('has the six looks of batch 13', () => {
    expect(DRIFT_MOTIFS).toEqual(['space-drift', 'sadu', 'halay', 'dabka', 'faqi', 'ahwar']);
  });

  it('turns neighbouring sections in opposite directions, by their place in the full menu', () => {
    expect([0, 1, 2, 3].map(driftDirection)).toEqual([1, -1, 1, -1]);
  });

  it('starts a forward row at its first dish and a backward row at its end', () => {
    expect(driftStart(1, 300)).toBe(0);
    expect(driftStart(-1, 300)).toBe(300);
    expect(driftStart(-1, 0)).toBe(0);
  });

  it('moves a row and turns it back at either end without jumping', () => {
    expect(driftStep(10, 1, 5, 100)).toEqual({ at: 15, direction: 1 });
    expect(driftStep(98, 1, 5, 100)).toEqual({ at: 97, direction: -1 });
    expect(driftStep(2, -1, 5, 100)).toEqual({ at: 3, direction: 1 });
    expect(driftStep(50, -1, 5, 100)).toEqual({ at: 45, direction: -1 });
  });

  it('keeps a row that fits at its start', () => {
    expect(driftStep(40, 1, 5, 0)).toEqual({ at: 0, direction: 1 });
  });

  it('takes a position past the end (a row that shrank) back inside it', () => {
    expect(driftStep(500, 1, 5, 100).at).toBeLessThanOrEqual(100);
  });

  it('steps the dabka on its beat: moving early in each beat, standing after, the same ground on average', () => {
    expect(beatPace(0.6 * DABKA_BEAT)).toBe(0);
    expect(beatPace(0.2 * DABKA_BEAT)).toBeGreaterThan(1);
    const samples = 2000;
    let sum = 0;
    for (let i = 0; i < samples; i++) sum += beatPace((i / samples) * DABKA_BEAT);
    expect(sum / samples).toBeCloseTo(1, 2);
  });

  it('maps a logical position to scrollLeft both ways, negative in RTL', () => {
    expect(toScrollLeft(40, false)).toBe(40);
    expect(toScrollLeft(40, true)).toBe(-40);
    expect(fromScrollLeft(-40, true)).toBe(40);
    expect(fromScrollLeft(40, false)).toBe(40);
  });

  it('leads only the halay and the dabka with a red cloth', () => {
    expect(DRIFT_MOTIFS.filter(leadsWithCloth)).toEqual(['halay', 'dabka']);
  });

  it('gives each dish its own steady sway clock', () => {
    expect(swayClock(3)).toEqual(swayClock(3));
    const clocks = [0, 1, 2, 3, 4, 5].map((at) => swayClock(at).period);
    expect(new Set(clocks).size).toBeGreaterThan(3);
    for (const period of clocks) expect(period).toBeGreaterThanOrEqual(5);
    for (const period of clocks) expect(period).toBeLessThanOrEqual(8);
  });
});
