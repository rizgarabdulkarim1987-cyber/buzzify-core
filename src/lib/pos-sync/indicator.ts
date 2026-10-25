export type IndicatorState = 'online' | 'offline' | 'syncing' | 'attention' | 'signedOut';

/**
 * The one word the till shows about the connection. When several things are true the more urgent wins: an operation that
 * needs the cashier, then a lapsed session, then a send in progress, then no network.
 */
export function indicatorState(s: { online: boolean; syncing: boolean; signedOut: boolean; pending: number; attention: number }): IndicatorState {
  if (s.attention > 0) return 'attention';
  if (s.signedOut && s.pending > 0) return 'signedOut';
  if (s.syncing) return 'syncing';
  if (!s.online) return 'offline';
  return 'online';
}
