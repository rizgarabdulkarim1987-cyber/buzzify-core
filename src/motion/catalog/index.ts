import { MOTION_CATEGORIES, type MotionCategory, type MotionMeta } from '../types';
import { FOOD, LUXURY, SCROLL, THREE_D } from './groups-a';
import { BACKGROUND, INTERACTIVE, MICRO, TYPE } from './groups-b';
import { EFFECTS, TRANSITION } from './groups-c';

export { MOTION_CATEGORIES };

/** The 150 motions in the list's order. Data only: no motion's code is loaded by reading this. */
export const MOTIONS: readonly MotionMeta[] = [
  ...THREE_D,
  ...SCROLL,
  ...LUXURY,
  ...FOOD,
  ...INTERACTIVE,
  ...BACKGROUND,
  ...MICRO,
  ...TYPE,
  ...TRANSITION,
  ...EFFECTS,
];

const BY_ID = new Map(MOTIONS.map((motion) => [motion.id, motion]));

export function motionById(id: string): MotionMeta | undefined {
  return BY_ID.get(id);
}

export function motionsIn(category: MotionCategory): MotionMeta[] {
  return MOTIONS.filter((motion) => motion.category === category);
}
