import { breakdownCsv } from '@/server/pos/csv-export';
import { invokeQuery } from '@/server/studio/framework/invoke';
import { posBreakdown } from '@/server/studio/queries/pos-breakdown';

const STATUS: Record<string, number> = { UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404 };

/** The sales breakdown of a range as a CSV file, for the people who may read the reports. */
export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const result = await invokeQuery(posBreakdown, { from, to });
  if (!result.ok) return new Response(null, { status: STATUS[result.error.code] ?? 400 });
  // The byte order mark makes Excel read the Arabic and Kurdish names as UTF-8.
  return new Response(`﻿${breakdownCsv(result.data)}`, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="sales-${from}-${to}.csv"`,
      'cache-control': 'no-store',
    },
  });
}
