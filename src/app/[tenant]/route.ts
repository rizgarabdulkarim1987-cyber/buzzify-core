import { redirectToMenu } from '@/server/http/menu-entry';

/** `/{slug}`: the menu's entry address, as printed on a card or typed by hand. */
export async function GET(request: Request, ctx: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await ctx.params;
  return redirectToMenu(request, tenant, '');
}
