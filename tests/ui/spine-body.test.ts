import { describe, expect, it } from 'vitest';
import { TEMPLATES } from '@/lib/templates';
import { spineSide } from '@/ui/template/bodies/SpineBody';

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
