import { describe, expect, it } from 'vitest';
import { fitStage, type StageFit } from '@/ui/explore/framing';

const phone = { width: 390, height: 844 };
const laptop = { width: 760, height: 600 };

function fit(screen: { width: number; height: number }, dish: number, band = { top: 130, bottom: screen.height - 250 }): StageFit {
  return fitStage({ ...screen, fov: 32, dish, plinth: 1.5, band, minDistance: 7.4, maxDistance: 17 });
}

describe('fitStage', () => {
  it('keeps a tall dish below the header and its plinth above the text panel', () => {
    for (const screen of [phone, laptop]) {
      const band = { top: 130, bottom: screen.height - 220 };
      const result = fit(screen, 2.2, band);
      expect(result.top, `${screen.width}`).toBeGreaterThanOrEqual(band.top - 0.5);
      expect(result.bottom, `${screen.width}`).toBeLessThanOrEqual(band.bottom + 0.5);
    }
  });

  it('centres the dish in the space between them', () => {
    const band = { top: 130, bottom: 320 };
    const result = fit(laptop, 1.8, band);
    expect((result.top + result.bottom) / 2).toBeCloseTo((band.top + band.bottom) / 2, 0);
  });

  it('steps back for a taller dish, and not at all for one that already fits', () => {
    const roomy = { top: 60, bottom: 800 };
    expect(fit(phone, 1.6, roomy).distance).toBe(7.4);
    expect(fit(laptop, 2.2).distance).toBeGreaterThan(fit(laptop, 1.6).distance);
  });

  it('never steps back further than the far limit', () => {
    expect(fit(laptop, 40, { top: 130, bottom: 140 }).distance).toBe(17);
  });
});
