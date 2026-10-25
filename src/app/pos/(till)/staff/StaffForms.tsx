'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { changePosStaffRole, clearPosStaffPin, createPosStaff, setPosStaffActive } from '@/app/studio/_actions/pos';
import { POS_ROLES, type PosRole } from '@/server/domain/pos/permissions';
import type { PosStaffView } from '@/server/pos/staff';
import { requireFields, useActionForm } from '@/studio/forms';
import { describeFailure } from '@/studio/errors';
import { useLocale, useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';
import { Button } from '@/studio/ui/Button';
import { Field } from '@/studio/ui/Field';
import { FormError } from '@/studio/ui/FormError';
import { Input, PasswordInput } from '@/studio/ui/Input';
import { Select } from '@/studio/ui/Select';

/** The roles a person in `own` may hand out: an owner any, a manager the floor roles. Mirrors `mayAssign` on the server. */
function assignable(own: PosRole): readonly PosRole[] {
  if (own === 'OWNER') return POS_ROLES;
  return own === 'MANAGER' ? ['CASHIER', 'KITCHEN'] : [];
}

/** Whether a person in `own` may change a row now holding `current` (the server decides; this only hides what would be refused). */
function mayChange(own: PosRole, current: PosRole): boolean {
  return own === 'OWNER' || (own === 'MANAGER' && (current === 'CASHIER' || current === 'KITCHEN'));
}

export function AddStaffForm({ ownRole }: { ownRole: PosRole }) {
  const t = useT();
  const router = useRouter();
  const roles = assignable(ownRole);
  const form = useActionForm(
    (values) =>
      createPosStaff({
        name: values.name ?? '',
        email: values.email ?? '',
        role: values.role ?? '',
        ...(values.password ? { password: values.password } : {}),
      }),
    {
      keep: ['name', 'email', 'role'],
      validate: (values) => requireFields(values, { name: t('error.text.nameEnter'), email: t('error.text.emailInvalid') }),
      onSuccess: () => {
        toast.success(t('pos.staff.created'));
        router.refresh();
      },
    },
  );

  return (
    <section aria-labelledby="pos-add-staff" className="flex flex-col gap-4 border-t border-line pt-6">
      <h2 id="pos-add-staff" className="text-base font-semibold text-text">
        {t('pos.staff.add')}
      </h2>
      <form {...form.props} className="flex max-w-md flex-col gap-4">
        <FormError form={form} fields={['name', 'email', 'role', 'password']} />
        <Field label={t('pos.staff.name')} error={form.fieldError('name')}>
          <Input name="name" autoComplete="off" defaultValue={form.value('name')} />
        </Field>
        <Field label={t('pos.staff.email')} error={form.fieldError('email')}>
          <Input name="email" type="email" dir="ltr" className="rtl:text-right" autoComplete="off" defaultValue={form.value('email')} />
        </Field>
        <Field label={t('pos.staff.password')} hint={t('pos.staff.passwordHint')} error={form.fieldError('password')}>
          <PasswordInput name="password" autoComplete="new-password" />
        </Field>
        <Field label={t('pos.staff.role')} error={form.fieldError('role')}>
          <Select
            name="role"
            defaultValue={form.value('role') ?? roles[roles.length - 1] ?? 'CASHIER'}
            options={roles.map((role) => ({ value: role, label: t(`pos.role.${role}`) }))}
          />
        </Field>
        <Button type="submit" pending={form.pending} className="self-start">
          {t('pos.staff.create')}
        </Button>
      </form>
    </section>
  );
}

export function StaffList({ people, ownRole, ownUserId }: { people: PosStaffView[]; ownRole: PosRole; ownUserId: string }) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const roles = assignable(ownRole);

  async function run(id: string, call: () => ReturnType<typeof changePosStaffRole> | ReturnType<typeof clearPosStaffPin>, done = t('pos.staff.changed')) {
    setBusy(id);
    const result = await settle(call);
    setBusy(null);
    if (result.ok) {
      toast.success(done);
      router.refresh();
    } else {
      toast.error(describeFailure(t, locale, result.error).message);
    }
  }

  return (
    <section aria-labelledby="pos-staff-list" className="flex flex-col gap-3">
      <h2 id="pos-staff-list" className="text-base font-semibold text-text">
        {t('pos.staff.list')}
      </h2>
      <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
        {people.map((person) => {
          const editable = !person.viaMembership && person.userId !== ownUserId && mayChange(ownRole, person.role);
          return (
            <li key={person.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-base text-text">{person.name}</span>
                <span className="truncate text-sm text-muted" dir="ltr">
                  {person.email}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {person.viaMembership ? (
                  <span className="text-sm text-muted">{t('pos.staff.owner')}</span>
                ) : editable ? (
                  <Select
                    aria-label={t('pos.staff.role')}
                    value={person.role}
                    disabled={busy === person.id}
                    onChange={(event) => void run(person.id, () => changePosStaffRole({ staffId: person.id, role: event.target.value }))}
                    options={roles.map((role) => ({ value: role, label: t(`pos.role.${role}`) }))}
                  />
                ) : (
                  <span className="text-sm text-muted">{t(`pos.role.${person.role}`)}</span>
                )}
                <span className="text-sm text-muted">{person.active ? t('pos.staff.active') : t('pos.staff.inactive')}</span>
                <span className="text-sm text-muted">{person.hasPin ? t('pos.staff.hasPin') : t('pos.staff.noPin')}</span>
                {editable && person.hasPin && (
                  <Button variant="secondary" size="sm" pending={busy === person.id} onClick={() => void run(person.id, () => clearPosStaffPin({ staffId: person.id }), t('pos.staff.pinCleared'))}>
                    {t('pos.staff.clearPin')}
                  </Button>
                )}
                {editable && (
                  <Button
                    variant="secondary"
                    size="sm"
                    pending={busy === person.id}
                    onClick={() => void run(person.id, () => setPosStaffActive({ staffId: person.id, active: !person.active }))}
                  >
                    {person.active ? t('pos.staff.deactivate') : t('pos.staff.reactivate')}
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
