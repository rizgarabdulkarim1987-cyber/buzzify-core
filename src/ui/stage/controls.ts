/**
 * Turning state shared between the page (pointer and keyboard handlers) and the 3D scene (which
 * reads it every frame). It is a plain mutable object on purpose: it changes many times a second
 * and must never cause a React render.
 */
export interface StageControls {
  /** Accumulated rotation around the vertical axis, in radians. */
  yaw: number;
  /** Radians per second left over from the last drag; decays in the scene. */
  velocity: number;
  dragging: boolean;
  /** `performance.now() / 1000` of the last interaction, used to pause the idle turn. */
  lastTouch: number;
}

/** When the scene last needed full-rate frames, as a `performance.now()` deadline in milliseconds. */
export interface StageActivity {
  busyUntil: number;
}

export function createActivity(): StageActivity {
  return { busyUntil: 0 };
}

export function markBusy(activity: StageActivity, milliseconds: number): void {
  activity.busyUntil = Math.max(activity.busyUntil, performance.now() + milliseconds);
}

/** Frames are only drawn at full rate while something is moving; an idle turn needs far fewer. */
export function needsFullRate(controls: StageControls, activity: StageActivity, now: number): boolean {
  return controls.dragging || Math.abs(controls.velocity) > 0.02 || now < activity.busyUntil;
}

export function createControls(): StageControls {
  return { yaw: 0, velocity: 0, dragging: false, lastTouch: 0 };
}

const RADIANS_PER_PIXEL = 0.011;
const KEY_STEP = Math.PI / 12;
const MAX_VELOCITY = 9;

const IDLE_RADIANS_PER_SECOND = (8 * Math.PI) / 180;
const IDLE_RESUME_SECONDS = 1.4;

/**
 * One frame of turning: let a flick coast and decay, then resume the slow idle turn once nobody has
 * touched the object for a moment. Returns the yaw to draw.
 */
export function advanceTurn(controls: StageControls, deltaSeconds: number, idleTurn: boolean): number {
  if (!controls.dragging) {
    controls.yaw += controls.velocity * deltaSeconds;
    controls.velocity *= Math.exp(-3.2 * deltaSeconds);
    const rested = performance.now() / 1000 - controls.lastTouch > IDLE_RESUME_SECONDS;
    if (idleTurn && rested && Math.abs(controls.velocity) < 0.05) {
      controls.yaw += IDLE_RADIANS_PER_SECOND * deltaSeconds;
    }
  }
  return controls.yaw;
}

const SWAY_RADIANS = 0.6;
const SWAY_SECONDS = 13;

/**
 * The idle motion for a dish whose back is not worth showing (a scan with only its front made well): it rocks to and
 * fro around its front instead of turning all the way round. Added to what the guest's dragging gives.
 */
export function swayYaw(seconds: number): number {
  return SWAY_RADIANS * Math.sin((2 * Math.PI * seconds) / SWAY_SECONDS);
}

export function beginDrag(controls: StageControls): void {
  controls.dragging = true;
  controls.velocity = 0;
  controls.lastTouch = performance.now() / 1000;
}

export function dragBy(controls: StageControls, deltaX: number, deltaSeconds: number): void {
  const delta = deltaX * RADIANS_PER_PIXEL;
  controls.yaw += delta;
  if (deltaSeconds > 0) {
    const velocity = delta / deltaSeconds;
    controls.velocity = Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, velocity));
  }
  controls.lastTouch = performance.now() / 1000;
}

export function endDrag(controls: StageControls): void {
  controls.dragging = false;
  controls.lastTouch = performance.now() / 1000;
}

export function nudge(controls: StageControls, direction: -1 | 1): void {
  controls.yaw += direction * KEY_STEP;
  controls.velocity = 0;
  controls.lastTouch = performance.now() / 1000;
}

export function resetTurn(controls: StageControls): void {
  const turns = Math.round(controls.yaw / (Math.PI * 2));
  controls.yaw = turns * Math.PI * 2 + 0; // + 0 turns -0 into 0
  controls.velocity = 0;
  controls.lastTouch = performance.now() / 1000;
}
