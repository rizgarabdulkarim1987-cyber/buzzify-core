'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { KeyRound, Mail, MoreHorizontal, Power, PowerOff, Trash2, UserPlus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { resendInvitation, revokeInvitation } from '@/app/studio/_actions/people';
import type { InvitationRow, PersonRow } from '@/server/studio/services/people';
import { describeFailure } from '@/studio/errors';
import { formatDate, numberFormat } from '@/studio/format';
import { useLocale, useT } from '@/studio/i18n';
import { InviteLinkNote, type IssuedInvitation } from '@/studio/shell/InviteLinkNote';
import { Button } from '@/studio/ui/Button';
import { DataTable } from '@/studio/ui/DataTable';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/studio/ui/DropdownMenu';
import { FilterBar, SearchFilter } from '@/studio/ui/FilterBar';
import { IconButton } from '@/studio/ui/IconButton';
import { isolated } from '@/studio/ui/isolate';
import { PageHeader } from '@/studio/ui/PageHeader';
import { Pagination } from '@/studio/ui/Pagination';
import { StatusBadge } from '@/studio/ui/StatusBadge';
import { InviteOwnerDialog, InviteStaffDialog, PersonDialogs, type PersonAction } from './PeopleDialogs';

interface Page<T> {
  rows: T[];
  page: number;
  pageSize: number;
  total: number;
}

/** How many of a person's restaurants the table names before it says "and so many more". */
const SHOWN_RESTAURANTS = 2;

/** What a person can do in the Studio, in words: Super Admin, or each restaurant with their role there. */
function Access({ person }: { person: PersonRow }) {
  const t = useT();
  const { locale } = useLocale();
  const shown = person.memberships.slice(0, SHOWN_RESTAURANTS);
  const more = person.memberships.length - shown.length;
  if (!person.isSuperAdmin && person.memberships.length === 0) return <span className="text-muted">{t('people.access.none')}</span>;
  return (
    <div className="flex min-w-0 flex-col py-1">
      {person.isSuperAdmin && <span className="text-text">{t('role.SUPER_ADMIN')}</span>}
      {shown.map((membership) => (
        <span key={membership.restaurantId} dir="auto" className="truncate text-text">
          {t(`role.${membership.role}`)} · {membership.restaurantName}
        </span>
      ))}
      {more > 0 && (
        <span className="text-xs text-muted" title={person.memberships.map((m) => m.restaurantName).join(', ')}>
          +{numberFormat(locale).format(more)}
        </span>
      )}
    </div>
  );
}

