import * as media from '@/server/studio/actions/media';
import { studioRoute } from '@/server/studio/framework/route';

// Finalizing turns a 15 MB photo into its variants with sharp, which can take longer than a Server Action allows.
export const POST = studioRoute(media.finalize, { method: 'POST' });
export const maxDuration = 60;
