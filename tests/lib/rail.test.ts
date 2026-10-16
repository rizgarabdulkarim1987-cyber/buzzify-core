import { describe, expect, it } from 'vitest';
import { deckPose, isRailStyle, RAIL_STYLES, railStyleFromQuery, resolveRailStyle } from '@/lib/rail';

describe('rail styles', () => {
  it('offers grain dishes, drum, split-flap, deck and plain', () => {
    expect(RAIL_STYLES).toEqual(['grains', 'drum', 'flap', 'deck', 'plain']);
  });

  it('recognises only the known styles', () => {
    expect(isRailStyle('deck')).toBe(true);
    expect(isRailStyle('Deck')).toBe(false);
    expect(isRailStyle('carousel')).toBe(false);
    expect(isRailStyle(null)).toBe(false);
  });
});

describe('resolveRailStyle', () => {
  it("uses the restaurant's stored choice", () => {
    expect(resolveRailStyle('drum', 'subtle')).toBe('drum');
    expect(resolveRailStyle('flap', 'expressive')).toBe('flap');
  });

  it('falls back to grain dishes when the stored value is missing or unknown', () => {
    expect(resolveRailStyle(undefined, 'subtle')).toBe('grains');
    expect(resolveRailStyle('wobble', 'subtle')).toBe('grains');
  });

  it('uses the plain rail when the restaurant has turned motion off', () => {
    expect(resolveRailStyle('deck', 'none')).toBe('plain');
  });
});

describe('railStyleFromQuery', () => {
  it('reads a preview style from ?rail=', () => {
    expect(railStyleFromQuery('?rail=drum')).toBe('drum');
    expect(railStyleFromQuery('?table=4&rail=plain')).toBe('plain');
  });

  it('ignores a missing or unknown preview', () => {
    expect(railStyleFromQuery('')).toBeNull();
    expect(railStyleFromQuery('?rail=spin')).toBeNull();
  });
});

describe('deckPose', () => {
  it('puts the active card front and centre, upright', () => {
    const pose = deckPose(0, false);
    expect(pose.x).toBeCloseTo(0);
    expect(pose.rotateY).toBeCloseTo(0);
    expect(pose.rotateZ).toBeCloseTo(0);
    expect(pose.opacity).toBe(1);
    expect(pose.shade).toBe(0);
    expect(pose.z).toBeGreaterThan(0);
  });

  it('keeps nearby cards solid so the cards in front hide the ones behind', () => {
    expect(deckPose(1, false).opacity).toBe(1);
    expect(deckPose(2, false).opacity).toBe(1);
  });

  it('fans later cards out to the right, turned away and further back', () => {
    const one = deckPose(1, false);
    const two = deckPose(2, false);
    expect(one.x).toBeGreaterThan(0);
    expect(two.x).toBeGreaterThan(one.x);
    expect(two.z).toBeLessThan(one.z);
    expect(two.shade).toBeGreaterThan(one.shade);
    expect(one.layer).toBeGreaterThan(two.layer);
    expect(one.rotateY).toBeLessThan(0);
  });

  it('mirrors the fan in right-to-left layouts', () => {
    const ltr = deckPose(1, false);
    const rtl = deckPose(1, true);
    expect(rtl.x).toBeCloseTo(-ltr.x);
    expect(rtl.rotateY).toBeCloseTo(-ltr.rotateY);
    expect(rtl.rotateZ).toBeCloseTo(-ltr.rotateZ);
    expect(rtl.z).toBeCloseTo(ltr.z);
  });

  it('hides cards far from the active one and moves smoothly between whole positions', () => {
    expect(deckPose(5, false).opacity).toBe(0);
    const half = deckPose(0.5, false);
    expect(half.x).toBeGreaterThan(deckPose(0, false).x);
    expect(half.x).toBeLessThan(deckPose(1, false).x);
  });
});
