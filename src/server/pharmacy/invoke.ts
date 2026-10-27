import type { ActionDef } from '@/server/studio/framework/action';
import { invoke, invokeQuery } from '@/server/studio/framework/invoke';
import type { QueryDef } from '@/server/studio/framework/query';
import { failure, type ActionResult } from '@/server/studio/framework/result';
import { currentPhPlaceInput } from './actor';
import { withPlace } from './place-input';

/**
 * How the pharmacy's Server Actions (src/app/pharmacy/_actions) and its file routes run a definition: the restaurant and
 * branch come from the place the person chose (`currentPhPlaceInput`: the signed cookie, checked against the database
 * on this request), never from the browser. Without a valid place the call is refused before the framework runs.
 * tests/studio/enforcement.test.ts holds the actions folder to these two forwards.
 */
export async function invokePh<I, O>(def: ActionDef<I, O>, raw: unknown): Promise<ActionResult<O>> {
  const place = await currentPhPlaceInput();
  if (!place) return failure('FORBIDDEN');
  return invoke(def, withPlace(raw, place));
}

export async function invokePhQuery<I, O>(def: QueryDef<I, O>, raw: unknown): Promise<ActionResult<O>> {
  const place = await currentPhPlaceInput();
  if (!place) return failure('FORBIDDEN');
  return invokeQuery(def, withPlace(raw, place));
}
