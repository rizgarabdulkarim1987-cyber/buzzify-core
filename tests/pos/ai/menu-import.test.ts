import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiEmptyPageError, AiLinkError, AiNotEnabledError, AiUnreadableError } from '@/server/ai/errors';
import sharp from 'sharp';
import { checkLinkUrl, fetchLink, isPrivateAddress, readRendered, setLinkDepsForTests, type LinkDeps } from '@/server/ai/link-fetch';
import { priceCell, readMenu, toMenuSheet } from '@/server/ai/menu-import';
import { readMenuImportUpload } from '@/server/ai/menu-import-upload';
import { setAiProviderForTests } from '@/server/ai/provider';
import { FakeProvider } from '@/server/ai/provider/fake';
import { writeAiPackage } from '@/server/ai/package';
import { posImportAiPreview, posImportApply } from '@/server/studio/actions/pos';
import { aiRead } from '@/server/studio/actions/imports';
import { dataOf, person, prisma, run, useTestDatabase } from '../fixture';
import { makeAiWorld, type AiWorld } from './world';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };
let w: AiWorld;
let fake: FakeProvider;
const env = () => ({ db: prisma(), restaurantId: w.a.id, staffId: 'staff-1' });
function ready<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error('expected a reading');
  return result as Extract<T, { ok: true }>;
}
const png = (body: string) => ({ kind: 'file' as const, mediaType: 'image/png' as const, base64: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(body)]).toString('base64') });

const MENU = ['# Drinks', 'Tea | 1,500', 'Coffee | ٢٥٠٠ | Strong', '# مأكولات', 'برغر | 8500 | لحم', 'Ghost | '].join('\n');

const html = (body: string) => `<html><body>${body}</body></html>`;
function deps(pages: Record<string, { body: string | Buffer; type: string } | { redirect: string }>, addresses: Record<string, string[]> = {}): LinkDeps {
  return {
    lookup: async (host) => addresses[host] ?? ['93.184.216.34'],
    fetch: (async (input: URL | string) => {
      const page = pages[String(input)];
      if (!page) return new Response('nope', { status: 404 });
      if ('redirect' in page) return new Response(null, { status: 302, headers: { location: page.redirect } });
      return new Response(typeof page.body === 'string' ? page.body : new Uint8Array(page.body), { status: 200, headers: { 'content-type': page.type } });
    }) as typeof fetch,
  };
}

