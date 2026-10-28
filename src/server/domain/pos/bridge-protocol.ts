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

export function targetOf(printer: BridgeTarget): string {
  return printer.transport === 'NETWORK' ? `tcp://${printer.address}` : `file://${printer.address}`;
}
