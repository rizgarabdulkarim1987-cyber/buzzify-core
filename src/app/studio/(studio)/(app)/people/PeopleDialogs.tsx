'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import {
  assignDesigner,
  changeUserEmail,
  deactivateUser,
  deleteUser,
  inviteOwner,
  inviteStaff,
  reactivateUser,
} from '@/app/studio/_actions/people';
import type { PersonRow } from '@/server/studio/services/people';
import { useT } from '@/studio/i18n';
import { findRestaurantOptionsIn } from '@/studio/pickers';
import { useRefuse } from '@/studio/refuse';
import type { IssuedInvitation } from '@/studio/shell/InviteLinkNote';
import { ConfirmDialog } from '@/studio/ui/ConfirmDialog';
import { Field } from '@/studio/ui/Field';
import { Input } from '@/studio/ui/Input';
import { isolated } from '@/studio/ui/isolate';
import { Picker, type PickerOption } from '@/studio/ui/Picker';
import { Select } from '@/studio/ui/Select';

const EMAIL_INPUT = { type: 'email', dir: 'ltr', autoComplete: 'off', className: 'rtl:text-right' } as const;

const typed = (form: FormData, name: string) => String(form.get(name) ?? '').trim();

/** Invite a member of the agency: a designer, who works on the restaurants they are assigned to, or another Super Admin. */
export function InviteStaffDialog({
  open,
  onOpenChange,
  onIssued,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onIssued: (issued: IssuedInvitation) => void;
}) {
  const t = useT();
  const refuse = useRefuse();
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      tone="primary"
      title={t('people.staff.title')}
      body={t('people.staff.intro')}
      confirmLabel={t('people.staff.submit')}
      onConfirm={async (form) => {
        const email = typed(form, 'email');
        if (email === '') return { fields: { email: t('error.text.emailInvalid') } };
        const result = await inviteStaff({ email, asSuperAdmin: typed(form, 'role') === 'SUPER_ADMIN' });
        if (!result.ok) return refuse(result, ['email', 'asSuperAdmin']);
        onIssued({ email: email.toLowerCase(), url: result.data.url });
        return true;
      }}
    >
      {(errors) => (
        <>
          <Field label={t('people.staff.email')} error={errors.email}>
            <Input name="email" {...EMAIL_INPUT} />
          </Field>
          <Field label={t('people.staff.role')}>
            <Select
              name="role"
              defaultValue="DESIGNER"
              options={[
                { value: 'DESIGNER', label: t('role.DESIGNER') },
                { value: 'SUPER_ADMIN', label: t('role.SUPER_ADMIN') },
              ]}
            />
          </Field>
        </>
      )}
    </ConfirmDialog>
  );
}

/** Invite the owner of a restaurant, chosen by typing part of its name or client ID: the restaurants are never all listed. */
export function InviteOwnerDialog({
  open,
  onOpenChange,
  onIssued,
  space,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onIssued: (issued: IssuedInvitation) => void;
  space: 'food' | 'pharmacy';
}) {
  const t = useT();
  const refuse = useRefuse();
  const [restaurant, setRestaurant] = useState<PickerOption | null>(null);
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setRestaurant(null);
        onOpenChange(next);
      }}
      tone="primary"
      title={t('people.owner.title')}
      body={t('people.owner.intro')}
      confirmLabel={t('people.staff.submit')}
      onConfirm={async (form) => {
        const email = typed(form, 'email');
        const restaurantId = typed(form, 'restaurantId');
        const missing: Record<string, string> = {};
        if (restaurantId === '') missing.restaurantId = t('error.text.restaurantChoose');
        if (email === '') missing.email = t('error.text.emailInvalid');
        if (Object.keys(missing).length > 0) return { fields: missing };
        const result = await inviteOwner({ restaurantId, email, space });
        if (!result.ok) return refuse(result, ['restaurantId', 'email']);
        onIssued({ email: email.toLowerCase(), url: result.data.url });
        setRestaurant(null);
        return true;
      }}
    >
      {(errors) => (
        <>
          <Field label={t('people.owner.restaurant')} error={errors.restaurantId}>
            <Picker name="restaurantId" value={restaurant} onChange={setRestaurant} search={findRestaurantOptionsIn[space]} placeholder={t('people.owner.pick')} />
          </Field>
          <Field label={t('people.staff.email')} error={errors.email}>
            <Input name="email" {...EMAIL_INPUT} />
          </Field>
        </>
      )}
    </ConfirmDialog>
  );
}

