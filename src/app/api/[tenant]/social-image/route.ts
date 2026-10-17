import sharp from 'sharp';
import { isLocale } from '@/lib/locale';
import { getTenant } from '@/server/data/public-menu';
import { getStorage } from '@/server/storage/storage';

const WIDTH = 1200;
const HEIGHT = 630;
/** The logo is fitted inside this box at the centre. */
const LOGO_BOX = { width: 600, height: 300 };
const LOGO_MAX_BYTES = 15 * 1024 * 1024;

const notFound = () => new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });

/**
 * The picture a shared link of the menu shows (Open Graph), for one revision and language: the language's search image
 * when the menu has one, else the brand's logo on the theme's background, 1200 × 630. A revision never changes, so the
 * drawn picture is cached for good; an address naming an older revision is sent to the live one.
 */
export async function GET(request: Request, ctx: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await ctx.params;
  const tenant = await getTenant(slug);
  if (!tenant) return notFound();

  const url = new URL(request.url);
  const raw = url.searchParams.get('locale') ?? '';
  const locale = isLocale(raw) && tenant.locales.includes(raw) ? raw : tenant.defaultLocale;
  if (url.searchParams.get('rev') !== tenant.revisionId) {
    const live = `/api/${tenant.slug}/social-image?rev=${encodeURIComponent(tenant.revisionId)}&locale=${locale}`;
    return new Response(null, { status: 302, headers: { location: live, 'cache-control': 'no-store' } });
  }

  const image = tenant.seo[locale]?.image;
  if (image) return new Response(null, { status: 302, headers: { location: image.url, 'cache-control': 'public, max-age=3600' } });

  const { brand } = tenant;
  const logo = brand.theme === 'dark' ? (brand.logoDark ?? brand.logo) : brand.logo;
  if (!logo) return notFound();
  const file = await getStorage().get(logo.rasterKey, LOGO_MAX_BYTES);
  if (!file) return notFound();

  const fitted = await sharp(Buffer.from(file.bytes)).resize(LOGO_BOX.width, LOGO_BOX.height, { fit: 'inside' }).png().toBuffer();
  const png = await sharp({ create: { width: WIDTH, height: HEIGHT, channels: 4, background: brand.tokens[brand.theme].bg } })
    .composite([{ input: fitted, gravity: 'center' }])
    .png()
    .toBuffer();
  return new Response(new Uint8Array(png), {
    headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=31536000, immutable' },
  });
}
