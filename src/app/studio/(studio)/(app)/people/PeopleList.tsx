import { redirect } from 'next/navigation';
import { getActor } from '@/server/studio/auth/actor';
import { query, SIGN_IN_PATH } from '@/server/studio/framework/invoke';
import { listInvitations, listPeople } from '@/server/studio/queries/people';
import { PeopleManager } from './PeopleManager';

type RawParams = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** A page number from the address; anything that is not one is the first page. */
function pageOf(raw: string | string[] | undefined): number {
  const page = Number(first(raw));
  return Number.isInteger(page) && page >= 1 && page <= 100_000 ? page : 1;
}

/**
 * Everyone who can sign in to the Studio, and the invitations still waiting, for Super Admins (anyone else gets the
 * not-found page). Search and both pages live in the address (`q`, `page` for people, `ipage` for invitations).
 */
export async function PeopleList({ searchParams, space }: { searchParams: Promise<RawParams>; space: 'food' | 'pharmacy' | 'platform' }) {
  const actor = await getActor();
  if (!actor) redirect(SIGN_IN_PATH);
  const raw = await searchParams;
  const q = first(raw.q)?.trim().slice(0, 100) || undefined;
  const [people, invitations] = await Promise.all([
    query(listPeople, { ...(q ? { q } : {}), page: pageOf(raw.page), space }),
    query(listInvitations, { status: 'pending', page: pageOf(raw.ipage), space }),
  ]);

  return <PeopleManager me={actor.userId} people={people} invitations={invitations} space={space} />;
}
