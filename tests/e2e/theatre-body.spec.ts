import { expect, test, type Page } from '@playwright/test';
import {
  BODY_CATEGORIES,
  bodyMenus,
  contrastOf,
  dishName,
  expectArabicRtl,
  expectEverySectionReachable,
  expectFirstScreen,
  expectFocusRingShows,
  expectJumpsTo,
  expectOpensProduct,
  expectQuickAdd,
  expectReadable,
  expectStripStays,
  openMenu,
  paletteIdsOf,
} from './helpers/body-menu';

/**
 * The Curtain and Spotlight body (spec 2026-10-26-menu-styles-in-templates-design.md): every section a stage (velvet
 * curtains at its sides, a banner on the pelmet with the act and the dish count), every dish a performer on the stage
 * floor (an arch-topped photo card with a price ticket and a name plate), three across; a spotlight cone on the stage in
 * view with the others dimmed; a sticky programme strip of act chips; curtains that part once per stage.
 */

const menus = bodyMenus();
const slug = menus.slug('thr');
const arabSlug = menus.slug('thrar');
/** The shape's own alternative palettes. */
const alternatives = paletteIdsOf('the-curtain-and-spotlight').slice(1);
const paletteSlug = (id: string) => menus.slug(`thr-${id}`);

test.beforeAll(async () => {
  // The preset's own layout (its compact hero): what a restaurant that picks the template gets.
  await menus.create(slug, 'theatre', { templateId: 'the-curtain-and-spotlight' });
  // Arabic-Indic numerals, and the croissant 20% off: the sale chip.
  await menus.create(arabSlug, 'theatre', { templateId: 'the-curtain-and-spotlight', numeralSystem: 'ARAB', discount: ['croissant'] });
  // The eclair 20% off on the alternatives: the sale chip read on every palette.
  for (const id of alternatives) await menus.create(paletteSlug(id), 'theatre', { templateId: 'the-curtain-and-spotlight', paletteId: id, discount: ['eclair'] });
});
test.afterAll(() => menus.remove());

const theatre = (page: Page) => page.locator('[data-body="theatre"]');
const programme = (page: Page) => theatre(page).locator('[data-programme]');
const performers = (page: Page) => theatre(page).locator('[data-row]');
const entry = (page: Page, categorySlug: string) => programme(page).getByRole('button', { name: new RegExp(BODY_CATEGORIES.find((c) => c.slug === categorySlug)!.name.en!) });

test('on a phone the first screen shows at least four performers with photos, prices and names, and every stage is one tap away', async ({ page }) => {
  await openMenu(page, slug);
  await expect(theatre(page)).toBeVisible();
  await expectFirstScreen(page, performers(page), { min: 4 });
  await expectEverySectionReachable(programme(page));
});

test('every section is a stage under a pelmet banner (act, name and dish count), all on the page at once', async ({ page }) => {
  await openMenu(page, slug);
  const stages = theatre(page).locator('section[data-stage]');
  expect(await stages.count()).toBe(BODY_CATEGORIES.length);
  await expect(stages.first().locator('[data-count]')).toHaveText('3');
  await expect(theatre(page).locator('#cat-bread [data-count]')).toHaveText('1');
  const heading = stages.first().getByRole('heading', { name: /Viennoiserie/ });
  await expect(heading).toBeVisible();
  await expect(heading).toContainText('Act 1');
  // Each stage has its two curtains.
  await expect(stages.first().locator('.th-curtain')).toHaveCount(2);
});

