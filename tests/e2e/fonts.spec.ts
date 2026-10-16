import { expect, test, type Page } from '@playwright/test';

interface FontDownload {
  family: string;
  bytes: number;
}

/**
 * Loads a page in a real browser and reports every font file it downloaded (preloads included), with the
 * family each one belongs to. Families come from the page's own @font-face rules, so the test does not
 * depend on how Next names or hashes the files.
 */
async function fontDownloads(page: Page, path: string): Promise<FontDownload[]> {
  const responses: Array<{ url: string; body: Promise<Buffer> }> = [];
  page.on('response', (response) => {
    if (response.request().resourceType() === 'font') responses.push({ url: response.url(), body: response.body() });
  });
  await page.goto(path, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);

  const familyByFile = await page.evaluate(() => {
    const found: Record<string, string> = {};
    const visit = (rules: CSSRuleList) => {
      for (const rule of Array.from(rules)) {
        if (rule instanceof CSSFontFaceRule) {
          const family = rule.style.getPropertyValue('font-family').replace(/["']/g, '').trim();
          const file = /url\(["']?([^"')]+\.woff2)/.exec(rule.style.getPropertyValue('src'))?.[1];
          if (family && file) found[file.split('/').pop() as string] = family;
        } else if ('cssRules' in rule) {
          visit((rule as CSSGroupingRule).cssRules);
        }
      }
    };
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        visit(sheet.cssRules);
      } catch {
        // A cross-origin sheet cannot be read; the fonts here are same-origin.
      }
    }
    return found;
  });

  return Promise.all(
    responses.map(async ({ url, body }) => {
      const file = new URL(url).pathname.split('/').pop() as string;
      return { family: familyByFile[file] ?? `unknown:${file}`, bytes: (await body).length };
    }),
  );
}

const families = (fonts: FontDownload[]) => [...new Set(fonts.map((font) => font.family))].sort();

/** The `font-weight` each family's @font-face rules declare, e.g. `{ 'Hanken Grotesk': ['400'] }`. */
async function declaredWeights(page: Page, path: string): Promise<Record<string, string[]>> {
  await page.goto(path);
  return page.evaluate(() => {
    const found: Record<string, Set<string>> = {};
    const visit = (rules: CSSRuleList) => {
      for (const rule of Array.from(rules)) {
        if (rule instanceof CSSFontFaceRule) {
          const family = rule.style.getPropertyValue('font-family').replace(/["']/g, '').trim();
          (found[family] ??= new Set()).add(rule.style.getPropertyValue('font-weight').trim());
        } else if ('cssRules' in rule) {
          visit((rule as CSSGroupingRule).cssRules);
        }
      }
    };
    for (const sheet of Array.from(document.styleSheets)) visit(sheet.cssRules);
    return Object.fromEntries(Object.entries(found).map(([family, weights]) => [family, [...weights]]));
  });
}

test.describe('font weights', () => {
  // The interface sets everything in the regular weight, so every face is loaded at 400 only instead of as a
  // full variable range. Bodoni keeps its optical-size axis, which the display type uses.
  test('the Latin text face is a single regular weight', async ({ page }) => {
    expect((await declaredWeights(page, '/atelier/en'))['Hanken Grotesk']).toEqual(['400']);
  });

  test('the display face is a single regular weight', async ({ page }) => {
    expect((await declaredWeights(page, '/atelier/en'))['bodoni']).toEqual(['400']);
  });

  test('the Arabic face is a single regular weight', async ({ page }) => {
    expect((await declaredWeights(page, '/atelier/ar'))['Noto Naskh Arabic']).toEqual(['400']);
  });

  for (const locale of ['en', 'ar', 'ckb']) {
    test(`nothing on the ${locale} menu asks for a heavier weight than the faces provide`, async ({ page }) => {
      await page.goto(`/atelier/${locale}`);
      await page.evaluate(() => document.fonts.ready);
      const heavy = await page.evaluate(() =>
        Array.from(document.body.querySelectorAll('*'))
          .filter((element) => Number(getComputedStyle(element).fontWeight) > 400)
          .map((element) => element.tagName.toLowerCase() + '.' + element.className),
      );
      expect(heavy).toEqual([]);
    });
  }
});

test.describe('font downloads', () => {
  // `bodoni` is the bundled Bodoni Moda (src/app/fonts): next/font/local names the family after its export.
  test('an English page downloads only the Latin faces', async ({ page }) => {
    expect(families(await fontDownloads(page, '/atelier/en'))).toEqual(['Hanken Grotesk', 'bodoni']);
  });

  test('an Arabic page downloads only the Arabic face', async ({ page }) => {
    expect(families(await fontDownloads(page, '/atelier/ar'))).toEqual(['Noto Naskh Arabic']);
  });

  test('a Sorani page downloads only the Arabic face', async ({ page }) => {
    expect(families(await fontDownloads(page, '/atelier/ckb'))).toEqual(['Noto Naskh Arabic']);
  });

  // Font bytes compete with the scripts and stylesheet for the same slow connection, so they have a budget.
  test('an English page downloads under 45 KB of fonts', async ({ page }) => {
    const bytes = (await fontDownloads(page, '/atelier/en')).reduce((sum, font) => sum + font.bytes, 0);
    expect(bytes).toBeLessThan(45 * 1024);
  });

  test('an Arabic page downloads under 70 KB of fonts', async ({ page }) => {
    const bytes = (await fontDownloads(page, '/atelier/ar')).reduce((sum, font) => sum + font.bytes, 0);
    expect(bytes).toBeLessThan(70 * 1024);
  });
});
