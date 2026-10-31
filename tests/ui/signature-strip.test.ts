import { describe, expect, it } from 'vitest';
import { chosenFeatured, showsFeaturedStrip, showsSignatureStrip } from '@/ui/template/heroes';

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

describe('the featured strip of a template menu', () => {
  const dish = (slug: string, featured = false) => ({ slug, featured }) as never;

  it('lists the dishes the owner picked, in the owner order, not the automatic fallback', () => {
    const shown = chosenFeatured([dish('b'), dish('a'), dish('c')], ['b', 'a']);
    expect(shown.map((p: { slug: string }) => p.slug)).toEqual(['b', 'a']);
  });

  it('lists the dishes flagged as featured when no slugs were picked', () => {
    const shown = chosenFeatured([dish('a'), dish('b', true)], []);
    expect(shown.map((p: { slug: string }) => p.slug)).toEqual(['b']);
  });

  it('is empty when the owner picked nothing', () => {
    expect(chosenFeatured([dish('a'), dish('b')], [])).toEqual([]);
  });

  it('shows under a compact hero, except for the shapes that draw their featured dishes themselves', () => {
    expect(showsFeaturedStrip('compact', 'saj', 2)).toBe(true);
    expect(showsFeaturedStrip('compact', 'saj', 0)).toBe(false);
    expect(showsFeaturedStrip('carousel', 'saj', 2)).toBe(false);
    for (const body of ['book', 'carpet', 'depth', 'frost', 'gate', 'station', 'steam', 'theatre']) expect(showsFeaturedStrip('compact', body, 2)).toBe(false);
  });
});
