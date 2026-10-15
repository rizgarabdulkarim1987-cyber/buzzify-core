/**
 * How the scenes of Explore move as the guest scrubs. Everything here is a pure function of one
 * number: progress, in scene units (0 is the first scene centred, 1 the second, and so on). It is
 * computed from the absolute position, never from accumulated deltas, so it cannot drift and the
 * same position always draws the same frame.
 */

/** World units between neighbouring scenes along the set. */
export const SCENE_SPACING = 3.1;

/** Scenes farther than this from the camera are not drawn. */
export const CULL_DISTANCE = 1.7;

export interface SceneState {
  /** Sideways position on the set. */
  x: number;
  /** Small dip for scenes away from the centre, so the set feels like a shallow arc. */
  y: number;
  /** Turn toward the centre as a scene arrives, away as it leaves. */
  rotationY: number;
  scale: number;
  /** Whether the scene is close enough to be drawn at all. */
  visible: boolean;
  /** Opacity of the scene's text and controls: 1 in focus, 0 once it has left. */
  opacity: number;
  /** 1 at the centre, easing to 0 one scene away. */
  focus: number;
  /** How far layers fan apart because the scene is in transit (0 at rest). */
  fan: number;
}

const smoothstep = (x: number, min: number, max: number) => {
  const t = Math.min(1, Math.max(0, (x - min) / (max - min)));
  return t * t * (3 - 2 * t);
};

export function sceneState(index: number, progress: number): SceneState {
  const d = index - progress;
  const away = Math.abs(d);
  return {
    x: d * SCENE_SPACING,
    y: -0.16 * Math.min(away, 1.5),
    rotationY: -d * 1.1,
    scale: 1 - 0.42 * smoothstep(away, 0, 1.2),
    visible: away < CULL_DISTANCE,
    opacity: 1 - smoothstep(away, 0, 0.55),
    focus: 1 - smoothstep(away, 0, 1),
    fan: 0.6 * smoothstep(away, 0, 0.7),
  };
}

/** The scene index closest to a progress value, clamped to the available scenes. */
export function nearestScene(progress: number, count: number): number {
  if (count <= 0) return 0;
  return Math.min(count - 1, Math.max(0, Math.round(progress)));
}
