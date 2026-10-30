import { serveRxAttachment } from '@/server/pharmacy/rx-http';

/** Streams one prescription file to a person holding `rx.attachment.view`; see `serveRxAttachment`. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  return serveRxAttachment(request, id);
}