/** One person's actions. A Super Admin keeps to the platform's view of themselves: they cannot deactivate or re-address their own account here. */
function RowActions({ person, me, onAction }: { person: PersonRow; me: string; onAction: (action: PersonAction) => void }) {
  const t = useT();
  const own = person.userId === me;
  const canAssign = !person.deactivated && !person.isSuperAdmin;
  if (own && !canAssign) return null;
  const canDelete = person.deactivated && !person.isSuperAdmin && !own;
  return (
    <div className="flex items-center justify-end gap-1">
      {canDelete && (
        <IconButton label={t('people.delete')} icon={<Trash2 aria-hidden />} size="sm" className="hover:text-danger" onClick={() => onAction('delete')} />
      )}
      <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <IconButton label={t('people.actions', { name: person.name })} icon={<MoreHorizontal aria-hidden />} size="sm" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {canAssign && (
          <DropdownMenuItem icon={<UserPlus aria-hidden />} onSelect={() => onAction('assign')}>
            {t('people.assign')}
          </DropdownMenuItem>
        )}
        {!own && (
          <>
            <DropdownMenuItem icon={<Mail aria-hidden />} onSelect={() => onAction('email')}>
              {t('people.changeEmail')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {person.deactivated ? (
              <>
                <DropdownMenuItem icon={<Power aria-hidden />} onSelect={() => onAction('reactivate')}>
                  {t('people.reactivate')}
                </DropdownMenuItem>
                {!person.isSuperAdmin && (
                  <DropdownMenuItem danger icon={<Trash2 aria-hidden />} onSelect={() => onAction('delete')}>
                    {t('people.delete')}
                  </DropdownMenuItem>
                )}
              </>
            ) : (
              <DropdownMenuItem danger icon={<PowerOff aria-hidden />} onSelect={() => onAction('deactivate')}>
                {t('people.deactivate')}
              </DropdownMenuItem>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
    </div>
  );
}

/**
 * The People screen for Super Admins: everyone who can sign in (with search and paging), the invitations waiting, and
 * the things that change who has access: inviting staff or an owner, assigning a designer to a restaurant, changing an
 * address, switching an account off and on. The link of an invitation just made or renewed is shown once, with a Copy
 * button, because it is stored nowhere.
 */
export function PeopleManager({
  me,
  people,
  invitations,
  space = 'food',
}: {
  me: string;
  people: Page<PersonRow>;
  invitations: Page<InvitationRow>;
  /** The project the screen is in: the businesses to pick from are its own. */
  space?: 'food' | 'pharmacy';
}) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const [issued, setIssued] = useState<IssuedInvitation | null>(null);
  const [inviting, setInviting] = useState<'staff' | 'owner' | null>(null);
  const [target, setTarget] = useState<{ person: PersonRow; action: PersonAction } | null>(null);
  const [working, startWorking] = useTransition();

  const columns = useMemo<ColumnDef<PersonRow, unknown>[]>(
    () => [
      {
        id: 'name',
        header: t('people.list.name'),
        cell: ({ row }) => (
          <span dir="auto" className="font-medium text-text">
            {row.original.name}
          </span>
        ),
      },
      {
        id: 'email',
        header: t('people.list.email'),
        cell: ({ row }) => (
          <span dir="ltr" className="inline-block truncate text-muted">
            {row.original.email}
          </span>
        ),
      },
      { id: 'access', header: t('people.list.access'), cell: ({ row }) => <Access person={row.original} /> },
      {
        id: 'twoFactor',
        header: t('people.list.twoFactor'),
        meta: { width: '110px' },
        cell: ({ row }) => (
          <StatusBadge tone={row.original.twoFactorEnabled ? 'success' : 'neutral'}>
            {row.original.twoFactorEnabled ? t('status.on') : t('status.off')}
          </StatusBadge>
        ),
      },
      {
        id: 'status',
        header: t('people.list.status'),
        meta: { width: '130px' },
        cell: ({ row }) =>
          row.original.deactivated ? <StatusBadge tone="danger">{t('status.deactivated')}</StatusBadge> : <StatusBadge tone="success">{t('status.active')}</StatusBadge>,
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">{t('common.moreActions')}</span>,
        meta: { width: '48px', align: 'end' },
        cell: ({ row }) => <RowActions person={row.original} me={me} onAction={(action) => setTarget({ person: row.original, action })} />,
      },
    ],
    [t, me],
  );

  const resend = (invitation: InvitationRow) =>
    startWorking(async () => {
      const result = await resendInvitation({ invitationId: invitation.id, ...(invitation.restaurantId ? { restaurantId: invitation.restaurantId } : {}) });
      if (result.ok) setIssued({ email: invitation.email, url: result.data.url });
      else toast.error(describeFailure(t, locale, result.error).message);
      router.refresh();
    });

  const withdraw = (invitation: InvitationRow) =>
    startWorking(async () => {
      const result = await revokeInvitation({ invitationId: invitation.id, ...(invitation.restaurantId ? { restaurantId: invitation.restaurantId } : {}) });
      if (result.ok) toast.success(t('restaurants.people.revoked'));
      else toast.error(describeFailure(t, locale, result.error).message);
      router.refresh();
    });

  return (
    <>
      <PageHeader
        title={t('people.title')}
        description={t('people.description')}
        actions={
          <>
            <Button variant="secondary" icon={<KeyRound aria-hidden />} onClick={() => setInviting('owner')}>
              {t('people.inviteOwner')}
            </Button>
            <Button variant="primary" icon={<UserPlus aria-hidden />} onClick={() => setInviting('staff')}>
              {t('people.inviteStaff')}
            </Button>
          </>
        }
      />
      <div className="flex flex-col gap-10 px-8 pb-10">
        {issued && (
          <div className="max-w-3xl">
            <InviteLinkNote issued={issued} onDismiss={() => setIssued(null)} />
          </div>
        )}

        <section aria-label={t('people.list.caption')} className="flex flex-col gap-4">
          <FilterBar params={['q']}>
            <SearchFilter placeholder={t('people.search')} label={t('people.searchLabel')} className="w-80" />
          </FilterBar>
          <DataTable
            columns={columns}
            data={people.rows}
            getRowId={(row) => row.userId}
            caption={t('people.list.caption')}
          />
          <Pagination page={people.page} pageSize={people.pageSize} total={people.total} />
        </section>

        <section aria-labelledby="invitations-title" className="flex flex-col gap-3">
          <h2 id="invitations-title" className="text-md font-semibold text-text">
            {t('people.invitations.title')}
          </h2>
          {invitations.rows.length === 0 ? (
            <p className="border-y border-line py-6 text-base text-muted">{t('people.invitations.empty')}</p>
          ) : (
            <>
              <ul className="divide-y divide-line border-y border-line">
                {invitations.rows.map((invitation) => (
                  <li key={invitation.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2.5">
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span dir="ltr" className="truncate text-base text-text rtl:text-right">
                        {invitation.email}
                      </span>
                      <span className="text-sm text-muted">
                        {invitation.restaurantName ? (
                          <>
                            {t(`role.${invitation.role ?? 'OWNER'}`)} · <bdi>{invitation.restaurantName}</bdi>
                          </>
                        ) : invitation.asSuperAdmin ? (
                          t('role.SUPER_ADMIN')
                        ) : (
                          t('people.invitations.staff')
                        )}
                        {' · '}
                        {isolated(t('people.invitations.invitedBy'), { name: invitation.invitedBy })}
                        {' · '}
                        {isolated(t('restaurants.people.expires'), { time: formatDate(invitation.expiresAt, locale) })}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant="ghost" disabled={working} onClick={() => resend(invitation)}>
                        {t('restaurants.people.resend')}
                      </Button>
                      <Button size="sm" variant="ghost" disabled={working} onClick={() => withdraw(invitation)}>
                        {t('restaurants.people.revoke')}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
              <Pagination page={invitations.page} pageSize={invitations.pageSize} total={invitations.total} param="ipage" />
            </>
          )}
        </section>
      </div>

      <InviteStaffDialog
        open={inviting === 'staff'}
        onOpenChange={(open) => !open && setInviting(null)}
        onIssued={(link) => {
          setIssued(link);
          router.refresh();
        }}
      />
      <InviteOwnerDialog
        space={space}
        open={inviting === 'owner'}
        onOpenChange={(open) => !open && setInviting(null)}
        onIssued={(link) => {
          setIssued(link);
          router.refresh();
        }}
      />
      <PersonDialogs
        space={space}
        person={target?.person ?? null}
        action={target?.action ?? null}
        onClose={() => setTarget(null)}
        onDone={() => {
          setTarget(null);
          router.refresh();
        }}
      />
    </>
  );
}
