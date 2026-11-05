import { describe, expect, it } from 'vitest';
import { LIVING_TILT_MAX, tiltFor } from '@/ui/product/LivingPhoto';

describe('tiltFor', () => {
  it('rests flat in the middle of the photo', () => {
    expect(tiltFor(0.5, 0.5)).toEqual({ rx: 0, ry: 0 });
  });

  it('leans toward the pointer, the top edge tipping back and the right edge turning right', () => {
    expect(tiltFor(0.5, 0)).toEqual({ rx: LIVING_TILT_MAX, ry: 0 });
    expect(tiltFor(0.5, 1)).toEqual({ rx: -LIVING_TILT_MAX, ry: 0 });
    expect(tiltFor(1, 0.5)).toEqual({ rx: 0, ry: LIVING_TILT_MAX });
    expect(tiltFor(0, 0.5)).toEqual({ rx: 0, ry: -LIVING_TILT_MAX });
  });

  it('never leans past the limit, even for a pointer outside the photo', () => {
    expect(tiltFor(9, -9)).toEqual({ rx: LIVING_TILT_MAX, ry: LIVING_TILT_MAX });
    expect(tiltFor(-9, 9)).toEqual({ rx: -LIVING_TILT_MAX, ry: -LIVING_TILT_MAX });
  });
});
