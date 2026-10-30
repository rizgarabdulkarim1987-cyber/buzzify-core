// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MenuProductView } from '@/server/data/menu-view';

/**
 * A template menu puts `openProduct` in the context every dish reads, so a function that changes on every render makes
 * every dish (a menu has hundreds) draw again on any tap. The sheet's actions must keep their identity.
 */

vi.mock('@/ui/AppProviders', () => ({ useApp: () => ({ href: (path: string) => `/menu${path}` }) }));
vi.mock('@/ui/analytics/track', () => ({ track: vi.fn() }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { useProductSheet } = await import('@/ui/product/useProductSheet');

const PRODUCTS = [{ id: 'p1', slug: 'soup' }] as unknown as MenuProductView[];

type Sheet = ReturnType<typeof useProductSheet>;

describe('useProductSheet', () => {
  const host = document.createElement('div');
  const root = createRoot(host);
  afterEach(() => act(() => root.render(null)));

  it('keeps openProduct and closeProduct the same function across renders and when the sheet opens', () => {
    const seen: Sheet[] = [];
    function Probe({ tick }: { tick: number }) {
      void tick;
      seen.push(useProductSheet(PRODUCTS));
      return null;
    }
    act(() => root.render(createElement(Probe, { tick: 0 })));
    act(() => root.render(createElement(Probe, { tick: 1 })));
    act(() => seen[seen.length - 1]!.openProduct('p1'));
    act(() => root.render(createElement(Probe, { tick: 2 })));

    expect(seen.length).toBeGreaterThanOrEqual(4);
    expect(seen[seen.length - 1]!.opened?.id).toBe('p1');
    expect(new Set(seen.map((sheet) => sheet.openProduct)).size).toBe(1);
    expect(new Set(seen.map((sheet) => sheet.closeProduct)).size).toBe(1);
  });
});
