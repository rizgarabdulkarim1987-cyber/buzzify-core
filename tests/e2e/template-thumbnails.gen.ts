import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { test } from '@playwright/test';
import sharp from 'sharp';
import { templateList } from '@/lib/templates';
import type { BusinessType } from '@/lib/templates/types';
import { hideDevTools, menuBySlug, SUPER_ADMIN_FILE } from './helpers/studio';

/**
 * Draws the Design tab's gallery thumbnails (`public/templates/{id}.webp`): each preset rendered by the Studio preview with
 * the demo menu of its kind of business, at phone width, its scene still (reduced motion draws the poster). Run with
 * `npm run studio:thumbnails` (playwright.thumbnails.config.ts); never part of the e2e suite, whose files end in `.spec.ts`.
 */

const DEMO_FOR: Record<BusinessType, string> = {
  restaurant: 'noor-demo',
  cafe: 'riverlight',
  bakery: 'maison-demo',
  icecream: 'onda-demo',
};

/** The gallery card is 3:4 and shows the top of the image. */
const VIEWPORT = { width: 390, height: 520 };
const OUT = path.join(process.cwd(), 'public', 'templates');

test.use({ storageState: SUPER_ADMIN_FILE, viewport: VIEWPORT, deviceScaleFactor: 2, reducedMotion: 'reduce' });

test.beforeAll(async () => {
  await mkdir(OUT, { recursive: true });
});

for (const preset of templateList()) {
  test(`${String(preset.number).padStart(2, '0')} ${preset.name}`, async ({ page, context }) => {
    await hideDevTools(context);
    const menu = await menuBySlug(DEMO_FOR[preset.business]);
    await page.goto(`/studio/preview/${menu.id}/en?template=${preset.id}`);
    // A demo's own template keeps its overrides, the demonstration card among them; the thumbnail shows the preset alone,
    // without the Studio's preview banner either.
    await page.addStyleTag({ content: '.tpl-promo, p.sticky[role="note"] { display: none !important; }' });
    await page.locator('.tpl-content').waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForLoadState('networkidle');
    const png = await page.screenshot({ animations: 'disabled' });
    await sharp(png).resize(VIEWPORT.width).webp({ quality: 72 }).toFile(path.join(OUT, `${preset.id}.webp`));
  });
}
