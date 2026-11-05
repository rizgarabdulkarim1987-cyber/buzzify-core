import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { pharmacyAddressOf } from '@/studio/spaces';

const APP = path.join(process.cwd(), 'src/app/studio/(studio)/(app)');
const read = (relative: string) => readFileSync(path.join(APP, relative), 'utf8');

describe('where an old restaurant address of a pharmacy lands', () => {
  it('keeps the tab', () => {
    expect(pharmacyAddressOf('/studio/restaurants/p1', 'p1')).toBe('/studio/pharmacy/p1');
    expect(pharmacyAddressOf('/studio/restaurants/p1/billing', 'p1')).toBe('/studio/pharmacy/p1/billing');
    expect(pharmacyAddressOf('/studio/restaurants/p1/people/', 'p1')).toBe('/studio/pharmacy/p1/people');
  });

  it('names no other address for a path that is not that business', () => {
    expect(pharmacyAddressOf('/studio/restaurants/other/billing', 'p1')).toBeNull();
    expect(pharmacyAddressOf('/studio/restaurants/p10', 'p1')).toBeNull();
    expect(pharmacyAddressOf('/studio/pharmacy/p1', 'p1')).toBeNull();
    expect(pharmacyAddressOf('/studio', 'p1')).toBeNull();
  });
});

describe('the Menu and Cashier frame of a business', () => {
  const layout = read('restaurants/[id]/layout.tsx');

  it('sends a Super Admin who opens a pharmacy to its Pharmacy page, and nobody else', () => {
    expect(layout).toContain('pharmacyAddressOf(');
    expect(layout).toMatch(/actor\.isSuperAdmin && restaurant\.sector === 'PHARMACY'/);
  });

  it('sends the old Pharmacy list address to the space', () => {
    expect(read('pharmacies/page.tsx')).toContain("redirect('/studio/pharmacy')");
  });
});
