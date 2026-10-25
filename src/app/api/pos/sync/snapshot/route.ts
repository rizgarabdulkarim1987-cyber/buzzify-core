import { posSyncSnapshot } from '@/server/studio/queries/pos-sync';
import { studioRoute } from '@/server/studio/framework/route';

/** The read cache of the offline till: the floor, the catalog and the live orders with their versions. */
export const GET = studioRoute(posSyncSnapshot, { method: 'GET' });
