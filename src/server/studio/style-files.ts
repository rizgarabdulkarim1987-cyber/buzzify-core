import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isOwnerOnly } from '@/studio/nav';
import { getActor } from './auth/actor';

/**
 * The menu-style showroom's files (`src/studio/styles`): the five mockup pages and the posters of the styles. They
 * are for Studio staff, so an owner of a restaurant, a signed-out visitor and a Super Admin without two-factor all get "not found". `next.config.ts`
 * traces the folders into the standalone build, which does not see a file read at run time.
 */

const FOLDER = join(process.cwd(), 'src', 'studio', 'styles');

/**
 * Whether the visitor is Studio staff who may see the showroom: signed in, not only an owner of a restaurant, and a Super
 * Admin only with two-factor on (the rule of `admit` in the framework, which every other Studio route goes through).
 */
export async function styleFileAccess(): Promise<boolean> {
  const actor = await getActor();
  if (actor === null) return false;
  if (actor.isSuperAdmin && !actor.twoFactorEnabled) return false;
  return !isOwnerOnly(actor);
}

export function notFoundResponse(): Response {
  return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
}

/** Serves one file of the showroom, or "not found" when the visitor may not see it or the file is missing. */
export async function serveStyleFile(folder: 'pages' | 'posters', name: string, contentType: string): Promise<Response> {
  if (!(await styleFileAccess())) return notFoundResponse();
  let bytes: Buffer;
  try {
    bytes = await readFile(join(FOLDER, folder, name));
  } catch {
    return notFoundResponse();
  }
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'content-type': contentType,
      'cache-control': 'private, no-cache',
      'x-content-type-options': 'nosniff',
    },
  });
}
