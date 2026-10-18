import { expect, test as base } from '@playwright/test';
import { createTableQrCode, createTemporaryMenu, qrScans, type TemporaryMenu } from './helpers/db';
import { E2E_ORIGIN } from './helpers/origin';

/** Each test that changes a menu gets its own throwaway one, deleted afterwards whatever the outcome. */
const test = base.extend<{ menu: TemporaryMenu }>({
  menu: async ({}, provide) => {
    const menu = await createTemporaryMenu();
    try {
      await provide(menu);
    } finally {
      await menu.remove();
    }
  },
});

test.describe('the address on a card or a QR code', () => {
  test('/atelier opens the menu in the default language', async ({ page, request }) => {
    const raw = await request.get('/atelier', { maxRedirects: 0 });
    expect(raw.status()).toBe(307);
    expect(raw.headers()['location']).toBe('/atelier/en');

    await page.goto('/atelier');
    await expect(page).toHaveURL(/\/atelier\/en$/);
    await expect(page.getByTestId('brand')).toHaveText('ATELIER');
  });

  test('keeps the query string', async ({ page }) => {
    await page.goto('/atelier?utm_source=card');
    await expect(page).toHaveURL(/\/atelier\/en\?utm_source=card$/);
  });

  test.describe('with Arabic as the browser language', () => {
    test.use({ locale: 'ar-IQ' });

    test('/atelier opens the Arabic menu', async ({ page }) => {
      await page.goto('/atelier');
      await expect(page).toHaveURL(/\/atelier\/ar$/);
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    });

    test('a table address opens the Arabic table page', async ({ page }) => {
      await page.goto('/atelier/t/04');
      await expect(page).toHaveURL(/\/atelier\/ar\/t\/04$/);
      await expect(page.getByText('الطاولة 04')).toBeVisible();
    });
  });

  test.describe('with Kurdish as the browser language', () => {
    test.use({ locale: 'ku-IQ' });

    test('/atelier opens the Sorani menu', async ({ page }) => {
      await page.goto('/atelier');
      await expect(page).toHaveURL(/\/atelier\/ckb$/);
    });
  });

  test('/atelier/t/04 opens the table page in English', async ({ page }) => {
    await page.goto('/atelier/t/04');
    await expect(page).toHaveURL(/\/atelier\/en\/t\/04$/);
    await expect(page.getByText('Table 04')).toBeVisible();
  });

  test('an unknown slug is a 404, with or without a language', async ({ request }) => {
    for (const path of ['/definitely-not-a-menu', '/definitely-not-a-menu/en', '/definitely-not-a-menu/t/04']) {
      expect((await request.get(path, { maxRedirects: 0 })).status(), path).toBe(404);
    }
  });
});

test.describe('a scanned QR code', () => {
  test('keeps its id through the language redirect, counts the scan, and leaves the address clean', async ({ menu, page, request }) => {
    const code = await createTableQrCode(menu.menuId, 7);
    const raw = await request.get(`/${menu.slug}/t/7?qr=${code}`, { maxRedirects: 0 });
    expect(raw.headers()['location']).toBe(`/${menu.slug}/en/t/7?qr=${code}`);

    const sent = page.waitForRequest((request) => request.method() === 'POST' && request.url().endsWith(`/api/${menu.slug}/events`));
    await page.goto(`/${menu.slug}/t/7?qr=${code}`);
    await expect(page).toHaveURL(new RegExp(`/${menu.slug}/en/t/7$`));
    const view = (await sent).postDataJSON().events.find((event: { type: string }) => event.type === 'MENU_VIEW');
    expect(view).toMatchObject({ qrCodeId: code });
    await expect.poll(() => qrScans(code)).toBe(1);
  });
});

test.describe('a renamed menu', () => {
  test('the old address answers a permanent redirect to the new one, keeping the path and query', async ({
    menu,
    page,
    request,
  }) => {
    const renamed = await menu.rename();
    const old = `/${menu.slug}/en/p/${menu.productSlug}?x=1`;

    const raw = await request.get(old, { maxRedirects: 0 });
    expect(raw.status()).toBe(308);
    expect(raw.headers()['location']).toBe(`/${renamed}/en/p/${menu.productSlug}?x=1`);

    await page.goto(old);
    await expect(page).toHaveURL(new RegExp(`/${renamed}/en/p/${menu.productSlug}\\?x=1$`));
    await expect(page.getByRole('heading', { name: 'Espresso' })).toBeVisible();
  });

  test('the old menu, table and cart addresses follow the rename too', async ({ menu, request }) => {
    const renamed = await menu.rename();

    const home = await request.get(`/${menu.slug}/ar`, { maxRedirects: 0 });
    expect([home.status(), home.headers()['location']]).toEqual([308, `/${renamed}/ar`]);

    const cart = await request.get(`/${menu.slug}/en/cart`, { maxRedirects: 0 });
    expect([cart.status(), cart.headers()['location']]).toEqual([308, `/${renamed}/en/cart`]);

    const entry = await request.get(`/${menu.slug}`, { maxRedirects: 0 });
    expect([entry.status(), entry.headers()['location']]).toEqual([307, `/${renamed}/en`]);

    const table = await request.get(`/${menu.slug}/t/9`, { maxRedirects: 0 });
    expect([table.status(), table.headers()['location']]).toEqual([307, `/${renamed}/en/t/9`]);
  });
});

