import { isLocale } from '@/lib/locale';
import { loadWheelState, spin } from '@/server/data/wheel';
import { hashAddress, newGuestKey, readGuestKey } from '@/server/http/guest-cookie';
import { handleTenantGet, handleTenantRequest, problem } from '@/server/http/route';
import { wheelSpinSchema } from '@/server/http/schemas';

const NO_STORE = { 'cache-control': 'no-store' };
const addressOf = (request: Request) => request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';

/** The wheel's slices (no weights) and how many spins this guest has left today. Never cached: it depends on the guest. */
export async function GET(request: Request, ctx: { params: Promise<{ tenant: string }> }) {
  return handleTenantGet(request, ctx, { route: 'wheel-state', limit: 60 }, async ({ tenant, now }) => {
    const asked = new URL(request.url).searchParams.get('locale') ?? '';
    const locale = isLocale(asked) ? asked : tenant.defaultLocale;
    const state = await loadWheelState(tenant, locale, readGuestKey(request.headers), hashAddress(addressOf(request), tenant.id), now);
    return Response.json(state, { headers: NO_STORE });
  });
}

/**
 * One spin. The server draws the winner and counts the spin before it answers; the guest is told only who won and how many spins are
 * left. A guest without a valid signed cookie gets a new one, and the address's own count still caps what new cookies can do.
 */
export async function POST(request: Request, ctx: { params: Promise<{ tenant: string }> }) {
  return handleTenantRequest(request, ctx, { schema: wheelSpinSchema, route: 'wheel', limit: 20 }, async ({ tenant, input, now }) => {
    const existing = readGuestKey(request.headers);
    const fresh = existing === null ? newGuestKey() : null;
    const guestKey = existing ?? (fresh as { key: string }).key;
    const result = await spin(tenant, input.locale ?? tenant.defaultLocale, guestKey, hashAddress(addressOf(request), tenant.id), now);
    if (!result.ok) return problem(409, result.reason, result.reason === 'SPINS_USED' ? 'No spins left today' : 'The wheel is not available', NO_STORE);
    const headers = new Headers(NO_STORE);
    if (fresh) headers.append('set-cookie', fresh.setCookie);
    return Response.json({ winnerProductId: result.winnerProductId, label: result.label, spinsLeft: result.spinsLeft }, { headers });
  });
}