/** What can be done to one person, each in its own dialog. `person` is the row it is for; null closes them all. */
export type PersonAction = 'assign' | 'email' | 'deactivate' | 'reactivate' | 'delete';

export function PersonDialogs({
  person,
  action,
  onClose,
  onDone,
  space,
}: {
  person: PersonRow | null;
  action: PersonAction | null;
  onClose: () => void;
  onDone: () => void;
  space: 'food' | 'pharmacy';
}) {
  const t = useT();
  const refuse = useRefuse();
  const [restaurant, setRestaurant] = useState<PickerOption | null>(null);
  const name = person?.name ?? '';
  const close = (open: boolean) => {
    if (!open) {
      setRestaurant(null);
      onClose();
    }
  };
  const done = (message: string) => {
    toast.success(message);
    setRestaurant(null);
    onDone();
    return true as const;
  };

  return (
    <>
      <ConfirmDialog
        open={person !== null && action === 'assign'}
        onOpenChange={close}
        tone="primary"
        title={isolated(t('people.assign.title'), { name })}
        body={t('people.assign.body')}
        confirmLabel={t('people.assign.confirm')}
        onConfirm={async (form) => {
          const restaurantId = typed(form, 'restaurantId');
          if (restaurantId === '') return { fields: { restaurantId: t('error.text.restaurantChoose') } };
          const result = await assignDesigner({ userId: person?.userId ?? '', restaurantId, space });
          if (!result.ok) return refuse(result, ['restaurantId', 'userId']);
          return done(t('people.assign.done'));
        }}
      >
        {(errors) => (
          <Field label={t('people.assign.restaurant')} error={errors.restaurantId ?? errors.userId}>
            <Picker name="restaurantId" value={restaurant} onChange={setRestaurant} search={findRestaurantOptionsIn[space]} placeholder={t('people.owner.pick')} />
          </Field>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={person !== null && action === 'email'}
        onOpenChange={close}
        tone="primary"
        title={isolated(t('people.email.title'), { name })}
        body={t('people.email.body')}
        confirmLabel={t('people.email.confirm')}
        onConfirm={async (form) => {
          const email = typed(form, 'email');
          if (email === '') return { fields: { email: t('error.text.emailInvalid') } };
          const result = await changeUserEmail({ userId: person?.userId ?? '', email });
          if (!result.ok) return refuse(result, ['email', 'userId']);
          return done(t('people.email.done'));
        }}
      >
        {(errors) => (
          <Field label={t('people.email.new')} error={errors.email ?? errors.userId}>
            <Input name="email" {...EMAIL_INPUT} />
          </Field>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={person !== null && action === 'deactivate'}
        onOpenChange={close}
        title={isolated(t('people.deactivate.title'), { name })}
        body={t('people.deactivate.body')}
        confirmLabel={t('people.deactivate.confirm')}
        onConfirm={async () => {
          const result = await deactivateUser({ userId: person?.userId ?? '' });
          if (!result.ok) return refuse(result);
          return done(t('people.deactivate.done'));
        }}
      />

      <ConfirmDialog
        open={person !== null && action === 'delete'}
        onOpenChange={close}
        title={isolated(t('people.delete.title'), { name })}
        body={t('people.delete.body')}
        confirmLabel={t('people.delete.confirm')}
        onConfirm={async () => {
          const result = await deleteUser({ userId: person?.userId ?? '' });
          if (!result.ok) return refuse(result);
          return done(t('people.delete.done'));
        }}
      />

      <ConfirmDialog
        open={person !== null && action === 'reactivate'}
        onOpenChange={close}
        tone="primary"
        title={isolated(t('people.reactivate.title'), { name })}
        body={t('people.reactivate.body')}
        confirmLabel={t('people.reactivate.confirm')}
        onConfirm={async () => {
          const result = await reactivateUser({ userId: person?.userId ?? '' });
          if (!result.ok) return refuse(result);
          return done(t('people.reactivate.done'));
        }}
      />
    </>
  );
}
