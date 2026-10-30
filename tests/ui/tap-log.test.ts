import { describe, expect, it } from 'vitest';
import { describeTarget, pushLine } from '@/ui/debug/tap-log';

describe('the tap debug log', () => {
  it('names an element by tag, first two classes and id', () => {
    expect(describeTarget({ tagName: 'IMG', className: 'size-full object-cover extra', id: 'x' })).toBe('img.size-full.object-cover#x');
    expect(describeTarget({ tagName: 'DIV', className: '' })).toBe('div');
    expect(describeTarget({ tagName: 'svg', className: { baseVal: 'a' } })).toBe('svg');
    expect(describeTarget(null)).toBe('-');
  });

  it('keeps only the newest lines, oldest first', () => {
    expect(pushLine(['a', 'b'], 'c', 3)).toEqual(['a', 'b', 'c']);
    expect(pushLine(['a', 'b', 'c'], 'd', 3)).toEqual(['b', 'c', 'd']);
  });
});