test('the performers stand three across on the floor: photo with a price ticket, name plate below', async ({ page }) => {
  await openMenu(page, slug);
  const cells = page.locator('#cat-viennoiserie [data-row]');
  expect(await cells.count()).toBe(3);
  const boxes = await Promise.all([0, 1, 2].map(async (i) => (await cells.nth(i).boundingBox())!));
  expect(Math.abs(boxes[0]!.y - boxes[1]!.y)).toBeLessThanOrEqual(1);
  expect(boxes[0]!.x).toBeLessThan(boxes[1]!.x);
  expect(boxes[1]!.x).toBeLessThan(boxes[2]!.x);
  const photo = (await cells.first().locator('[data-photo]').boundingBox())!;
  const ticket = (await cells.first().locator('.th-ticket').boundingBox())!;
  const name = (await cells.first().locator('.th-name').boundingBox())!;
  expect(ticket.y).toBeGreaterThanOrEqual(photo.y);
  expect(ticket.y + ticket.height).toBeLessThanOrEqual(photo.y + photo.height + 1);
  expect(name.y).toBeGreaterThanOrEqual(photo.y + photo.height - 1);
  await expect(cells.first().locator('.th-ticket')).toContainText('$');
  // The floor line under the card, and an arch on its top.
  const floor = await cells.first().evaluate((node) => getComputedStyle(node, '::after').content);
  expect(floor).not.toBe('none');
  expect(await cells.first().evaluate((node) => parseFloat(getComputedStyle(node).borderTopLeftRadius))).toBeGreaterThan(20);
});

test('a programme chip takes you to its stage and focuses the banner', async ({ page }) => {
  await openMenu(page, slug);
  await expectJumpsTo(page, entry(page, 'celebration'), 'celebration');
});

test('the programme strip lights the stage in view', async ({ page }) => {
  await openMenu(page, slug);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(programme(page).locator('[aria-current="true"]')).toHaveCount(1);
  await expect(entry(page, 'bread')).toHaveAttribute('aria-current', 'true');
});

test('the programme strip stays at the top: scrolled to the end, the first stage is still one tap away', async ({ page }) => {
  await openMenu(page, slug);
  await expectStripStays(page, programme(page), entry(page, 'viennoiserie'), 'viennoiserie');
});

test('the spotlight is on the stage in view and the others are dimmed, only on the backdrop', async ({ page }) => {
  await openMenu(page, slug);
  const first = page.locator('#cat-viennoiserie');
  const other = page.locator('#cat-bread');
  await expect(first).toHaveAttribute('data-lit', '');
  await expect(other).not.toHaveAttribute('data-lit', '');
  await expect(first.locator('.th-cone')).toHaveCSS('opacity', '1');
  await expect(other.locator('.th-cone')).toHaveCSS('opacity', '0');
  await expect(first.locator('.th-backdrop')).toHaveCSS('opacity', '1');
  const dim = Number(await other.locator('.th-backdrop').evaluate((node) => getComputedStyle(node).opacity));
  expect(dim).toBeLessThan(1);
  // The text of the dishes is never dimmed: no opacity on a stage, a card, a name or a ticket.
  for (const node of [other, other.locator('[data-row]').first(), other.locator('.th-name').first(), other.locator('.th-ticket').first()]) await expect(node).toHaveCSS('opacity', '1');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(other).toHaveAttribute('data-lit', '');
  await expect(first).not.toHaveAttribute('data-lit', '');
});

test('a stage opens its curtains once, when it first comes into view, and never plays again', async ({ page }) => {
  await openMenu(page, slug);
  const stage = page.locator('#cat-viennoiserie');
  await expect(stage).toHaveAttribute('data-open', '');
  const curtain = stage.locator('.th-curtain-s');
  const gathered = async () => {
    const stageBox = (await stage.boundingBox())!;
    const box = (await curtain.boundingBox())!;
    return box.x + box.width - stageBox.x;
  };
  // Parted: the drape is gathered at the side (a small part of the stage), not shut across it.
  await expect.poll(gathered, { timeout: 5000 }).toBeLessThan(60);
  await expect.poll(() => curtain.evaluate((node) => node.getAnimations().length), { timeout: 5000 }).toBe(0);
  // A search and its clearing re-render the sections; the curtains do not close and open again.
  const search = page.getByRole('searchbox', { name: 'Search the menu' });
  await search.fill('croissant');
  await search.fill('');
  await expect(stage).toHaveAttribute('data-open', '');
  expect(await curtain.evaluate((node) => node.getAnimations().length)).toBe(0);
  expect(await gathered()).toBeLessThan(60);
});

