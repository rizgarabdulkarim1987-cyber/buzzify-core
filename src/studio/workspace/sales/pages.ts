/** The Sales tab's own pages, in order, under `/studio/menus/{id}/sales`. */
export const SALES_PAGES: ReadonlyArray<{ key: string; path: string; labelKey: string }> = [
  { key: 'overview', path: '', labelKey: 'sales.page.overview' },
  { key: 'dishes', path: '/dishes', labelKey: 'sales.page.dishes' },
  { key: 'upgrades', path: '/upgrades', labelKey: 'sales.page.upgrades' },
  { key: 'pairings', path: '/pairings', labelKey: 'sales.page.pairings' },
  { key: 'sets', path: '/sets', labelKey: 'sales.page.sets' },
  { key: 'offers', path: '/offers', labelKey: 'sales.page.offers' },
  { key: 'showcase', path: '/showcase', labelKey: 'sales.page.showcase' },
  { key: 'settings', path: '/settings', labelKey: 'sales.page.settings' },
];
