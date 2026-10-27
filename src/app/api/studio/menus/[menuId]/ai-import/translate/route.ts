import { aiTranslate } from '@/server/studio/actions/imports';
import { studioRoute } from '@/server/studio/framework/route';

/** Works out Arabic and Kurdish for what an AI reading is about to create. */
export const POST = studioRoute(aiTranslate, { method: 'POST' });
