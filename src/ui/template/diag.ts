import type { MenuProductView, MenuView } from '@/server/data/menu-view';

/** The product without one of its optional fields. */
function without(product: MenuProductView, key: 'featured' | 'special'): MenuProductView {
  const copy = { ...product };
  delete copy[key];
  return copy;
}

/**
 * Switches for finding what stalls a phone: `?diag=nosig,nofeat,nospecial,nowarm` on a menu's address turns the
 * signature dish, the featured dishes, the specials (offers and their labels) or the early load of the product page off
 * for that visit only. Nothing is saved and nothing changes for guests without the parameter.
 */
export function diagFlags(search: string): ReadonlySet<string> {
  const value = new URLSearchParams(search).get('diag');
  return new Set(value ? value.split(',').map((flag) => flag.trim()).filter(Boolean) : []);
}

/** The menu without what the flags turn off. */
export function withDiag(view: MenuView, flags: ReadonlySet<string>): MenuView {
  if (flags.size === 0) return view;
  let next = view;
  if (flags.has('nosig')) next = { ...next, signatureProductId: null };
  if (flags.has('nofeat')) next = { ...next, products: next.products.map((product) => without(product, 'featured')) };
  if (flags.has('nospecial')) {
    next = {
      ...next,
      offers: [],
      products: next.products.map((product) => without(product, 'special')),
    };
  }
  return next;
}
