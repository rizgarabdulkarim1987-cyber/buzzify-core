import { withKeepAlive } from '@/server/ai/keep-alive';
import { readMenuImportUpload } from '@/server/ai/menu-import-upload';
import { aiRead } from '@/server/studio/actions/imports';
import { studioRoute } from '@/server/studio/framework/route';

/** Reads an uploaded menu (a photo or a PDF) or a link into an import preview. The upload is capped before it is parsed. */
export const POST = withKeepAlive(
  studioRoute(aiRead, {
    method: 'POST',
    parse: async (request, params) => ({ menuId: params.menuId, source: await readMenuImportUpload(request) }),
  }),
);
