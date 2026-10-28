/**
 * The address of the visitor, from `x-forwarded-for`. Each proxy on the way appends the address it saw to the right,
 * so the first entry is whatever the browser chose to write and can be changed on every request to dodge a limit.
 * The entry to trust is the one the nearest proxy added: the last, or, with more than one proxy in front of the app,
 * the one `TRUSTED_PROXY_HOPS` entries from the end (default 1). Empty when there is no header.
 */
export function clientIp(headers: Headers): string {
  const entries = (headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (entries.length === 0) return '';
  const configured = Number.parseInt(process.env.TRUSTED_PROXY_HOPS ?? '', 10);
  const hops = Number.isInteger(configured) && configured >= 1 ? configured : 1;
  return entries[Math.max(0, entries.length - hops)]!;
}
