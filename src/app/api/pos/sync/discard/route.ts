import { discardPosSyncOperation } from '@/server/studio/actions/pos-sync';
import { studioRoute } from '@/server/studio/framework/route';

/** Records that a queued operation was thrown away on the device. Needs the network: it is a record, not a change. */
export const POST = studioRoute(discardPosSyncOperation, { method: 'POST' });
