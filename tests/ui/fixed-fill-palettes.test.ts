import { describe, expect, it } from 'vitest';
import { TEMPLATES } from '@/lib/templates';
import { contrastRatio as contrast } from '@/lib/palette';

/** Whether a colour is dark: white reads better on it than black. */
const dark = (hex: string) => contrast(hex, '#ffffff') > contrast(hex, '#000000');

/**
 * The fixed-fill shapes draw their body in their own colours, so an alternative palette only changes the page around
 * it (the header, the hero) and the accent. An alternative on the other side of light and dark would put a white header
 * over a black body (or a navy one over bright sand), so each stays on its signature's side.
 */
describe('the fixed-fill shapes keep their alternatives on the side of their body', () => {
  for (const id of ['the-space-station', 'the-frosted-window', 'the-summer-beach', 'the-3d-printer'] as const) {
    it(id, () => {
      const [signature, ...alternatives] = TEMPLATES[id].palettes;
      expect(alternatives.length).toBeGreaterThanOrEqual(3);
      for (const palette of alternatives) expect(dark(palette.palette.bg), palette.id).toBe(dark(signature!.palette.bg));
    });
  }

  it('names the printer alternatives by what changes: the rail', () => {
    for (const palette of TEMPLATES['the-3d-printer'].palettes.slice(1)) expect(palette.name, palette.id).toMatch(/rail$/i);
  });
});
