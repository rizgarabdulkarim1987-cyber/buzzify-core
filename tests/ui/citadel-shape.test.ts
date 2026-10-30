import { describe, expect, it } from 'vitest';
import { bodyOf, SHAPE_SETS, TEMPLATES, TEMPLATE_IDS } from '@/lib/templates';
import { templateForStyle } from '@/studio/styles/template-map';
import { registeredAs } from './body-registry';
import { CitadelBody } from '@/ui/template/bodies/CitadelBody';
import { BIRDS, LIGHT_MS, SCENE, WALL, sceneEndsAt, sceneWindows } from '@/ui/template/bodies/citadel-skyline';

describe('the Erbil Citadel shape', () => {
  it('is registered as a body that sets the hero, the navigation, the cards and the headings', () => {
    expect(registeredAs('citadel')).toBe(CitadelBody.name);
    expect(SHAPE_SETS.citadel).toEqual(expect.arrayContaining(['hero', 'nav', 'card', 'heading']));
  });

  it('starts on its own preset after the earlier ones, on the kurd-arab-cit style', () => {
    const preset = TEMPLATES['the-erbil-citadel'];
    expect(TEMPLATE_IDS).toContain('the-erbil-citadel');
    expect(preset.number).toBe(TEMPLATE_IDS.indexOf('the-erbil-citadel') + 1);
    expect(preset.business).toBe('restaurant');
    expect(bodyOf(preset.layout)).toBe('citadel');
    expect(preset.layout.hero).toBe('compact');
    expect(preset.scene.mode).toBe('static');
    expect(preset.palettes.length).toBeGreaterThanOrEqual(4);
    expect(templateForStyle('kurd-arab-cit')).toBe('the-erbil-citadel');
  });
});

describe('the citadel scene', () => {
  it('has two windows (an upper and a lower) for each of eleven houses, all inside the wall and the drawing', () => {
    const windows = sceneWindows();
    expect(windows).toHaveLength(22);
    expect(windows.filter((window) => window.row === 'upper')).toHaveLength(11);
    for (const window of windows) {
      expect(window.x).toBeGreaterThanOrEqual(WALL.left);
      expect(window.x + window.w).toBeLessThanOrEqual(WALL.right);
      expect(window.y).toBeGreaterThanOrEqual(WALL.top);
      expect(window.y + window.h).toBeLessThanOrEqual(SCENE.height);
    }
  });

  it('lights the windows one after another, left to right, each lower one after the upper one over it', () => {
    const windows = sceneWindows();
    const uppers = windows.filter((window) => window.row === 'upper');
    expect(uppers.map((window) => window.delay)).toEqual([...uppers.map((window) => window.delay)].sort((a, b) => a - b));
    expect(new Set(windows.map((window) => window.delay)).size).toBe(windows.length);
    for (let at = 0; at < windows.length; at += 2) expect(windows[at + 1]!.delay).toBeGreaterThan(windows[at]!.delay);
  });

  it('is at rest within five seconds: the windows and every bird end by then (an endless animation is not allowed)', () => {
    expect(sceneEndsAt()).toBeLessThanOrEqual(5000);
    expect(LIGHT_MS).toBeGreaterThan(0);
    for (const bird of BIRDS) expect(bird.delay + bird.ms).toBeLessThanOrEqual(5000);
  });
});
