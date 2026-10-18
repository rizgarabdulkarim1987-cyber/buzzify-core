/**
 * The animation library's value type, for the motion library's own types. Type-only: it is erased at build time, so the
 * catalog and the `Motion` entry stay free of the library's code (eslint.config.mjs lets only this file name it).
 */
export type { MotionValue } from 'motion/react';
