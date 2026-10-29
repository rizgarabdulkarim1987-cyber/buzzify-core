import type { ReactElement, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** The table page (`/t/<n>`) opens the same menu as the home page, so it draws the template the restaurant chose. */

const state = vi.hoisted(() => ({ design: undefined as object | undefined }));

vi.mock('next/navigation', () => ({ notFound: vi.fn() }));
vi.mock('@/server/data/prisma', () => ({ getPrisma: () => ({}) }));
vi.mock('@/server/data/tenant-db', () => ({ menuDb: () => ({ table: { findFirst: async () => ({ id: 'table' }) } }) }));
vi.mock('@/server/route-context', () => ({ loadMenuView: async () => ({ marker: 'view' }) }));
vi.mock('@/server/public-page', () => ({
  searchString: () => '',
  withPublicMenu: async (_params: unknown, _path: string, _search: string, render: (route: unknown) => Promise<ReactNode>) =>
    render({ tenant: { brand: { design: state.design }, seo: {} }, locale: 'en' }),
}));
vi.mock('@/ui/AppProviders', () => ({ RouteTable: function RouteTable() { return null; } }));
vi.mock('@/ui/menu/MenuApp', () => ({ MenuApp: function MenuApp() { return null; } }));
vi.mock('@/ui/template/TemplateMenu', () => ({ TemplateMenu: function TemplateMenu() { return null; } }));

async function render(): Promise<string[]> {
  const { default: Page } = await import('@/app/[tenant]/[locale]/t/[table]/page');
  const tree = (await Page({
    params: Promise.resolve({ tenant: 'zhamitos', locale: 'en', table: '1' }),
    searchParams: Promise.resolve({}),
  })) as ReactElement<{ children: ReactElement[] }>;
  return tree.props.children.map((child) => (child.type as { name: string }).name);
}

describe('the table page', () => {
  beforeEach(() => {
    state.design = undefined;
  });

  it('draws the template the restaurant chose', async () => {
    state.design = { templateId: 'the-frosted-window' };
    expect(await render()).toEqual(['RouteTable', 'TemplateMenu']);
  });

  it('draws the classic menu when no template is chosen', async () => {
    expect(await render()).toEqual(['RouteTable', 'MenuApp']);
  });
});
