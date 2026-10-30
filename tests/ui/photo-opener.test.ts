import { describe, expect, it } from 'vitest';
import { openerForPhoto, type OpenerNode } from '@/ui/template/photo-opener';

const button = { name: 'open' };

function node(opens: unknown[], parent: OpenerNode | null = null, isPhoto = false): OpenerNode {
  const self: OpenerNode = {
    parentElement: parent,
    closest: (selector) => (selector === '[data-photo]' && isPhoto ? self : parent ? parent.closest(selector) : null),
    querySelectorAll: () => opens,
    querySelector: () => opens[0],
  };
  return self;
}

describe('the button behind a dish photo', () => {
  it('is the dish’s own open button, found above the photo', () => {
    const card = node([button]);
    const photo = node([], card, true);
    expect(openerForPhoto(photo)).toBe(button);
  });

  it('is found even a few levels up', () => {
    const card = node([button]);
    const frame = node([], card);
    const photo = node([], frame, true);
    expect(openerForPhoto(photo)).toBe(button);
  });

  it('is nothing when the first ancestor with buttons holds several dishes', () => {
    const list = node([button, { name: 'other' }]);
    const photo = node([], list, true);
    expect(openerForPhoto(photo)).toBeNull();
  });

  it('is nothing for a tap outside any photo or with no button anywhere', () => {
    expect(openerForPhoto(node([]))).toBeNull();
    expect(openerForPhoto(null)).toBeNull();
    expect(openerForPhoto(node([], node([]), true))).toBeNull();
  });
});
