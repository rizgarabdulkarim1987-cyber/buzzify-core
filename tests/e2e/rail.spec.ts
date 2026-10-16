import { expect, test, type Locator, type Page } from '@playwright/test';

// The category rail moves in the style the restaurant picked in its brand settings (ATELIER: the fanned
// deck). `?rail=` previews another style.

const centreX = async (element: Locator) => {
  const box = (await element.boundingBox()) as { x: number; width: number };
  return box.x + box.width / 2;
};

const viewportCentre = (page: Page) => (page.viewportSize() as { width: number }).width / 2;

async function stickRail(page: Page) {
  // Bring the rail to the top of the screen, as it is while the guest reads the menu.
  await page.evaluate(() => {
    const nav = document.querySelector('nav[data-rail-style]') as HTMLElement;
    window.scrollTo(0, nav.getBoundingClientRect().top + window.scrollY);
  });
}

test.describe('category rail: fanned deck', () => {
  test("uses the restaurant's chosen style", async ({ page }) => {
    await page.goto('/atelier/en');
    await expect(page.locator('nav[data-rail-style="deck"]')).toBeVisible();
  });

  test('tapping a card brings it to the front of the fan', async ({ page }) => {
    await page.goto('/atelier/en');
    const rail = page.getByRole('navigation', { name: 'Menu categories' });
    await expect(rail).toHaveAttribute('data-rail-style', 'deck');
    await stickRail(page);
    const plates = rail.getByRole('link', { name: 'Plates' });
    expect(Math.abs((await centreX(plates)) - viewportCentre(page))).toBeGreaterThan(100);
    await plates.click();
    await expect(plates).toHaveAttribute('aria-current', 'true');
    await expect.poll(async () => Math.abs((await centreX(plates)) - viewportCentre(page))).toBeLessThan(4);
  });

  test('the new card glides to the front instead of jumping', async ({ page }) => {
    await page.goto('/atelier/en');
    const rail = page.getByRole('navigation', { name: 'Menu categories' });
    await expect(rail).toHaveAttribute('data-rail-style', 'deck');
    await stickRail(page);
    await page.evaluate(() => {
      const card = document.querySelectorAll('nav[data-rail-style] a')[2] as HTMLElement;
      const samples: number[] = [];
      (window as unknown as { __deck: number[] }).__deck = samples;
      const until = performance.now() + 1100;
      const tick = () => {
        const box = card.getBoundingClientRect();
        samples.push(box.left + box.width / 2);
        if (performance.now() < until) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await rail.getByRole('link', { name: 'Plates' }).click();
    await page.waitForTimeout(1200);
    const samples = await page.evaluate(() => (window as unknown as { __deck: number[] }).__deck);
    const start = samples[0] as number;
    const end = samples[samples.length - 1] as number;
    expect(Math.abs(end - start)).toBeGreaterThan(100);
    const between = samples.filter((x) => x > Math.min(start, end) + 5 && x < Math.max(start, end) - 5);
    expect(between.length).toBeGreaterThan(2);
  });

  test('dragging the fan looks through the deck without leaving the category', async ({ page }) => {
    await page.goto('/atelier/en');
    const rail = page.getByRole('navigation', { name: 'Menu categories' });
    await expect(rail).toHaveAttribute('data-rail-style', 'deck');
    await stickRail(page);
    const first = rail.getByRole('link').first();
    await expect(first).toHaveAttribute('aria-current', 'true');
    const box = (await rail.boundingBox()) as { x: number; y: number; width: number; height: number };
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width * 0.8, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.5, y, { steps: 6 });
    await page.mouse.move(box.x + box.width * 0.2, y, { steps: 6 });
    await page.mouse.up();
    // About three cards along: Pâtisserie is now at the front, and the guest is still on the first category.
    const patisserie = rail.getByRole('link', { name: 'Pâtisserie' });
    await expect.poll(async () => Math.abs((await centreX(patisserie)) - viewportCentre(page))).toBeLessThan(4);
    await expect(first).toHaveAttribute('aria-current', 'true');
  });

  test('fans toward the left in right-to-left languages', async ({ page }) => {
    await page.goto('/atelier/ar');
    const rail = page.locator('nav[data-rail-style="deck"]');
    await expect(rail).toBeVisible();
    const links = rail.getByRole('link');
    expect(await centreX(links.nth(1))).toBeLessThan(await centreX(links.nth(0)));
  });

  test('?rail= previews another style', async ({ page }) => {
    await page.goto('/atelier/en?rail=plain');
    await expect(page.locator('nav[data-rail-style="plain"]')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Menu categories' }).getByRole('link')).toHaveCount(5);
  });
});

test.describe('category rail: fanned deck with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('cards move without a transition', async ({ page }) => {
    await page.goto('/atelier/en');
    const rail = page.locator('nav[data-rail-style="deck"]');
    await expect(rail).toBeVisible();
    const duration = await rail
      .getByRole('link')
      .first()
      .evaluate((element) => parseFloat(getComputedStyle(element).transitionDuration));
    expect(duration).toBeLessThan(0.01);
  });
});

