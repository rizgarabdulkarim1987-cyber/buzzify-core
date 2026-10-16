import { expect, test as setup } from '@playwright/test';
import { atelierProductIds } from './helpers/db';

/**
 * Every suite reads the seeded ATELIER menu, so the run starts once the dev server serves the ATELIER the database holds.
 * `npm run db:seed` replaces the menu (new ids) behind the server's back, and the server keeps what it resolved the
 * `atelier` address to for up to 5 minutes: until then it serves the old menu, and anything that reaches the database
 * with the old ids (guests' events, a publish that expires the cache halfway through a test) breaks. When that is the
 * case this waits, polling the page, until the server has refreshed it; on a server that already serves the current
 * menu it passes at once.
 */
setup('the dev server serves the ATELIER menu the database holds', async ({ request }) => {
  setup.setTimeout(7 * 60_000);
  const ids = await atelierProductIds();
  const servesCurrent = async () => {
    const response = await request.get('/atelier/en');
    const html = response.ok() ? await response.text() : '';
    return ids.some((id) => html.includes(id));
  };
  if (await servesCurrent()) return;

  console.log('The dev server still serves ATELIER from before the last `npm run db:seed` (cached up to 5 minutes); waiting for it to refresh.');
  await expect
    .poll(servesCurrent, { timeout: 6 * 60_000, intervals: [2_000, 5_000], message: 'the dev server should serve the seeded ATELIER menu' })
    .toBe(true);
});
