import type { SceneSettings } from './types';

/**
 * Motion presets (spec `2026-10-31-project-2-style-control-design.md`, 3.2): one-click bundles of the scene settings that
 * decide how much a menu's background moves. Brightness, blur, opacity and overlay are the business's own and are not
 * part of a preset. Pure, shared by the Studio, the resolver and the plan rules.
 */

export const MOTION_PRESET_IDS = ['still', 'calm', 'lively', 'showtime'] as const;
export type MotionPresetId = (typeof MOTION_PRESET_IDS)[number];

export type MotionPreset = Pick<SceneSettings, 'intensity' | 'speed' | 'ambient' | 'tap' | 'scroll'>;

export const MOTION_PRESETS: Readonly<Record<MotionPresetId, MotionPreset>> = {
  still: { intensity: 0, speed: 0.25, ambient: false, tap: false, scroll: false },
  calm: { intensity: 0.35, speed: 0.6, ambient: true, tap: false, scroll: false },
  lively: { intensity: 0.65, speed: 1, ambient: true, tap: true, scroll: true },
  showtime: { intensity: 1, speed: 1.6, ambient: true, tap: true, scroll: true },
};

export function isMotionPresetId(value: unknown): value is MotionPresetId {
  return typeof value === 'string' && (MOTION_PRESET_IDS as readonly string[]).includes(value);
}

/** The plan feature a preset needs: none for `still` (turning motion off is never sold), else `design.motionPresets`. */
export function motionPresetFeature(id: MotionPresetId): 'design.motionPresets' | null {
  return id === 'still' ? null : 'design.motionPresets';
}

/** A scene with a preset's values on top; the very same scene when there is no preset. */
export function withMotionPreset(scene: SceneSettings, id: MotionPresetId | undefined): SceneSettings {
  return id === undefined ? scene : { ...scene, ...MOTION_PRESETS[id] };
}
