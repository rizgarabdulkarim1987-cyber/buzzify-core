import { aiPhotos } from '@/server/studio/actions/imports';
import { studioRoute } from '@/server/studio/framework/route';

/** Brings the next few pictures of an AI reading into the library. */
export const POST = studioRoute(aiPhotos, { method: 'POST' });