beforeAll(() => useTestDatabase());
beforeEach(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  w = await makeAiWorld();
  fake = new FakeProvider();
  setAiProviderForTests(fake);
});
afterEach(() => {
  setLinkDepsForTests(undefined);
  setAiProviderForTests(undefined);
  vi.restoreAllMocks();
});
afterAll(async () => {
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

describe('priceCell', () => {
  it('keeps the digits and separators of a printed price and drops currency words', () => {
    expect(priceCell('6,000 IQD', 'IQD')).toBe('6,000');
    expect(priceCell('٢٥٠٠ د.ع', 'IQD')).toBe('2500');
    expect(priceCell('4.50', 'USD')).toBe('4.50');
  });

  it('refuses what is not a price in the currency', () => {
    expect(priceCell(null, 'IQD')).toBeNull();
    expect(priceCell('free', 'IQD')).toBeNull();
    expect(priceCell('4.50', 'IQD')).toBeNull();
  });
});

describe('reading a menu from a file', () => {
  it('reads categories, names, descriptions and prices, and leaves out an item with no price', async () => {
    const reading = await readMenu(env(), png(MENU), 'IQD');
    expect(reading.products.map((p) => [p.category, p.names, p.price])).toEqual([
      [{ en: 'Drinks' }, { en: 'Tea' }, '1,500'],
      [{ en: 'Drinks' }, { en: 'Coffee' }, '2500'],
      [{ ar: 'مأكولات' }, { ar: 'برغر' }, '8500'],
    ]);
    expect(reading.products[1]!.descriptions).toEqual({ en: 'Strong' });
    expect(reading.skipped).toBe(1);
  });

  it('is refused when the AI package is off, and when the file is not the type it says', async () => {
    await writeAiPackage(prisma(), w.a.id, { enabled: false });
    await expect(readMenu(env(), png(MENU), 'IQD')).rejects.toBeInstanceOf(AiNotEnabledError);
    await writeAiPackage(prisma(), w.a.id, { enabled: true, monthlyLimit: 50 });
    await expect(readMenu(env(), { kind: 'file', mediaType: 'image/png', base64: Buffer.from('not a png').toString('base64') }, 'IQD')).rejects.toBeInstanceOf(AiUnreadableError);
  });

  it('reads a model answer that is not JSON as unreadable, and a menu with nothing in it as unreadable', async () => {
    await expect(readMenu(env(), png('[[bad-json]]'), 'IQD')).rejects.toBeInstanceOf(AiUnreadableError);
    await expect(readMenu(env(), png('nothing here'), 'IQD')).rejects.toBeInstanceOf(AiUnreadableError);
  });
});

describe('reading a menu from a link', () => {
  const page = `# Drinks\nTea | 1,500 | | 0\nCoffee | 2500\n${'x'.repeat(40)}`;
  const body = html(`<img src="/img/tea.jpg" alt="Tea"><pre>${page}</pre>`);

  it('reads the page text and picks a picture by its number, as an absolute address', async () => {
    const reading = await readMenu(env(), { kind: 'link', url: 'https://menu.example.com/m' }, 'IQD', deps({ 'https://menu.example.com/m': { body, type: 'text/html; charset=utf-8' } }));
    expect(reading.products.map((p) => [p.names.en, p.price, p.imageUrl])).toEqual([
      ['Tea', '1,500', 'https://menu.example.com/img/tea.jpg'],
      ['Coffee', '2500', null],
    ]);
  });

  it('drops an item whose price is not on the page (an instruction hidden in the page)', async () => {
    const reading = await readMenu(env(), { kind: 'link', url: 'https://menu.example.com/m' }, 'IQD', deps({ 'https://menu.example.com/m': { body: `${body}[[inject]]`, type: 'text/html' } }));
    expect(reading.products.map((p) => p.names.en)).toEqual(['Tea', 'Coffee']);
    expect(reading.skipped).toBe(1);
  });

  it('refuses a page that shows nothing to read', async () => {
    await expect(readMenu(env(), { kind: 'link', url: 'https://menu.example.com/m' }, 'IQD', deps({ 'https://menu.example.com/m': { body: html('<div id="app"></div><script>boot()</script>'), type: 'text/html' } }))).rejects.toBeInstanceOf(AiEmptyPageError);
  });

  it('reads a PDF the link points straight at', async () => {
    const reading = await readMenu(env(), { kind: 'link', url: 'https://menu.example.com/m.pdf' }, 'IQD', deps({ 'https://menu.example.com/m.pdf': { body: Buffer.from(`%PDF-1.4\n${MENU}`), type: 'application/pdf' } }));
    expect(reading.products).toHaveLength(3);
  });
});

describe('a page drawn by JavaScript', () => {
  const empty = html('<div id="app"></div><script>boot()</script>');
  const markdown = ['## BAR SNACKS', '### Mix Nuts', '#### 5', '![Image 1: image Mix Nuts](https://media.example.com/nuts.png)', '![Image 2: New](https://media.example.com/new.svg)', 'Olives | 2 | | 1'].join('\n');
  const pages = { 'https://menu.example.com/m': { body: empty, type: 'text/html' }, 'https://r.jina.ai/https://menu.example.com/m': { body: markdown, type: 'text/markdown' } };

  it('is read through the rendering service, with each picture marked where it stood', async () => {
    const page = await fetchLink('https://menu.example.com/m', deps(pages));
    expect(page).toMatchObject({ kind: 'page', inlineImages: true });
    if (page.kind !== 'page') throw new Error('a page');
    expect(page.text).toContain('[picture 0: Mix Nuts]');
    expect(page.images.map((image) => image.url)).toEqual(['https://media.example.com/nuts.png']);
  });

  it('reads the products and gives each its picture', async () => {
    const reading = await readMenu(env(), { kind: 'link', url: 'https://menu.example.com/m' }, 'IQD', deps({ ...pages, 'https://r.jina.ai/https://menu.example.com/m': { body: `# Snacks
Mix Nuts | 5 | | 0
![Image 1: image Mix Nuts](https://media.example.com/nuts.png)
${'x'.repeat(40)}`, type: 'text/markdown' } }));
    expect(reading.products.map((p) => [p.names.en, p.price, p.imageUrl])).toEqual([['Mix Nuts', '5', 'https://media.example.com/nuts.png']]);
  });

  it('is refused, with its own error, when the rendering service gives nothing', async () => {
    await expect(readMenu(env(), { kind: 'link', url: 'https://menu.example.com/m' }, 'IQD', deps({ 'https://menu.example.com/m': { body: empty, type: 'text/html' } }))).rejects.toBeInstanceOf(AiEmptyPageError);
  });

  it('drops logos and stickers and keeps the order', () => {
    const page = readRendered('![a](https://x.example.com/logo.png)![Image 2: image item](https://x.example.com/a.jpg)![Image 3: image item](https://x.example.com/a.jpg)');
    expect(page.images).toHaveLength(1);
    expect(page.text).toBe('[picture 0: item][picture 0: item]');
  });
});

describe('the link guard', () => {
  const lookup = async (host: string) => (host === 'intranet.example.com' ? ['10.0.0.5'] : ['93.184.216.34']);

  it('knows the addresses a server must not call', () => {
    for (const address of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) expect(isPrivateAddress(address)).toBe(true);
    for (const address of ['93.184.216.34', '8.8.8.8', '2606:2800:220:1:248:1893:25c8:1946']) expect(isPrivateAddress(address)).toBe(false);
  });

  it('refuses private hosts, names that resolve to private addresses, other schemes and credentials', async () => {
    for (const url of ['http://localhost/m', 'http://127.0.0.1/m', 'https://intranet.example.com/m', 'ftp://menu.example.com/m', 'https://user:pass@menu.example.com/m', 'https://printer.local/m', 'not a url', 'http://[::1]/m'])
      await expect(checkLinkUrl(url, { lookup })).rejects.toBeInstanceOf(AiLinkError);
    await expect(checkLinkUrl('https://menu.example.com/m', { lookup })).resolves.toBeInstanceOf(URL);
  });

  it('checks every redirect again', async () => {
    const pages = { 'https://menu.example.com/a': { redirect: 'http://169.254.169.254/latest/meta-data' } };
    await expect(fetchLink('https://menu.example.com/a', deps(pages))).rejects.toBeInstanceOf(AiLinkError);
    const loop = { 'https://menu.example.com/a': { redirect: 'https://menu.example.com/b' }, 'https://menu.example.com/b': { redirect: 'https://menu.example.com/a' } };
    await expect(fetchLink('https://menu.example.com/a', deps(loop))).rejects.toBeInstanceOf(AiLinkError);
  });
});

describe('the sheet', () => {
  const product = (category: Record<string, string>, names: Record<string, string>, price = '1000') => ({ category, names, descriptions: {}, price, imageUrl: null });

  it('keeps an existing category by any of its names, adds new ones, and keeps a product named twice once', () => {
    const { csv, rows } = toMenuSheet(
      [product({ en: 'Drinks' }, { en: 'Tea' }), product({ ar: 'مشروبات' }, { en: 'Tea' }), product({ ar: 'مشروبات' }, { ar: 'شاي' }), product({ en: 'Food' }, { en: 'Burger' })],
      [{ slug: 'hot-drinks', names: { en: 'Drinks', ar: 'مشروبات' } }],
    );
    const lines = csv.trim().split(/\r?\n/);
    expect(rows).toHaveLength(3);
    expect(lines[1]).toMatch(/^hot-drinks,Drinks,,,,Tea,/);
    expect(lines[2]).toMatch(/^hot-drinks,,مشروبات,,,شاي,شاي,/);
    expect(lines[3]).toMatch(/^food,Food,/);
  });
});

describe('the upload', () => {
  const form = (fields: Record<string, string | Blob>) => {
    const body = new FormData();
    for (const [key, value] of Object.entries(fields)) body.set(key, value);
    return new Request('http://localhost/x', { method: 'POST', body });
  };

  it('takes a file or a link and refuses anything else', async () => {
    expect(await readMenuImportUpload(form({ url: ' https://menu.example.com/m ' }))).toEqual({ kind: 'link', url: ' https://menu.example.com/m ' });
    expect(await readMenuImportUpload(form({ file: new File([Buffer.from('%PDF-1.4')], 'm.pdf', { type: 'application/pdf' }) }))).toMatchObject({ kind: 'file', mediaType: 'application/pdf' });
    await expect(readMenuImportUpload(form({ file: new File(['x'], 'm.exe', { type: 'application/x-msdownload' }) }))).rejects.toThrow();
    await expect(readMenuImportUpload(form({}))).rejects.toThrow();
  });
});

describe('the actions', () => {
  it('warns when the source prints its prices in another currency than the menu', async () => {
    const shown = ready(dataOf(await run(w.manager, posImportAiPreview, png(`${MENU}
[[currency:USD]]`))));
    expect(shown.currencyMismatch).toEqual({ source: 'USD', menu: 'IQD' });
    expect(ready(dataOf(await run(w.manager, posImportAiPreview, png(`${MENU}
[[currency:IQD]]`)))).currencyMismatch).toBeNull();
  });

  it('the cashier previews and applies an AI reading, and the till catalog shows it', async () => {
    const shown = ready(dataOf(await run(w.manager, posImportAiPreview, png(MENU))));
    expect(shown.skipped).toBe(1);
    expect(shown.preview.summary).toMatchObject({ new: 3, invalid: 0 });
    expect(await prisma().product.count({ where: { menu: { slug: 'ai-menu-a' } } })).toBe(1);
    dataOf(await run(w.manager, posImportApply, { importJobId: shown.importJobId }));
    expect(await prisma().product.count({ where: { menu: { slug: 'ai-menu-a' } } })).toBe(4);
  });

  it('answers a code when the AI package is off', async () => {
    await writeAiPackage(prisma(), w.a.id, { enabled: false });
    expect(dataOf(await run(w.manager, posImportAiPreview, png(MENU)))).toEqual({ ok: false, code: 'aiDisabled' });
  });

  it('a cashier without the catalog permission is refused', async () => {
    const result = await run(w.cashier, posImportAiPreview, png(MENU));
    expect(result.ok).toBe(false);
  });

  it("the Studio's designer reads into the menu's draft preview", async () => {
    const designer = await person('designer', { membership: [w.a.id, 'DESIGNER'] });
    const menu = await prisma().menu.findFirstOrThrow({ where: { slug: 'ai-menu-a' } });
    const shown = ready(dataOf(await run(designer, aiRead, { menuId: menu.id, source: png(MENU) })));
    expect(shown.preview.summary).toMatchObject({ new: 3 });
  });
});

describe('pictures from a link', () => {
  const page = (image: string) => `# Drinks\nTea | 1,500 | | 0\n${'x'.repeat(40)}<img src="${image}" alt="Tea">`;
  const link = { kind: 'link' as const, url: 'https://menu.example.com/m' };

  it('brings the picture into the library and gives it to the product the import creates', async () => {
    const tea = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#c00' } }).png().toBuffer();
    setLinkDepsForTests(deps({ 'https://menu.example.com/m': { body: html(page('/tea.png')), type: 'text/html' }, 'https://menu.example.com/tea.png': { body: tea, type: 'image/png' } }));
    const shown = ready(dataOf(await run(w.manager, posImportAiPreview, link)));
    expect(shown.photos).toBe(1);
    dataOf(await run(w.manager, posImportApply, { importJobId: shown.importJobId }));
    const product = await prisma().product.findFirstOrThrow({ where: { menu: { slug: 'ai-menu-a' }, basePrice: 1500 } });
    const [entry] = product.media as Array<{ kind: string; assetId: string }>;
    expect(entry).toMatchObject({ kind: 'asset' });
    expect(await prisma().mediaAsset.count({ where: { id: entry!.assetId, restaurantId: w.a.id } })).toBe(1);
  });

  it('still imports the products when a picture is on a private address or is not a picture', async () => {
    setLinkDepsForTests(deps({ 'https://menu.example.com/m': { body: html(page('http://10.0.0.1/tea.png')), type: 'text/html' } }));
    const shown = ready(dataOf(await run(w.manager, posImportAiPreview, link)));
    expect(shown.photos).toBe(0);
    expect(shown.preview.summary.new).toBe(1);
    setLinkDepsForTests(deps({ 'https://menu.example.com/m': { body: html(page('/tea.png')), type: 'text/html' }, 'https://menu.example.com/tea.png': { body: 'not a picture', type: 'image/png' } }));
    expect(ready(dataOf(await run(w.manager, posImportAiPreview, link))).photos).toBe(0);
  });
});
