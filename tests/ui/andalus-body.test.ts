import { describe, expect, it } from 'vitest';
import { andalusMirror, andalusStar } from '@/ui/template/bodies/AndalusBody';

describe('the andalus body (Andalusia)', () => {
  it('mirrors the featured dish, then the signature, then the most ordered, else the first', () => {
    const plain = { id: 'a', isSignature: false };
    const signature = { id: 'b', isSignature: true };
    const featured = { id: 'c', isSignature: false, featured: true as const };
    const popular = { id: 'd', isSignature: false, mostOrdered: true as const };
    expect(andalusMirror([plain, signature, featured])?.id).toBe('c');
    expect(andalusMirror([plain, popular, signature])?.id).toBe('b');
    expect(andalusMirror([plain, popular])?.id).toBe('d');
    expect(andalusMirror([plain])?.id).toBe('a');
    expect(andalusMirror([])).toBeNull();
  });

  it('turns neighbouring stars opposite ways, slowly', () => {
    expect([0, 1, 2, 3].map((place) => andalusStar(place).turn)).toEqual([1, -1, 1, -1]);
    for (const place of [0, 1, 2, 5]) expect(andalusStar(place).time).toBeGreaterThanOrEqual(16);
    expect(andalusStar(-2)).toEqual(andalusStar(0));
  });
});
