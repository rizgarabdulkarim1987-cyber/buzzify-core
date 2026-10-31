import { describe, expect, it } from 'vitest';
import { diagFlags, withDiag } from '@/ui/template/diag';

const view = {
  offers: [{ id: 'o1' }],
  signatureProductId: 'p1',
  products: [
    { id: 'p1', special: 'Special', featured: true },
    { id: 'p2', featured: true },
  ],
} as never;

describe('the menu diagnostic flags', () => {
  it('reads the comma separated flags of ?diag=', () => {
    expect([...diagFlags('?diag=nosig,nofeat')]).toEqual(['nosig', 'nofeat']);
    expect(diagFlags('?x=1').size).toBe(0);
    expect(diagFlags('').size).toBe(0);
  });

  it('leaves the menu as it is with no flag', () => {
    expect(withDiag(view, new Set())).toBe(view);
  });

  it('drops the signature, the featured flags, or the specials, each on its own', () => {
    const nosig = withDiag(view, new Set(['nosig'])) as never as { signatureProductId: string | null; offers: unknown[] };
    expect(nosig.signatureProductId).toBeNull();
    expect(nosig.offers).toHaveLength(1);

    const nofeat = withDiag(view, new Set(['nofeat'])) as never as { products: { featured?: boolean }[] };
    expect(nofeat.products.every((product) => product.featured === undefined)).toBe(true);

    const nospecial = withDiag(view, new Set(['nospecial'])) as never as { offers: unknown[]; products: { special?: string }[] };
    expect(nospecial.offers).toEqual([]);
    expect(nospecial.products.every((product) => product.special === undefined)).toBe(true);
  });
});
