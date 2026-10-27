import { posImportAiTranslate } from '@/server/studio/actions/pos';
import { studioRoute } from '@/server/studio/framework/route';

/** Works out Arabic and Kurdish for what an AI reading is about to create, for the product list. */
export const POST = studioRoute(posImportAiTranslate, { method: 'POST' });