test.describe('category rail: grain dishes', () => {
  test('the dish forms in grains above the active category once the page is idle', async ({ page }) => {
    await page.goto('/atelier/en?rail=grains');
    const rail = page.locator('nav[data-rail-style="grains"]');
    await expect(rail).toHaveAttribute('data-grains', 'live', { timeout: 15_000 });
    // Give the first dish time to rise, then check the canvas has grains drawn on it.
    await page.waitForTimeout(1800);
    const lit = await page.evaluate(() => {
      const canvas = document.querySelector('nav[data-rail-style="grains"] ~ canvas') as HTMLCanvasElement;
      const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      let count = 0;
      for (let i = 3; i < pixels.length; i += 4) if (pixels[i]! > 0) count += 1;
      return count;
    });
    expect(lit).toBeGreaterThan(200);
  });

  test('tapping a category moves its dish over to it', async ({ page }) => {
    await page.goto('/atelier/en?rail=grains');
    const rail = page.getByRole('navigation', { name: 'Menu categories' });
    await expect(rail).toHaveAttribute('data-grains', 'live', { timeout: 15_000 });
    const plates = rail.getByRole('link', { name: 'Plates' });
    await plates.click();
    await expect(plates).toHaveAttribute('aria-current', 'true');
  });
});

test.describe('category rail: grain dishes with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('shows a still drawing of the dish and never starts the grains', async ({ page }) => {
    await page.goto('/atelier/en?rail=grains');
    const rail = page.locator('nav[data-rail-style="grains"]');
    await expect(rail.locator('[aria-current="true"] [data-dish-slot] svg')).toBeVisible();
    await page.waitForTimeout(2500);
    await expect(rail).toHaveAttribute('data-grains', 'still');
  });
});

test.describe('category rail: drum', () => {
  test('tapping the next name turns the drum to bring it to the front', async ({ page }) => {
    await page.goto('/atelier/en?rail=drum');
    const rail = page.getByRole('navigation', { name: 'Menu categories' });
    await expect(rail).toHaveAttribute('data-rail-style', 'drum');
    await stickRail(page);
    const breakfast = rail.getByRole('link', { name: 'Breakfast' });
    expect(Math.abs((await centreX(breakfast)) - viewportCentre(page))).toBeGreaterThan(60);
    await breakfast.click();
    await expect(breakfast).toHaveAttribute('aria-current', 'true');
    await expect.poll(async () => Math.abs((await centreX(breakfast)) - viewportCentre(page))).toBeLessThan(4);
  });

  test('turns the other way in right-to-left languages', async ({ page }) => {
    await page.goto('/atelier/ar?rail=drum');
    const rail = page.locator('nav[data-rail-style="drum"]');
    await expect(rail).toBeVisible();
    const links = rail.getByRole('link');
    expect(await centreX(links.nth(1))).toBeLessThan(await centreX(links.nth(0)));
  });
});

test.describe('category rail: split-flap', () => {
  test('sets the active name in tiles that land on its letters', async ({ page }) => {
    await page.goto('/atelier/en?rail=flap');
    const rail = page.getByRole('navigation', { name: 'Menu categories' });
    await expect(rail).toHaveAttribute('data-rail-style', 'flap');
    const plates = rail.getByRole('link', { name: 'Plates' });
    await plates.click();
    await expect(plates).toHaveAttribute('aria-current', 'true');
    const tiles = plates.locator('[data-flap]');
    await expect(tiles).toHaveCount(6);
    // While the board spins the tiles show other letters; once it lands they spell the name.
    await expect.poll(async () => (await tiles.allTextContents()).join(''), { timeout: 3000 }).toBe('Plates');
  });

  test('flips whole words in Arabic so the letters stay joined', async ({ page }) => {
    await page.goto('/atelier/ar?rail=flap');
    const rail = page.locator('nav[data-rail-style="flap"]');
    const active = rail.locator('[aria-current="true"]');
    await expect(active.locator('[data-flap]')).toHaveCount(1);
    await expect(active.locator('[data-flap]')).toHaveText('القهوة والشاي');
  });
});
