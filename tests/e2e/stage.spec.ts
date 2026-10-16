import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const PLAIN = 'bun-bottom,lettuce,tomato,patty,pickles,bun-top';
const WITH_CHEESE = 'bun-bottom,lettuce,tomato,patty,cheese,pickles,bun-top';
const WITH_BOTH = 'bun-bottom,lettuce,tomato,patty,patty-2,cheese,pickles,bun-top';
const WITH_DOUBLE = 'bun-bottom,lettuce,tomato,patty,patty-2,pickles,bun-top';
const CUP = 'saucer,cup,coffee';

// Software WebGL in headless Chromium is slow to start; the stage reports its state, so the tests wait on that.
const READY = { timeout: 25_000 };

async function audit(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  return results.violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(' | ')}`);
}

async function openFromList(page: Page, name: string, query = '?stage=on') {
  await page.goto(`/atelier/en${query}`);
  await page.getByTestId('product-row').filter({ hasText: name }).getByRole('button').first().click();
  return page.getByRole('dialog');
}

test.describe('3D stage', () => {
  // Several software-WebGL browsers start at once in CI-style runs; give each test room beyond the wait.
  test.describe.configure({ timeout: 90_000 });

  test('the hero keeps its illustration until the live stage is ready, when its dish has a stage', async ({ page }) => {
    await page.goto('/atelier/en?stage=on');
    // The signature changes with the daypart. Burgers and coffee cups have a stage; pastries do not yet.
    const title = (await page.locator('#signature-title').textContent()) ?? '';
    const hero = page.getByTestId('hero-stage');
    if (/Burger|White|Espresso|Cappuccino|Cortado|Matcha|Earl Grey/.test(title)) {
      await expect(hero).toHaveAttribute('data-stage-state', 'ready', READY);
      await expect(hero.locator('canvas')).toHaveCount(1);
      await expect(hero).toHaveAttribute('role', 'img');
      await expect(hero).toHaveAccessibleName(new RegExp(title.trim()));
    } else {
      await expect(hero).toHaveCount(0);
    }
  });

  test('the burger page shows the plain stack as a live 3D stage', async ({ page }) => {
    await page.goto('/atelier/en/p/atelier-burger?stage=on');
    const stage = page.getByTestId('sheet-stage');
    await expect(stage).toHaveAttribute('data-stage-layers', PLAIN);
    await expect(stage).toHaveAttribute('data-stage-state', 'ready', READY);
    await expect(stage.locator('canvas')).toHaveCount(1);
    await expect(stage).toHaveAccessibleName(/Atelier Burger/);
  });

  test('the croissant, the mille-feuille and the lemonade have their own models', async ({ page }) => {
    for (const [slug, layers] of [
      ['croissant', 'croissant'],
      ['mille-feuille', 'puff-1,cream-1,puff-2,cream-2,puff-3,icing'],
      ['yuzu-lemonade', 'glass,liquid,ice,lemon'],
    ] as const) {
      await page.goto(`/atelier/en/p/${slug}?stage=on`);
      const stage = page.getByTestId('sheet-stage');
      await expect(stage).toHaveAttribute('data-stage-layers', layers);
      await expect(stage).toHaveAttribute('data-stage-state', 'ready', READY);
    }
  });

  test('the coffee page shows a cup on a saucer', async ({ page }) => {
    await page.goto('/atelier/en/p/flat-white?stage=on');
    const stage = page.getByTestId('sheet-stage');
    await expect(stage).toHaveAttribute('data-stage-layers', CUP);
    await expect(stage).toHaveAttribute('data-stage-state', 'ready', READY);
    await expect(stage).toHaveAccessibleName(/Flat White/);
  });

  test('choosing extras changes the model and its description', async ({ page }) => {
    const dialog = await openFromList(page, 'Atelier Burger');
    const stage = dialog.getByTestId('sheet-stage');
    await expect(stage).toHaveAttribute('data-stage-state', 'ready', READY);
    await expect(stage).toHaveAttribute('data-stage-layers', PLAIN);

    await dialog.getByRole('checkbox', { name: /Premium cheese/ }).check();
    await expect(stage).toHaveAttribute('data-stage-layers', WITH_CHEESE);
    await expect(stage).toHaveAccessibleName(/with Premium cheese/);

    await dialog.getByRole('checkbox', { name: /Double patty/ }).check();
    await expect(stage).toHaveAttribute('data-stage-layers', WITH_BOTH);
    await expect(stage).toHaveAccessibleName(/Premium cheese and Double patty/);

    await dialog.getByRole('checkbox', { name: /Premium cheese/ }).uncheck();
    await expect(stage).toHaveAttribute('data-stage-layers', WITH_DOUBLE);
  });

  test('rapid toggling settles on the last choice', async ({ page }) => {
    const dialog = await openFromList(page, 'Atelier Burger');
    const stage = dialog.getByTestId('sheet-stage');
    await expect(stage).toHaveAttribute('data-stage-state', 'ready', READY);
    const cheese = dialog.getByRole('checkbox', { name: /Premium cheese/ });
    await cheese.check();
    await cheese.uncheck();
    await cheese.check();
    await expect(stage).toHaveAttribute('data-stage-layers', WITH_CHEESE);
  });

  test('a dish opened as soon as the page has loaded keeps the ?stage=on choice', async ({ page }) => {
    // A tap made while the page hydrates is replayed by React before plain effects run, and opening the dish replaces the
    // address: the choice must be remembered before that (this suite's browsers start with 3D switched off). The tap
    // lands in that moment in some runs, not every one: about one in four before the fix, as for every test here that
    // opens a dish from the list.
    await page.goto('/atelier/en?stage=on');
    await page.getByTestId('product-row').filter({ hasText: 'Atelier Burger' }).getByRole('button').first().click();
    const stage = page.getByRole('dialog').getByTestId('sheet-stage');
    await expect(stage).toHaveAttribute('data-stage-state', 'ready', READY);
    expect(await page.evaluate(() => localStorage.getItem('atelier:stage'))).toBe('on');
  });

  test('keeps the illustration when 3D is switched off', async ({ page }) => {
    await page.goto('/atelier/en/p/atelier-burger?stage=off');
    const stage = page.getByTestId('sheet-stage');
    await expect(stage).toHaveAttribute('data-stage-state', 'unavailable');
    await expect(stage.locator('canvas')).toHaveCount(0);
    await expect(stage.locator('svg').first()).toBeVisible();
  });

  test('the menu with its live hero stage has no serious accessibility violations', async ({ page }) => {
    await page.goto('/atelier/en?stage=on');
    const hero = page.getByTestId('hero-stage');
    if ((await hero.count()) > 0) await expect(hero).toHaveAttribute('data-stage-state', 'ready', READY);
    expect(await audit(page)).toEqual([]);
  });

  for (const [name, path] of [
    ['burger page', '/atelier/en/p/atelier-burger?stage=on'],
    ['cup page in Arabic', '/atelier/ar/p/flat-white?stage=on'],
  ] as const) {
    test(`the ${name} with its live stage has no serious accessibility violations`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByTestId('sheet-stage')).toHaveAttribute('data-stage-state', 'ready', READY);
      expect(await audit(page)).toEqual([]);
    });
  }

  test('an open product sheet with its live stage has no serious accessibility violations', async ({ page }) => {
    const dialog = await openFromList(page, 'Atelier Burger');
    await expect(dialog.getByTestId('sheet-stage')).toHaveAttribute('data-stage-state', 'ready', READY);
    expect(await audit(page)).toEqual([]);
  });

  test('dishes without a model keep their illustration and have no stage', async ({ page }) => {
    // No 3D needed for this one, so it runs with the suite's default of 3D off and stays out of WebGL's way.
    const dialog = await openFromList(page, 'Basque Cheesecake', '');
    await expect(dialog.getByRole('heading', { name: 'Basque Cheesecake' })).toBeVisible();
    await expect(dialog.getByTestId('sheet-stage')).toHaveCount(0);
  });
});
