import { verifyDevIntakeSignature, fsIntakeStorage } from '@/server/pharmacy/intake/storage';

/**
 * Development stand-in for the private invoice bucket: a signed link (minted by `ph.intake.file.url` after its access check,
 * five minutes at most) shows the file inline. Without a valid signature, outside development, or for a key that is not an
 * intake key it answers 404 and says nothing else. It does not exist in production, where the private R2 bucket serves.
 */

const notFound = () => new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });

export async function GET(request: Request, context: { params: Promise<{ key?: string[] }> }): Promise<Response> {
  if (process.env.NODE_ENV === 'production') return notFound();
  const key = (await context.params).key?.join('/') ?? '';
  const params = new URL(request.url).searchParams;
  if (!verifyDevIntakeSignature(key, params.get('expires'), params.get('sig'))) return notFound();
  const file = await fsIntakeStorage().get(key);
  if (!file) return notFound();
  return new Response(file.bytes as unknown as BodyInit, {
    status: 200,
    headers: {
      'content-type': file.mediaType,
      'content-disposition': 'inline; filename="invoice"',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