test('a stage below the first screen has its curtains drawn until it comes into view', async ({ page }) => {
  await openMenu(page, slug);
  const far = page.locator('#cat-bread');
  await expect(far).not.toHaveAttribute('data-open', '');
  await far.scrollIntoViewIfNeeded();
  await expect(far).toHaveAttribute('data-open', '');
});

test('a performer opens its dish and adds one, and its photo is a tap target too', async ({ page }) => {
  await openMenu(page, slug);
  const first = page.locator('#cat-viennoiserie');
  await expectOpensProduct(page, first, 'croissant');
  await expectQuickAdd(page, first, 'croissant');
  const box = (await performers(page).first().locator('[data-photo]').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('a long dish name and a long price stay inside the card without sideways scrolling', async ({ page }) => {
  await openMenu(page, slug);
  const cell = performers(page).first();
  await cell.locator('.th-name').evaluate((node) => {
    node.textContent = 'A very long dish name that keeps going and going so that it wraps onto many many lines';
  });
  await cell.locator('.th-ticket').evaluate((node) => {
    node.textContent = 'From 123,456,789 IQD per portion';
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  const lines = await cell.locator('.th-name').evaluate((node) => Math.round(node.getBoundingClientRect().height / parseFloat(getComputedStyle(node).lineHeight)));
  expect(lines).toBeLessThanOrEqual(2);
  const box = (await cell.boundingBox())!;
  const ticket = (await cell.locator('.th-ticket').boundingBox())!;
  expect(ticket.x).toBeGreaterThanOrEqual(box.x - 1);
  expect(ticket.x + ticket.width).toBeLessThanOrEqual(box.x + box.width + 1);
  const photo = (await cell.locator('[data-photo]').boundingBox())!;
  expect(ticket.y + ticket.height).toBeLessThanOrEqual(photo.y + photo.height + 1);
});

test('on a wide screen a stage stays a tidy row of four performers', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/${slug}/en?stage=off`);
  const cells = page.locator('#cat-viennoiserie [data-row]');
  const a = (await cells.nth(0).boundingBox())!;
  const c = (await cells.nth(2).boundingBox())!;
  expect(Math.abs(a.y - c.y)).toBeLessThanOrEqual(1);
  expect(c.x + c.width - a.x).toBeLessThanOrEqual(640);
});

test('acts and counts use the tenant numerals', async ({ page }) => {
  await page.goto(`/${arabSlug}/en?stage=off`);
  const first = theatre(page).locator('section[data-stage]').first();
  await expect(first.locator('[data-count]')).toHaveText('٣');
  await expect(first.getByRole('heading')).toContainText('Act ١');
  await expect(programme(page).locator('small').first()).toHaveText('١');
});

test('in Arabic the page is right to left, the stage mirrors and nothing scrolls sideways', async ({ page }) => {
  await expectArabicRtl(page, slug, (p) => programme(p));
  const cells = page.locator('#cat-viennoiserie [data-row]');
  const a = (await cells.nth(0).boundingBox())!;
  const b = (await cells.nth(1).boundingBox())!;
  expect(a.x).toBeGreaterThan(b.x);
  // The start curtain moves to the right-hand side.
  const stage = (await page.locator('#cat-viennoiserie').boundingBox())!;
  const start = (await page.locator('#cat-viennoiserie .th-curtain-s').boundingBox())!;
  expect(start.x + start.width / 2).toBeGreaterThan(stage.x + stage.width / 2);
});

test('reduced motion: the curtains are simply parted and no transition runs', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openMenu(page, slug);
  await expect(theatre(page)).not.toHaveAttribute('data-armed', '');
  await expect(page.locator('#cat-bread')).not.toHaveAttribute('data-open', '');
  const bread = page.locator('#cat-bread .th-curtain-s');
  await expect(bread).toHaveCSS('transition-duration', '0s');
  await expect(performers(page).first()).toHaveCSS('animation-name', 'none');
  const stage = (await page.locator('#cat-bread').boundingBox())!;
  const box = (await bread.boundingBox())!;
  expect(box.x + box.width - stage.x).toBeLessThan(60);
});

test('a search that finds nothing keeps main#menu', async ({ page }) => {
  await openMenu(page, slug);
  await page.getByRole('searchbox', { name: 'Search the menu' }).fill('zzzzqq');
  await expect(page.locator('main#menu')).toHaveCount(1);
});

test('text reads on every fill it sits on, in every palette of the shape', async ({ page }) => {
  const menusToCheck: [string, string][] = [['signature', slug], ...alternatives.map((id): [string, string] => [id, paletteSlug(id)])];
  for (const [menu, menuSlug] of menusToCheck) {
    await openMenu(page, menuSlug);
    // Scrolled a little, so a strip entry is lit; the first stage is still on the screen.
    await page.evaluate(() => window.scrollBy(0, 40));
    await expect(programme(page).locator('[aria-current="true"]')).toHaveCount(1);
    const stage = page.locator('#cat-viennoiserie');
    await expectReadable(menu, {
      'unlit chip': programme(page).locator('.th-chip:not([aria-current="true"])').first(),
      'unlit chip number': programme(page).locator('.th-chip:not([aria-current="true"]) small').first(),
      'lit chip': programme(page).locator('[aria-current="true"]'),
      'lit chip number': programme(page).locator('[aria-current="true"] small'),
      'pelmet banner': stage.locator('.th-banner'),
      'act label': stage.locator('.th-banner small'),
      'dish count': stage.locator('.th-banner b'),
      'price ticket': stage.locator('.th-ticket').first(),
      'name plate': stage.locator('.th-name').first(),
      'add button': stage.locator('.th-add').first(),
      ...(menu === 'signature' ? {} : { 'sale chip': theatre(page).locator('.tpl-off').first() }),
    });
    // A dimmed stage keeps its text: the cards of an unlit stage still read.
    await expectReadable(`${menu} (unlit stage)`, { 'name plate': page.locator('#cat-bread .th-name').first(), 'price ticket': page.locator('#cat-bread .th-ticket').first() });
  }
});

test('keyboard focus rings show in full and stand out, in every palette: a whole performer and a strip entry', async ({ page }) => {
  for (const menuSlug of [slug, ...alternatives.map(paletteSlug)]) {
    await openMenu(page, menuSlug);
    const cell = performers(page).first();
    const name = cell.locator('.th-name');
    await name.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(name).toBeFocused();
    await expectFocusRingShows(page, cell, { outset: -2, pseudo: '::after' });
    const chip = entry(page, 'patisserie');
    await chip.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(chip).toBeFocused();
    await expectFocusRingShows(page, chip, { outset: -4 });
  }
});

test('a dish on sale shows a −NN% chip in the menu numerals on its card, and keeps the regular price for screen readers', async ({ page }) => {
  await openMenu(page, arabSlug);
  const cell = performers(page).filter({ hasText: dishName('croissant') });
  const chip = cell.locator('.tpl-off');
  await expect(chip).toHaveText('−٢٠%');
  await expect(theatre(page).locator('.tpl-off')).toHaveCount(1);
  const box = (await cell.boundingBox())!;
  const at = (await chip.boundingBox())!;
  expect(at.x).toBeGreaterThanOrEqual(box.x - 1);
  expect(at.x + at.width).toBeLessThanOrEqual(box.x + box.width + 1);
  expect(await contrastOf(chip)).toBeGreaterThanOrEqual(4.5);
  await expect(cell.locator('.tpl-was .sr-only')).toHaveText(/[\d٠-٩]/);
});

/** How much of a stage's start curtain is drawn across it (px from the stage's start edge to the curtain's far edge). */
const drawnAcross = (page: Page, stageId: string) =>
  page.locator(`#${stageId}`).evaluate((stage) => {
    const curtain = stage.querySelector('.th-curtain-s')!.getBoundingClientRect();
    const box = stage.getBoundingClientRect();
    return getComputedStyle(document.documentElement).direction === 'rtl' ? box.right - curtain.left : curtain.right - box.left;
  });

/** An IntersectionObserver that never reports (a background tab, an unpainted preview). */
const silenceObserver = (page: Page) =>
  page.addInitScript(() => {
    window.IntersectionObserver = class {
      readonly root = null;
      readonly rootMargin = '';
      readonly thresholds = [];
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    } as unknown as typeof IntersectionObserver;
  });

test('the first screen is never covered: the stages on it at load are never seen with their curtains shut', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  // From the first script on, every frame for 2s: is the first performer's centre under a curtain?
  await page.addInitScript(() => {
    const hits: string[] = [];
    (window as unknown as { curtainHits: string[] }).curtainHits = hits;
    const start = performance.now();
    const sample = () => {
      const cell = document.querySelector('[data-body="theatre"] [data-row]');
      if (cell) {
        // The curtains take no taps (pointer-events: none), so the check is by their boxes, not elementFromPoint.
        const box = cell.getBoundingClientRect();
        const x = box.left + box.width / 2;
        const y = box.top + box.height / 2;
        const covered = [...document.querySelectorAll('.th-curtain')].some((curtain) => {
          const c = curtain.getBoundingClientRect();
          return x > c.left && x < c.right && y > c.top && y < c.bottom;
        });
        if (covered) hits.push(`${Math.round(performance.now() - start)}ms`);
      }
      if (performance.now() - start < 2000) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.goto(`/${slug}/en?stage=off`);
  await expect(theatre(page)).toHaveAttribute('data-armed', '');
  await page.waitForTimeout(2100);
  expect(await page.evaluate(() => (window as unknown as { curtainHits: string[] }).curtainHits)).toEqual([]);
  // A stage below the first screen still waits for its entrance.
  await expect(page.locator('#cat-bread')).not.toHaveAttribute('data-open', '');
});

test('with an observer that never reports, the stages still open: at once on the first screen, and when scrolled to', async ({ page }) => {
  await silenceObserver(page);
  await openMenu(page, slug);
  await expect(theatre(page)).toHaveAttribute('data-armed', '');
  await expect.poll(() => drawnAcross(page, 'cat-viennoiserie'), { timeout: 5000 }).toBeLessThan(60);
  await page.locator('#cat-bread').scrollIntoViewIfNeeded();
  await expect(page.locator('#cat-bread')).toHaveAttribute('data-open', '', { timeout: 5000 });
  await expect.poll(() => drawnAcross(page, 'cat-bread'), { timeout: 5000 }).toBeLessThan(60);
});

test('a stage taller than ten screens opens when it is scrolled into', async ({ page }) => {
  await openMenu(page, slug);
  const tall = page.locator('#cat-patisserie');
  await expect(tall).not.toHaveAttribute('data-open', '');
  await tall.locator('.th-floor').evaluate((floor) => {
    (floor as HTMLElement).style.minBlockSize = `${window.innerHeight * 12}px`;
  });
  await tall.evaluate((stage) => window.scrollTo(0, window.scrollY + stage.getBoundingClientRect().top + window.innerHeight * 2));
  await expect(tall).toHaveAttribute('data-open', '', { timeout: 5000 });
});

test('keyboard focus in a stage that has not opened opens it for good: tabbing out does not draw the curtains again', async ({ page }) => {
  await silenceObserver(page);
  await openMenu(page, slug);
  const far = page.locator('#cat-bread');
  await expect(theatre(page)).toHaveAttribute('data-armed', '');
  await expect(far).not.toHaveAttribute('data-open', '');
  // Focus moves in and out without scrolling (the stage stays off the screen, so only the focus can open it).
  await far.locator('.th-name').first().evaluate((node) => (node as HTMLElement).focus({ preventScroll: true }));
  await expect(far).toHaveAttribute('data-open', '');
  await entry(page, 'viennoiserie').evaluate((node) => (node as HTMLElement).focus({ preventScroll: true }));
  await page.waitForTimeout(1600);
  expect(await drawnAcross(page, 'cat-bread')).toBeLessThan(60);
});
