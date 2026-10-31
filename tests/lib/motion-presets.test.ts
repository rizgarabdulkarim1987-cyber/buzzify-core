import { describe, expect, it } from 'vitest';
import { MOTION_PRESET_IDS, MOTION_PRESETS, motionPresetFeature, withMotionPreset } from '@/lib/templates/motion-presets';
import { parseOverrides, resolveDesign, SCENE_RANGES } from '@/lib/templates/resolve';
import { TEMPLATES } from '@/lib/templates';

const preset = TEMPLATES['obsidian-gold'];
const extras = { details: null, poweredBy: true };

describe('motion presets', () => {
  it('names four presets, each inside the scene ranges', () => {
    expect(MOTION_PRESET_IDS).toEqual(['still', 'calm', 'lively', 'showtime']);
    for (const id of MOTION_PRESET_IDS) {
      const { intensity, speed } = MOTION_PRESETS[id];
      expect(intensity).toBeGreaterThanOrEqual(SCENE_RANGES.intensity[0]);
      expect(intensity).toBeLessThanOrEqual(SCENE_RANGES.intensity[1]);
      expect(speed).toBeGreaterThanOrEqual(SCENE_RANGES.speed[0]);
      expect(speed).toBeLessThanOrEqual(SCENE_RANGES.speed[1]);
    }
  });

  it('still moves nothing and is the only preset every plan has', () => {
    expect(MOTION_PRESETS.still).toMatchObject({ ambient: false, tap: false, scroll: false });
    expect(motionPresetFeature('still')).toBeNull();
    expect(motionPresetFeature('calm')).toBe('design.motionPresets');
    expect(motionPresetFeature('showtime')).toBe('design.motionPresets');
  });

  it('grows in movement from still to showtime', () => {
    const speeds = MOTION_PRESET_IDS.map((id) => MOTION_PRESETS[id].intensity);
    expect([...speeds].sort((a, b) => a - b)).toEqual(speeds);
  });

  it('keeps a valid preset id in the overrides and drops an unknown one', () => {
    expect(parseOverrides({ motionPreset: 'calm' }).motionPreset).toBe('calm');
    expect(parseOverrides({ motionPreset: 'wild' }).motionPreset).toBeUndefined();
    expect(parseOverrides({ motionPreset: 3 }).motionPreset).toBeUndefined();
  });

  it('puts the preset over the template scene and the hand-set sliders over the preset', () => {
    const plain = resolveDesign(preset, {}, extras);
    const calm = resolveDesign(preset, { motionPreset: 'calm' }, extras);
    expect(calm.scene.intensity).toBe(MOTION_PRESETS.calm.intensity);
    expect(calm.scene.brightness).toBe(plain.scene.brightness);
    expect(calm.scene.mode).toBe(plain.scene.mode);
    const tuned = resolveDesign(preset, { motionPreset: 'calm', scene: { intensity: 0.9 } }, extras);
    expect(tuned.scene.intensity).toBe(0.9);
    expect(tuned.scene.speed).toBe(MOTION_PRESETS.calm.speed);
  });

  it('leaves a design without a preset exactly as it was', () => {
    expect(resolveDesign(preset, {}, extras).scene).toEqual(preset.scene);
  });

  it('withMotionPreset returns the scene with the preset applied', () => {
    expect(withMotionPreset(preset.scene, 'still')).toEqual({ ...preset.scene, ...MOTION_PRESETS.still });
    expect(withMotionPreset(preset.scene, undefined)).toBe(preset.scene);
  });
});
