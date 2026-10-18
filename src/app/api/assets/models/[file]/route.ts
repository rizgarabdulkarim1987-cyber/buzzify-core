import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * The 3D models that ship with the app (`src/assets/models`), for products whose art names one as its `scan`. Each
 * file's name carries a hash of its content, so a browser may keep it for good and a new model gets a new name.
 * `next.config.ts` traces the folder into the standalone build, which does not see a file read at run time.
 */

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*\.glb$/;
const FOLDER = join(process.cwd(), 'src', 'assets', 'models');

const notFound = () => new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });

export async function GET(_request: Request, context: { params: Promise<{ file: string }> }): Promise<Response> {
  const { file } = await context.params;
  if (!NAME.test(file)) return notFound();
  let bytes: Buffer;
  try {
    bytes = await readFile(join(FOLDER, file));
  } catch {
    return notFound();
  }
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'content-type': 'model/gltf-binary',
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    },
  });
}
