import { addFile } from '@/server/pharmacy/actions/intake';
import { readIntakeUpload } from '@/server/pharmacy/intake/upload-request';
import { studioRoute } from '@/server/studio/framework/route';

/** Takes one invoice file into an intake batch. The body is capped at the file limit before it is parsed. */
export const POST = studioRoute(addFile, { method: 'POST', parse: (request) => readIntakeUpload(request) });
