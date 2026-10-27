import { posImportAiPhotos } from '@/server/studio/actions/pos';
import { studioRoute } from '@/server/studio/framework/route';

/** Brings the next few pictures of an AI reading into the library, for the product list. */
export const POST = studioRoute(posImportAiPhotos, { method: 'POST' });
