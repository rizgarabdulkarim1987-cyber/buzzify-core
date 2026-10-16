'use client';

import { Mail, UserMinus, UserRound } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { inviteOwner, resendInvitation, revokeInvitation, unassignMember } from '@/app/studio/_actions/people';
import type { MemberRole } from '@/server/domain/permissions';
import { describeFailure } from '@/studio/errors';
import { formatDate } from '@/studio/format';
import { requireFields, useActionForm } from '@/studio/forms';
import { useLocale, useT } from '@/studio/i18n';
import { useRefuse } from '@/studio/refuse';
import { Button } from '@/studio/ui/Button';
import { ConfirmDialog } from '@/studio/ui/ConfirmDialog';
import { CopyButton } from '@/studio/ui/CopyButton';
import { EmptyState } from '@/studio/ui/EmptyState';
import { Field } from '@/studio/ui/Field';
import { FormError } from '@/studio/ui/FormError';
import { IconButton } from '@/studio/ui/IconButton';
import { Input } from '@/studio/ui/Input';
import { isolated } from '@/studio/ui/isolate';
import { StatusBadge } from '@/studio/ui/StatusBadge';

export interface MemberView {
  userId: string;
  name: string;
  email: string;
  role: MemberRole;
  deactivated: boolean;
  since: string;
}

export interface InvitationView {
  id: string;
  email: string;
  expiresAt: string;
}

interface Issued {
  email: string;
  url: string;
}

/** An invitation's link, shown once: it is stored nowhere, so this is the only time it can be copied. */
function LinkNote({ issued, onDismiss }: { issued: Issued; onDismiss: () => void }) {
  const t = useT();
  return (
    <div role="status" className="flex flex-col gap-3 rounded-md border border-line bg-surface p-4">
      <div className="flex flex-col gap-1">
        <p className="text-base font-medium text-text">{isolated(t('restaurants.people.linkTitle'), { email: issued.email })}</p>
        <p className="max-w-[64ch] text-sm text-muted">{t('restaurants.people.linkBody')}</p>
      </div>
      <div className="flex items-center gap-2">
        <Input
          readOnly
          dir="ltr"
          value={issued.url}
          aria-label={t('restaurants.people.linkLabel')}
          className="font-mono text-xs"
          onFocus={(event) => event.currentTarget.select()}
        />
        <CopyButton value={issued.url} size="md" variant="secondary" />
      </div>
      <Button variant="ghost" size="sm" className="self-start" onClick={onDismiss}>
        {t('restaurants.people.linkDismiss')}
      </Button>
    </div>
  );
}

