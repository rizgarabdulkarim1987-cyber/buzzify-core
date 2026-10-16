import { redirectToMenu } from '@/server/http/menu-entry';

/** `/{slug}/t/{table}`: the address a table's QR code carries. It has no language yet. */
export async function GET(request: Request, ctx: { params: Promise<{ tenant: string; table: string }> }) {
  const { tenant, table } = await ctx.params;
  return redirectToMenu(request, tenant, `/t/${encodeURIComponent(table)}`);
}
