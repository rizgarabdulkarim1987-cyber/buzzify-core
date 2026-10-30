export interface BridgeTarget {
  transport: 'NETWORK' | 'FILE';
  address: string;
}

/** `tcp://host:port` is a network printer, `file://<path>` a printer shared by Windows (`\\localhost\NAME`). Mirrored by print-bridge/bridge.mjs. */
export function parseTarget(target: string): BridgeTarget {
  const tcp = /^tcp:\/\/([^\s/:]+:\d{1,5})$/.exec(target);
  if (tcp) return { transport: 'NETWORK', address: tcp[1] };
  const file = /^file:\/\/(.+)$/.exec(target);
  if (file) return { transport: 'FILE', address: file[1] };
  throw new Error('bad target');
}

/**
 * What a printer address may name. The bridge writes bytes wherever a target says, so a target must be a printer: a private
 * (or loopback) IPv4 address on a raw-printing port, or a printer shared on this very PC. Mirrored by print-bridge/bridge.mjs.
 */
export function printerAddressAllowed(transport: 'NETWORK' | 'FILE', address: string, extraPorts: readonly number[] = []): boolean {
  if (transport === 'FILE') return /^\\\\(?:localhost|127\.0\.0\.1)\\[A-Za-z0-9 _-]+(?:\.[A-Za-z0-9 _-]+)*$/.test(address) && address.length <= 100;
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3}):(\d{1,5})$/.exec(address);
  if (!match) return false;
  const [a, b, c, d] = match.slice(1, 5).map(Number);
  const port = Number(match[5]);
  if ([a, b, c, d].some((part) => part > 255)) return false;
  const privateRange = a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  return privateRange && ((port >= 9100 && port <= 9109) || extraPorts.includes(port));
}

export function targetOf(printer: BridgeTarget): string {
  return printer.transport === 'NETWORK' ? `tcp://${printer.address}` : `file://${printer.address}`;
}
