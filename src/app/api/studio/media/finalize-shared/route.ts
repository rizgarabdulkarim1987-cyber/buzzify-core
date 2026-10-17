import * as media from '@/server/studio/actions/media';
import { studioRoute } from '@/server/studio/framework/route';

// The shared library's twin of /api/studio/media/finalize.
export const POST = studioRoute(media.finalizeShared, { method: 'POST' });
export const maxDuration = 60;
