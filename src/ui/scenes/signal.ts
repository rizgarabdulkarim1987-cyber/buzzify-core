import type { SceneMedia, VisualMode } from '@/lib/templates/types';

/**
 * What a background scene reads every frame: how far the page has scrolled, where the guest last tapped the background,
 * where a fine pointer is, and which category is in view. A plain mutable object, so updating it never re-renders
 * React; scenes read it in their frame loop, the motion layer through CSS variables.
 */
export interface SceneSignal {
  /** 0 at the top of the page, 1 at the bottom. */
  progress: number;
  /** The last background tap, in -1..1 on both axes (y up), and when it happened (`performance.now()`). */
  tap: { x: number; y: number; time: number } | null;
  /** A fine pointer's position in -1..1 (y up); 0,0 without one. */
  pointer: { x: number; y: number };
  /** The index of the category in view, and when it last changed. */
  category: number;
  categoryTime: number;
  /** True while the scene should hold still (page hidden, a product open, or the guest paused it). */
  paused: boolean;
}

export function createSceneSignal(): SceneSignal {
  return { progress: 0, tap: null, pointer: { x: 0, y: 0 }, category: 0, categoryTime: -Infinity, paused: false };
}

/** Scroll progress from 0 to 1, the same value for the same position whichever way the page is moving. */
export function scrollProgress(scrollY: number, scrollHeight: number, viewportHeight: number): number {
  const range = scrollHeight - viewportHeight;
  if (!(range > 0)) return 0;
  return Math.min(1, Math.max(0, scrollY / range));
}

/** Elements a tap belongs to rather than the background. */
const INTERACTIVE = 'a, button, input, select, textarea, label, summary, dialog, [role="button"], [role="tab"], [role="link"], [contenteditable="true"], [tabindex]:not([tabindex="-1"])';

/** Whether a tap on this element is meant for the page (a control or its contents), so the scene must ignore it. */
export function isInteractiveTarget(target: Element | null): boolean {
  return target?.closest(INTERACTIVE) != null;
}

export interface SceneEnvironment {
  reducedMotion: boolean;
  /** The 3D stage's device check passed (WebGL, memory, cores, no data saver, not turned off). */
  qualifies3d: boolean;
  saveData: boolean;
}

/**
 * The mode a device shows: what the business asked for, or the next one down that the device can show. Reduced motion
 * always gets the static scene; 3D falls back to motion on a device that cannot run it, and to static with data saver.
 */
export function effectiveMode(requested: VisualMode, env: SceneEnvironment): VisualMode {
  if (env.reducedMotion || requested === 'static') return 'static';
  if (requested === '3d') {
    if (env.qualifies3d) return '3d';
    return env.saveData ? 'static' : 'motion';
  }
  return 'motion';
}

/**
 * What the background shows: the template's poster, its motion or its 3D scene, or the business's scene file (spec
 * 2026-10-18-template-studio-stage-2-scene-files-design.md, 5). Static asks for a still: a video's own poster, else the
 * template's. A model needs 3D and a device that draws it; without one it falls to the template's motion, like the
 * template's own 3D scene. A video is the heaviest thing on the page, so data saver gets its poster. Reduced motion
 * always gets a still, and a file that fails gives way to the template's motion.
 */
export type ScenePlan = 'poster' | 'motion' | '3d' | 'model' | 'video' | 'videoStill' | 'lottie' | 'image';

export function scenePlan(requested: VisualMode, media: SceneMedia['kind'] | null, env: SceneEnvironment & { failed: boolean }): ScenePlan {
  // A picture is already a still: it needs no idle page, no WebGL and no permission from reduced motion or data saver.
  if (media === 'image') return env.failed ? 'poster' : 'image';
  const still: ScenePlan = media === 'video' ? 'videoStill' : 'poster';
  if (env.reducedMotion || requested === 'static') return still;
  if (env.failed) return 'motion';
  switch (media) {
    case 'video':
      return env.saveData ? 'videoStill' : 'video';
    case 'lottie':
      return 'lottie';
    case 'model': {
      if (requested !== '3d') return 'motion';
      const mode = effectiveMode('3d', env);
      return mode === '3d' ? 'model' : mode === 'motion' ? 'motion' : 'poster';
    }
    default: {
      const mode = effectiveMode(requested, env);
      return mode === 'static' ? 'poster' : mode;
    }
  }
}

/**
 * What a background is drawing: the template and the file it plays. A failure or a finished load belongs to one source,
 * so choosing another file (the Studio's preview) gives it its own try; framing a model again is the same source.
 */
export function sceneSource(templateId: string, media: SceneMedia | null): string {
  return media ? `${templateId}|${media.kind}|${media.url}` : templateId;
}
