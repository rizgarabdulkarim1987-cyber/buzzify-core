import { describe, expect, it } from 'vitest';
import {
  advanceTurn,
  beginDrag,
  createActivity,
  createControls,
  dragBy,
  endDrag,
  markBusy,
  needsFullRate,
  nudge,
  resetTurn,
  swayYaw,
} from '@/ui/stage/controls';

describe('turning', () => {
  it('follows a drag and keeps coasting after release, then settles', () => {
    const controls = createControls();
    beginDrag(controls);
    dragBy(controls, 100, 0.1);
    expect(controls.yaw).toBeGreaterThan(0);
    endDrag(controls);
    const released = controls.yaw;
    for (let i = 0; i < 20; i++) advanceTurn(controls, 1 / 60, false);
    expect(controls.yaw).toBeGreaterThan(released);
    for (let i = 0; i < 600; i++) advanceTurn(controls, 1 / 60, false);
    expect(Math.abs(controls.velocity)).toBeLessThan(0.01);
  });

  it('turns slowly on its own only when asked to and only after being left alone', () => {
    const controls = createControls();
    controls.lastTouch = performance.now() / 1000 - 10;
    const before = controls.yaw;
    advanceTurn(controls, 1, true);
    expect(controls.yaw).toBeGreaterThan(before);

    const still = createControls();
    still.lastTouch = performance.now() / 1000 - 10;
    advanceTurn(still, 1, false);
    expect(still.yaw).toBe(0);

    const touched = createControls();
    touched.lastTouch = performance.now() / 1000;
    advanceTurn(touched, 1, true);
    expect(touched.yaw).toBe(0);
  });

  it('turns with the arrow keys and resets to the nearest full turn', () => {
    const controls = createControls();
    nudge(controls, 1);
    expect(controls.yaw).toBeGreaterThan(0);
    nudge(controls, -1);
    nudge(controls, -1);
    expect(controls.yaw).toBeLessThan(0);
    resetTurn(controls);
    expect(controls.yaw).toBe(0);
  });
});

describe('frame rate', () => {
  it('needs full-rate frames only while dragging, coasting or settling layers', () => {
    const controls = createControls();
    const activity = createActivity();
    const now = performance.now();
    expect(needsFullRate(controls, activity, now)).toBe(false);

    controls.dragging = true;
    expect(needsFullRate(controls, activity, now)).toBe(true);
    controls.dragging = false;

    controls.velocity = 1;
    expect(needsFullRate(controls, activity, now)).toBe(true);
    controls.velocity = 0;

    markBusy(activity, 1000);
    expect(needsFullRate(controls, activity, performance.now())).toBe(true);
    expect(needsFullRate(controls, activity, performance.now() + 5000)).toBe(false);
  });
});

describe('swaying', () => {
  it('rocks a dish whose back is not worth showing to and fro around its front, never turning it away', () => {
    const angles = Array.from({ length: 400 }, (_, i) => swayYaw(i * 0.1));
    expect(Math.max(...angles.map(Math.abs))).toBeLessThanOrEqual(0.62);
    expect(Math.max(...angles)).toBeGreaterThan(0.5);
    expect(Math.min(...angles)).toBeLessThan(-0.5);
    expect(swayYaw(0)).toBe(0);
  });
});
