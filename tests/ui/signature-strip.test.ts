import { describe, expect, it } from 'vitest';
import { showsSignatureStrip } from '@/ui/template/heroes';

describe('the signature strip of a template menu', () => {
  it('shows the signature dish under a compact hero, for a shape that does not draw it itself', () => {
    expect(showsSignatureStrip('compact', 'saj', true)).toBe(true);
    expect(showsSignatureStrip('compact', 'scroll', true)).toBe(true);
  });

  it('stays out when there is no signature dish', () => {
    expect(showsSignatureStrip('compact', 'saj', false)).toBe(false);
  });

  it('leaves the shapes that draw the signature themselves alone', () => {
    for (const body of ['book', 'carpet', 'depth', 'theatre']) expect(showsSignatureStrip('compact', body, true)).toBe(false);
  });

  it('leaves the heroes that already feature the lead dish alone', () => {
    for (const hero of ['editorial', 'asymmetric', 'arch', 'chapters', 'spotlight', 'carousel', 'pedestal', 'collection', 'daily', 'occasion', 'flavorWall', 'catch']) {
      expect(showsSignatureStrip(hero, 'scroll', true)).toBe(false);
    }
  });
});
