import { describe, expect, it } from 'vitest';
import { SCENE_SPACING, nearestScene, sceneState } from '@/ui/explore/choreography';

describe('sceneState', () => {
  it('puts the focused scene at the centre, full size and fully visible', () => {
    const s = sceneState(2, 2);
    expect(s.x).toBeCloseTo(0, 9);
    expect(s.scale).toBeCloseTo(1, 9);
    expect(s.focus).toBeCloseTo(1, 9);
    expect(s.opacity).toBeCloseTo(1, 9);
    expect(s.fan).toBeCloseTo(0, 9);
    expect(s.visible).toBe(true);
  });

  it('slides scenes sideways in proportion to their distance, mirrored either side', () => {
    const right = sceneState(3, 2);
    const left = sceneState(1, 2);
    expect(right.x).toBeCloseTo(SCENE_SPACING, 9);
    expect(left.x).toBeCloseTo(-SCENE_SPACING, 9);
    expect(left.rotationY).toBeCloseTo(-right.rotationY, 9);
  });

  it('shrinks, fades and fans layers as a scene leaves the centre', () => {
    let lastScale = Infinity;
    let lastOpacity = Infinity;
    let lastFan = -Infinity;
    for (let d = 0; d <= 0.7; d += 0.05) {
      const s = sceneState(0, -d);
      expect(s.scale).toBeLessThanOrEqual(lastScale + 1e-9);
      expect(s.opacity).toBeLessThanOrEqual(lastOpacity + 1e-9);
      expect(s.fan).toBeGreaterThanOrEqual(lastFan - 1e-9);
      lastScale = s.scale;
      lastOpacity = s.opacity;
      lastFan = s.fan;
    }
  });

  it('hides the text of scenes that are not in focus and culls far scenes', () => {
    expect(sceneState(0, 1).opacity).toBe(0);
    expect(sceneState(0, 0.6).opacity).toBe(0);
    expect(sceneState(0, 3).visible).toBe(false);
    expect(sceneState(0, 1.2).visible).toBe(true);
  });

  it('is continuous: a tiny move in progress is a tiny move in every value', () => {
    for (let p = -1; p <= 3; p += 0.37) {
      const a = sceneState(1, p);
      const b = sceneState(1, p + 1e-4);
      expect(Math.abs(a.x - b.x)).toBeLessThan(1e-2);
      expect(Math.abs(a.scale - b.scale)).toBeLessThan(1e-2);
      expect(Math.abs(a.opacity - b.opacity)).toBeLessThan(1e-2);
    }
  });
});

describe('nearestScene', () => {
  it('rounds to the closest scene and stays within range', () => {
    expect(nearestScene(0.4, 5)).toBe(0);
    expect(nearestScene(0.6, 5)).toBe(1);
    expect(nearestScene(-3, 5)).toBe(0);
    expect(nearestScene(9, 5)).toBe(4);
    expect(nearestScene(2, 0)).toBe(0);
  });
});
