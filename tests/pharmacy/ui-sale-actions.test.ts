// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StudioI18nProvider } from '@/studio/i18n';
import { STUDIO_MESSAGES } from '@/studio/messages';

/** The cancel-sale dialog offers the refund methods the return form offers (fix round 3, M2): only the default for a sale put wholly on the account. */

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => '/pharmacy/sales/s1' }));
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: unknown }) => createElement('a', { href, ...rest }, children as never) }));
vi.mock('@/app/pharmacy/_actions/returns', () => ({ cancelSale: vi.fn(), returnPreview: vi.fn(async () => ({ ok: true, data: { refundMinor: '1500' } })) }));
vi.mock('@/app/pharmacy/_actions/print', () => ({ getPrintSettings: vi.fn(async () => ({ ok: true, data: { print: { workstations: {} } } })) }));

const { SaleActions } = await import('@/app/pharmacy/_ui/SaleActions');
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLElement;
let root: Root;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const props = (over: Partial<ComponentProps<typeof SaleActions>>): ComponentProps<typeof SaleActions> => ({
  sale: { id: 's1', number: 'S-1', status: 'COMPLETED' },
  mayReturn: true,
  roleCannotReturn: false,
  returnable: true,
  returnWindow: { withinWindow: true, days: 14, mayOverride: true },
  writeBlocked: null,
  cancelLines: [{ saleLineId: 'l1', baseQty: 10 }],
  currency: 'IQD',
  paid: [],
  defaultMethod: 'CASH',
  ...over,
});
async function methodsOf(over: Partial<ComponentProps<typeof SaleActions>>) {
  act(() => root.render(createElement(StudioI18nProvider, { locale: 'en', messages: STUDIO_MESSAGES.en } as ComponentProps<typeof StudioI18nProvider>, createElement(SaleActions, props(over)))));
  await act(async () => document.querySelector<HTMLElement>('[data-testid="sale-cancel"]')!.click());
  return [...document.querySelectorAll<HTMLOptionElement>('[data-testid="cancel-method"] option')].map((o) => o.value);
}

describe('the cancel-sale refund methods', () => {
  it('a sale wholly on the account offers only the default method', async () => {
    expect(await methodsOf({ paid: [], onAccount: true })).toEqual(['CASH']);
  });
  it('a sale paid at the till offers the methods it was paid with', async () => {
    expect(await methodsOf({ paid: ['CARD_MANUAL'], defaultMethod: 'CARD_MANUAL', onAccount: true })).toEqual(['CARD_MANUAL']);
  });
  it('a sale with no payments at all (not on the account) still offers any method', async () => {
    expect(await methodsOf({ paid: [], onAccount: false })).toEqual(['CASH', 'CARD_MANUAL', 'TRANSFER_MANUAL']);
  });
});
