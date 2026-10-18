import { describe, expect, it } from 'vitest';
import { resolveParams } from '@/motion/params';
import type { MotionMeta } from '@/motion/types';

const META: MotionMeta = {
  id: 'sample',
  number: 1,
  category: 'three-d',
  engine: 'dom',
  drive: 'time',
  params: {
    color: { type: 'color', default: '#d4a64a' },
    size: { type: 'range', default: 40, min: 10, max: 80, step: 5 },
    glow: { type: 'toggle', default: true },
    model: { type: 'choice', default: 'burger', options: ['burger', 'cup'] },
    text: { type: 'text', default: 'Buzzify', maxLength: 12 },
  },
};

describe('resolveParams', () => {
  it('fills every parameter with its default when nothing is given', () => {
    expect(resolveParams(META)).toEqual({ color: '#d4a64a', size: 40, glow: true, model: 'burger', text: 'Buzzify' });
  });

  it('keeps valid values', () => {
    expect(resolveParams(META, { color: '#112233', size: 55, glow: false, model: 'cup', text: 'قهوة' })).toEqual({
      color: '#112233',
      size: 55,
      glow: false,
      model: 'cup',
      text: 'قهوة',
    });
  });

  it('clamps numbers into range and onto the step', () => {
    expect(resolveParams(META, { size: 999 }).size).toBe(80);
    expect(resolveParams(META, { size: -4 }).size).toBe(10);
    expect(resolveParams(META, { size: 42 }).size).toBe(40);
  });

  it('replaces values of the wrong kind with the default', () => {
    const resolved = resolveParams(META, { color: 'red', size: Number.NaN, glow: 'yes', model: 'pizza', text: 3 } as never);
    expect(resolved).toEqual({ color: '#d4a64a', size: 40, glow: true, model: 'burger', text: 'Buzzify' });
  });

  it('lowercases a colour written in capitals', () => {
    expect(resolveParams(META, { color: '#AABBCC' }).color).toBe('#aabbcc');
  });

  it('trims text to its length and falls back to the default when it is empty', () => {
    expect(resolveParams(META, { text: 'A very long headline indeed' }).text).toBe('A very long ');
    expect(resolveParams(META, { text: '   ' }).text).toBe('Buzzify');
  });

  it('drops keys the motion does not have', () => {
    expect(resolveParams(META, { other: 1 } as never)).not.toHaveProperty('other');
  });
});
