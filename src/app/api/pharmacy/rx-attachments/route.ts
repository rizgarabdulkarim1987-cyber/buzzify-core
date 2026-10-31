import { attach } from '@/server/pharmacy/actions/prescriptions';
import { readRxUpload } from '@/server/pharmacy/rx-http';
import { studioRoute } from '@/server/studio/framework/route';

/** Takes one scan or photo for a prescription. The body is capped at the file limit before it is parsed. */
export const POST = studioRoute(attach, { method: 'POST', parse: (request) => readRxUpload(request) });
