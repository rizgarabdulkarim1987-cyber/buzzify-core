import { readSupplyUpload } from '@/server/ai/supply-upload';
import { extractPosSupply } from '@/server/studio/actions/pos-ai';
import { studioRoute } from '@/server/studio/framework/route';

/** Reads an uploaded invoice (a photo, a PDF or pasted text) into a draft. The upload is capped before it is parsed. */
export const POST = studioRoute(extractPosSupply, { method: 'POST', parse: (request) => readSupplyUpload(request) });
