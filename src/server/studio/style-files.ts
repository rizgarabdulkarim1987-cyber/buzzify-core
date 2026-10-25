import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isOwnerOnly } from '@/studio/nav';
import { getActor } from './auth/actor';

/**
 * The menu-style showroom's files (`src/studio/styles`): the five mockup pages and the posters of the styles. They
 * are for Studio staff, so an owner of a restaurant and a signed-out visitor both get "not found". `next.config.ts`
 * traces the folders into the standalone build, which does not see a file read at run time.
 */

const FOLDER = join(process.cwd(), 'src', 'studio', 'styles');

/** Whether the visitor is Studio staff who may see the showroom: signed in, and not only an owner of a restaurant. */
export async function styleFileAccess(): Promise<boolean> {
  const actor = await getActor();
  return actor !== null && !isOwnerOnly(actor);
}

export function notFound(): Response {
  return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
}

/** Serves one file of the showroom, or "not found" when the visitor may not see it or the file is missing. */
export async function serveStyleFile(folder: 'pages' | 'posters', name: string, contentType: string): Promise<Response> {
  if (!(await styleFileAccess())) return notFound();
  let bytes: Buffer;
  try {
    bytes = await readFile(join(FOLDER, folder, name));
  } catch {
    return notFound();
  }
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'content-type': contentType,
      'cache-control': 'private, max-age=3600',
      'x-content-type-options': 'nosniff',
    },
  });
}
