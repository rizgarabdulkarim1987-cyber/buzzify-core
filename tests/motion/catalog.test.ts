import { describe, expect, it } from 'vitest';
import { MOTION_LOADERS } from '@/motion/loaders';
import { MOTION_CATEGORIES, MOTIONS, motionById } from '@/motion/catalog';

/** The list's groups in its order: fifteen motions each, numbered on from the group before. */
const GROUPS = ['three-d', 'scroll', 'luxury', 'food', 'interactive', 'background', 'micro', 'type', 'transition', 'effects'];

describe('the motion catalog', () => {
  it('holds the 150 motions of the list, numbered 1 to 150 in order', () => {
    expect(MOTIONS).toHaveLength(150);
    expect(MOTIONS.map((motion) => motion.number)).toEqual(Array.from({ length: 150 }, (_, i) => i + 1));
  });

  it('gives every motion a unique kebab-case id', () => {
    const ids = MOTIONS.map((motion) => motion.id);
    expect(new Set(ids).size).toBe(150);
    for (const id of ids) expect(id, id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it('puts each group of fifteen in its own category, in the list order', () => {
    expect([...MOTION_CATEGORIES]).toEqual(GROUPS);
    GROUPS.forEach((category, index) => {
      const numbers = MOTIONS.filter((motion) => motion.category === category).map((motion) => motion.number);
      expect(numbers, category).toEqual(Array.from({ length: 15 }, (_, i) => index * 15 + i + 1));
    });
  });

  it('has a loader for every motion and no loader without one', () => {
    expect(Object.keys(MOTION_LOADERS).sort()).toEqual(MOTIONS.map((motion) => motion.id).sort());
  });

  it('finds a motion by its id', () => {
    expect(motionById('golden-particles')?.number).toBe(34);
    expect(motionById('nope')).toBeUndefined();
  });

  it('declares parameters whose defaults are valid', () => {
    for (const motion of MOTIONS) {
      for (const [key, spec] of Object.entries(motion.params)) {
        const where = `${motion.id}.${key}`;
        expect(key, where).toMatch(/^[a-z][a-zA-Z]*$/);
        switch (spec.type) {
          case 'color':
            expect(spec.default, where).toMatch(/^#[0-9a-f]{6}$/);
            break;
          case 'range': {
            expect(spec.min, where).toBeLessThan(spec.max);
            expect(spec.default, where).toBeGreaterThanOrEqual(spec.min);
            expect(spec.default, where).toBeLessThanOrEqual(spec.max);
            const steps = (spec.default - spec.min) / spec.step;
            expect(Math.abs(steps - Math.round(steps)), where).toBeLessThan(1e-6);
            break;
          }
          case 'choice':
            expect(spec.options.length, where).toBeGreaterThan(1);
            expect(spec.options, where).toContain(spec.default);
            break;
          case 'text':
            expect(spec.default.length, where).toBeGreaterThan(0);
            expect(spec.default.length, where).toBeLessThanOrEqual(spec.maxLength);
            break;
          case 'toggle':
            expect(typeof spec.default, where).toBe('boolean');
            break;
        }
      }
    }
  });

  it('keeps the parameter names the speed control and the stage own out of each motion', () => {
    for (const motion of MOTIONS) expect(Object.keys(motion.params), motion.id).not.toContain('speed');
  });
});
