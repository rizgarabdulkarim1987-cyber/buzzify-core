/** Takes the 35 card posters of the Studio's Menu Styles library: `npm run styles:posters`. */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { MENU_STYLES } from '../src/studio/styles/catalog';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/studio/styles');
const out = path.join(root, 'posters');

async function main() {
  mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 430, height: 900 }, deviceScaleFactor: 1 });
  const only = process.argv.slice(2);
  for (const style of MENU_STYLES) {
    if (only.length && !only.includes(style.id)) continue;
    const page = await context.newPage();
    const url = `${pathToFileURL(path.join(root, 'pages', `${style.page}.html`)).href}?style=${style.key}`;
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1800);
    const png = await page.screenshot({ type: 'png' });
    await sharp(png).resize({ width: 344 }).webp({ quality: 72 }).toFile(path.join(out, `${style.id}.webp`));
    await page.close();
    console.log(`poster ${style.id}`);
  }
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
