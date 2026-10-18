/**
 * Buzzify's motion library: 150 motions for menus, each reusable by id.
 *
 * ```tsx
 * import { Motion } from '@/motion';
 * <Motion id="golden-particles" params={{ color: '#d4a64a', count: 200 }} />
 * ```
 *
 * A scroll motion reads the page's scroll: `const { scrollYProgress } = useScroll({ target })` from `motion/react`, then
 * `<Motion id="scroll-zoom" progress={scrollYProgress} />`. The Studio's Motion area shows every motion and writes this
 * code for the values a designer picks.
 */
export { Motion, preloadMotion, type MotionComponentProps } from './Motion';
export { MOTIONS, MOTION_CATEGORIES, motionById, motionsIn } from './catalog';
export { changedParams, resolveParams } from './params';
export type { MotionCategory, MotionDrive, MotionEngine, MotionMeta, MotionParams, MotionProps, ParamSpec } from './types';
