/**
 * Where Explore's camera stands so the dish never runs under the header or the text panel: the camera keeps its usual
 * angle (it rises with its distance and looks a little above the plinth) and steps back until the dish and its plinth
 * fit between the two, then the picture is shifted to centre them there. Pure numbers, so it can be tested; the
 * canvas eases toward what this returns.
 */

export interface StageFitInput {
  /** The canvas, in CSS pixels. */
  width: number;
  height: number;
  /** Vertical field of view, in degrees. */
  fov: number;
  /** How high the dish stands above the plinth, in world units. */
  dish: number;
  /** The plinth's radius, in world units. */
  plinth: number;
  /** The free band of the screen, in CSS pixels from the top: below the header, above the text panel. */
  band: { top: number; bottom: number };
  /** The distance the canvas would use anyway (it fits the plinth's width), and the farthest it may go. */
  minDistance: number;
  maxDistance: number;
}

export interface StageFit {
  distance: number;
  /** How far to shift the picture up, in CSS pixels (a view offset). */
  offsetY: number;
  /** Where the top of the dish and the bottom of the plinth then land, in CSS pixels from the top. */
  top: number;
  bottom: number;
}

/** How thick the plinth is below the dish. */
const PLINTH_DEPTH = 0.12;

/** The camera's height and the point it looks at, for a distance. */
export const cameraHeight = (distance: number) => distance * 0.3;
export const lookHeight = (distance: number) => 0.1 + distance * 0.02;

/** Where a point in the camera's plane (x = 0) lands, in CSS pixels from the top, before any view offset. */
function screenY(distance: number, y: number, z: number, fov: number, height: number): number {
  const cy = cameraHeight(distance);
  const ty = lookHeight(distance);
  const length = Math.hypot(ty - cy, distance);
  const fy = (ty - cy) / length;
  const fz = -distance / length;
  const ry = y - cy;
  const rz = z - distance;
  const depth = ry * fy + rz * fz;
  const up = ry * (distance / length) + rz * fy;
  const ndc = up / depth / Math.tan((fov * Math.PI) / 360);
  return ((1 - ndc) / 2) * height;
}

function extent(input: StageFitInput, distance: number): { top: number; bottom: number } {
  const { fov, height, dish, plinth } = input;
  // The highest point is the top of the dish, or the far rim of the plinth for a low dish; the lowest is the near rim.
  const top = Math.min(screenY(distance, dish, 0, fov, height), screenY(distance, 0.03, -plinth, fov, height));
  const bottom = screenY(distance, -PLINTH_DEPTH, plinth, fov, height);
  return { top, bottom };
}

export function fitStage(input: StageFitInput): StageFit {
  const room = Math.max(1, input.band.bottom - input.band.top);
  const fits = (distance: number) => {
    const { top, bottom } = extent(input, distance);
    return bottom - top <= room;
  };

  let distance = input.minDistance;
  if (!fits(distance)) {
    // Stepping back only ever shrinks the dish, so search for the nearest distance that fits.
    let near = input.minDistance;
    let far = input.maxDistance;
    if (!fits(far)) near = far;
    for (let i = 0; i < 24 && far - near > 1e-3; i++) {
      const middle = (near + far) / 2;
      if (fits(middle)) far = middle;
      else near = middle;
    }
    distance = far;
  }

  const { top, bottom } = extent(input, distance);
  const offsetY = (top + bottom) / 2 - (input.band.top + input.band.bottom) / 2;
  return { distance, offsetY, top: top - offsetY, bottom: bottom - offsetY };
}
