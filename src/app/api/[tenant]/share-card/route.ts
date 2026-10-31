import { getCatalog } from '@/server/data/public-menu';
import { buildMenuView } from '@/server/data/menu-view';
import { handleTenantGet, problem } from '@/server/http/route';
import { formatMoney } from '@/server/domain/money';
import { LOCALES, type Locale } from '@/lib/locale';
import { renderDishCard } from '@/server/share/dish-card';

const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const SLUG = /^[a-z0-9][a-z0-9-]{0,99}$/;

/** The dish's photo, read through the menu's own address; null when it cannot be had in time or is too big. */
async function loadPhoto(url: string, origin: string): Promise<Buffer | null> {
  try {
    const response = await fetch(new URL(url, origin), { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    return bytes.length <= MAX_PHOTO_BYTES ? bytes : null;
  } catch {
    return null;
  }
}

/** A dish's share card as a PNG. A plan without the feature, or a dish the menu does not show, answers 404. */
export async function GET(request: Request, ctx: { params: Promise<{ tenant: string }> }) {
  return handleTenantGet(request, ctx, { route: 'share-card', limit: 30 }, async ({ tenant, now }) => {
    if (!tenant.features.shareCards) return problem(404, 'NOT_FOUND', 'Not found');
    const url = new URL(request.url);
    const slug = url.searchParams.get('slug') ?? '';
    const asked = url.searchParams.get('locale') ?? '';
    if (!SLUG.test(slug)) return problem(400, 'INVALID_REQUEST', 'A dish is needed');
    const locale: Locale = (LOCALES as readonly string[]).includes(asked) && tenant.locales.includes(asked as Locale) ? (asked as Locale) : tenant.defaultLocale;

    const view = buildMenuView(await getCatalog(tenant), tenant, locale, now);
    const product = view.products.find((candidate) => candidate.slug === slug);
    if (!product) return problem(404, 'NOT_FOUND', 'Not found');

    const picture = product.media.find((item) => item.kind === 'image');
    const photo = picture ? await loadPhoto(picture.url, url.origin) : null;
    const { currency, numeralSystem } = view.restaurant;
    const withSymbol = view.priceStyle !== 'plain';
    const price = formatMoney(product.displayPrice, currency, locale, numeralSystem, { symbol: withSymbol });
    const png = await renderDishCard({ name: product.name, price, restaurant: tenant.name, palette: tenant.brand.tokens[tenant.brand.theme], photo });
    return new Response(new Uint8Array(png), { headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=300' } });
  });
}