/** Members, the form to invite an owner, and the invitations still waiting. */
export function PeoplePanel({
  restaurantId,
  restaurantName,
  canManage,
  members,
  invitations,
}: {
  restaurantId: string;
  restaurantName: string;
  canManage: boolean;
  members: MemberView[];
  invitations: InvitationView[];
}) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const refuse = useRefuse();
  const [issued, setIssued] = useState<Issued | null>(null);
  const [removing, setRemoving] = useState<MemberView | null>(null);
  const [working, startWorking] = useTransition();

  const invite = useActionForm((values) => inviteOwner({ restaurantId, email: values.email ?? '' }), {
    validate: (values) => requireFields(values, { email: t('error.text.emailInvalid') }),
    onSuccess: ({ url }, values) => {
      setIssued({ email: (values.email ?? '').trim().toLowerCase(), url });
      router.refresh();
    },
  });

  const resend = (invitation: InvitationView) =>
    startWorking(async () => {
      const result = await resendInvitation({ invitationId: invitation.id, restaurantId });
      if (result.ok) setIssued({ email: invitation.email, url: result.data.url });
      else toast.error(describeFailure(t, locale, result.error).message);
      router.refresh();
    });

  const withdraw = (invitation: InvitationView) =>
    startWorking(async () => {
      const result = await revokeInvitation({ invitationId: invitation.id, restaurantId });
      if (result.ok) toast.success(t('restaurants.people.revoked'));
      else toast.error(describeFailure(t, locale, result.error).message);
      router.refresh();
    });

  return (
    <div className="flex max-w-4xl flex-col gap-10">
      <section aria-labelledby="members-title" className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="members-title" className="text-md font-semibold text-text">
            {t('restaurants.people.members')}
          </h2>
          <p className="text-sm text-muted">{t('restaurants.people.membersIntro')}</p>
        </div>
        {members.length === 0 ? (
          <EmptyState icon={<UserRound aria-hidden />} title={t('restaurants.people.emptyTitle')} body={t('restaurants.people.emptyBody')} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">{t('restaurants.people.members')}</caption>
              <thead>
                <tr className="border-b border-line">
                  {(['name', 'email', 'role', 'since'] as const).map((column) => (
                    <th key={column} scope="col" className="h-9 px-3 text-start text-xs font-medium text-muted first:ps-4">
                      {t(`restaurants.people.${column}`)}
                    </th>
                  ))}
                  {canManage && <th scope="col" className="h-9 w-12 px-3 last:pe-4"><span className="sr-only">{t('common.moreActions')}</span></th>}
                </tr>
              </thead>
              <tbody>
                {members.map((member) => (
                  <tr key={member.userId} className="border-b border-line">
                    <td className="h-10 px-3 first:ps-4">
                      <span className="flex items-center gap-2">
                        <bdi className="font-medium text-text">{member.name}</bdi>
                        {member.deactivated && <StatusBadge>{t('status.deactivated')}</StatusBadge>}
                      </span>
                    </td>
                    <td className="h-10 px-3">
                      <span dir="ltr" className="inline-block text-muted">
                        {member.email}
                      </span>
                    </td>
                    <td className="h-10 px-3">{t(`role.${member.role}`)}</td>
                    <td className="h-10 whitespace-nowrap px-3 text-muted">{formatDate(member.since, locale)}</td>
                    {canManage && (
                      <td className="h-10 px-3 text-end last:pe-4">
                        <IconButton
                          label={t('restaurants.people.removeLabel', { name: member.name })}
                          icon={<UserMinus aria-hidden />}
                          size="sm"
                          onClick={() => setRemoving(member)}
                        />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="invite-title" className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="invite-title" className="text-md font-semibold text-text">
            {t('restaurants.people.inviteTitle')}
          </h2>
          <p className="max-w-[64ch] text-sm text-muted">{t('restaurants.people.inviteIntro')}</p>
        </div>
        <form {...invite.props} className="flex max-w-md flex-col gap-3">
          <FormError form={invite} fields={['email']} />
          <Field label={t('restaurants.people.inviteEmail')} error={invite.fieldError('email')}>
            <Input name="email" type="email" dir="ltr" className="rtl:text-right" autoComplete="off" />
          </Field>
          <Button type="submit" variant="primary" icon={<Mail aria-hidden />} pending={invite.pending} className="self-start">
            {invite.pending ? t('restaurants.people.inviting') : t('restaurants.people.inviteSubmit')}
          </Button>
        </form>
        {issued && <LinkNote issued={issued} onDismiss={() => setIssued(null)} />}
      </section>

      {invitations.length > 0 && (
        <section aria-labelledby="pending-title" className="flex flex-col gap-3">
          <h2 id="pending-title" className="text-md font-semibold text-text">
            {t('restaurants.people.pendingTitle')}
          </h2>
          <ul className="divide-y divide-line border-y border-line">
            {invitations.map((invitation) => (
              <li key={invitation.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2.5">
                <div className="flex min-w-0 flex-1 flex-col">
                  <span dir="ltr" className="truncate text-base text-text rtl:text-right">
                    {invitation.email}
                  </span>
                  <span className="text-sm text-muted">
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
        </section>
      )}

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title={isolated(t('restaurants.people.removeTitle'), { name: removing?.name ?? '' })}
        body={isolated(t('restaurants.people.removeBody'), { name: removing?.name ?? '', restaurant: restaurantName })}
        confirmLabel={t('restaurants.people.removeConfirm')}
        onConfirm={async () => {
          if (!removing) return true;
          const result = await unassignMember({ userId: removing.userId, restaurantId });
          if (!result.ok) return refuse(result);
          toast.success(t('restaurants.people.removed'));
          router.refresh();
          return true;
        }}
      />
    </div>
  );
}
