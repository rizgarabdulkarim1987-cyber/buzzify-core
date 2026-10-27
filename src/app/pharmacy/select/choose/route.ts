import { signPhPlaceChoice } from '@/server/pharmacy/actor';
import { PH_PLACE_COOKIE, placeCookieOptions } from '@/server/pharmacy/entry';
import { readBodyWithLimit } from '@/server/http/route';
import { sameOrigin } from '@/server/studio/framework/route';

/**
 * The picker's form posts a place here (`place` = `restaurantId:branchId`, `*` for all branches). A Route Handler because
 * the choice goes into an HttpOnly cookie; it changes no data. The place is checked against what the person may use now
 * and signed for them; anything else, or a post from another site, is answered 404 or 403 and sets nothing.
 */

const PLACE = /^([A-Za-z0-9_-]+):(\*|[A-Za-z0-9_-]+)$/;

const notFound = () => new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });

export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return new Response('Forbidden', { status: 403 });
  const text = await readBodyWithLimit(request, 1024);
  const match = PLACE.exec(new URLSearchParams(text ?? '').get('place') ?? '');
  if (!match) return notFound();
  const place = { restaurantId: match[1]!, branchId: match[2] === '*' ? null : match[2]! };
  const value = await signPhPlaceChoice(place);
  if (!value) return notFound();

  const { maxAge, httpOnly, secure, path } = placeCookieOptions();
  const answer = new Response(null, { status: 303, headers: { location: '/pharmacy/home', 'cache-control': 'no-store' } });
  answer.headers.append(
    'set-cookie',
    `${PH_PLACE_COOKIE}=${value}; Path=${path}; Max-Age=${maxAge}; SameSite=Lax${httpOnly ? '; HttpOnly' : ''}${secure ? '; Secure' : ''}`,
  );
  return answer;
}