test.describe('a suspended menu', () => {
  test('shows the neutral page with the restaurant name, and stays out of search results', async ({ menu, page }) => {
    await menu.suspend();
    await page.goto(`/${menu.slug}/en`);

    await expect(page.getByTestId('menu-unavailable')).toBeVisible();
    await expect(page.getByRole('heading', { name: menu.name })).toBeVisible();
    await expect(page.getByText('This menu is temporarily unavailable.')).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await expect(page.getByRole('button', { name: /Espresso/ })).toHaveCount(0);
  });

  test('speaks the visitor’s language, also on inner pages', async ({ menu, page }) => {
    await menu.suspend();
    await page.goto(`/${menu.slug}/ar/cart`);

    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByText('هذه القائمة غير متاحة مؤقتًا.')).toBeVisible();
  });
});

test.describe('search engines', () => {
  test('a live menu names its canonical address and its translations, and is indexable', async ({ page }) => {
    await page.goto('/atelier/ar');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `${E2E_ORIGIN}/atelier/ar`);
    for (const locale of ['en', 'ar', 'ckb']) {
      await expect(page.locator(`link[rel="alternate"][hreflang="${locale}"]`)).toHaveAttribute(
        'href',
        `${E2E_ORIGIN}/atelier/${locale}`,
      );
    }
    await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
  });

  test('a product page names itself as canonical, and its translations', async ({ page }) => {
    await page.goto('/atelier/en/p/atelier-burger');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      `${E2E_ORIGIN}/atelier/en/p/atelier-burger`,
    );
    await expect(page.locator('link[rel="alternate"][hreflang="ckb"]')).toHaveAttribute(
      'href',
      `${E2E_ORIGIN}/atelier/ckb/p/atelier-burger`,
    );
  });

  // The table's page is what a diner's phone opens from the QR code: every byte of it counts (it has to arrive in the
  // first round trip), so it and the other inner pages name the menu's home as canonical and list no translations.
  for (const path of ['/atelier/en/t/04', '/atelier/en/cart', '/atelier/en/explore']) {
    test(`${path} names the menu’s home as canonical, without translations`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `${E2E_ORIGIN}/atelier/en`);
      await expect(page.locator('link[rel="alternate"]')).toHaveCount(0);
      await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
    });
  }
});

test.describe('the 404 page', () => {
  const heading = 'We couldn’t find that page';

  test('leads back to the menu in the same language', async ({ page }) => {
    await page.goto('/atelier/en/p/does-not-exist');
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    const back = page.getByRole('link', { name: 'Back to the menu' });
    await expect(back).toHaveAttribute('href', '/atelier/en');
    await back.click();
    await expect(page).toHaveURL(/\/atelier\/en$/);
    await expect(page.getByTestId('brand')).toHaveText('ATELIER');

    await page.goto('/atelier/ar/t/999');
    await expect(page.getByRole('link', { name: 'Back to the menu' })).toHaveAttribute('href', '/atelier/ar');
  });

  test('leads to the menu’s entry address when the language is unknown', async ({ page }) => {
    await page.goto('/atelier/xx');
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    const back = page.getByRole('link', { name: 'Back to the menu' });
    await expect(back).toHaveAttribute('href', '/atelier');
    await back.click();
    await expect(page).toHaveURL(/\/atelier\/en$/);
  });

  test('does not lead to a language the menu lacks', async ({ page }) => {
    const english = await createTemporaryMenu({ locales: ['en'] });
    try {
      await page.goto(`/${english.slug}/ckb`);
      await expect(page.getByRole('heading', { name: heading })).toBeVisible();
      const back = page.getByRole('link', { name: 'Back to the menu' });
      await expect(back).toHaveAttribute('href', `/${english.slug}`);
      await back.click();
      await expect(page).toHaveURL(new RegExp(`/${english.slug}/en$`));
      await expect(page.getByRole('heading', { name: heading })).toBeHidden();
    } finally {
      await english.remove();
    }
  });
});

test.describe('the root address', () => {
  test('goes to the Studio on a development host', async ({ request }) => {
    const response = await request.get('/', { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(new URL(response.headers()['location']!, E2E_ORIGIN).pathname).toBe('/studio');
  });
});
