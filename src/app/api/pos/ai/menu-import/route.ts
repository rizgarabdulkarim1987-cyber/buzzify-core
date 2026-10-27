import { withKeepAlive } from '@/server/ai/keep-alive';
import { readMenuImportUpload } from '@/server/ai/menu-import-upload';
import { posImportAiPreview } from '@/server/studio/actions/pos';
import { studioRoute } from '@/server/studio/framework/route';

/** Reads an uploaded menu (a photo or a PDF) or a link into the product list's import preview. */
export const POST = withKeepAlive(studioRoute(posImportAiPreview, { method: 'POST', parse: (request) => readMenuImportUpload(request) }));
