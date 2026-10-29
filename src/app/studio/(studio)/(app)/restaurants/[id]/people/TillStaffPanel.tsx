'use client';

import { UserPlus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { addTillStaff } from '@/app/studio/_actions/people';
import { formatDate } from '@/studio/format';
import { requireFields, useActionForm } from '@/studio/forms';
import { useLocale, useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';
import { Field } from '@/studio/ui/Field';
import { FormError } from '@/studio/ui/FormError';
import { Input } from '@/studio/ui/Input';
import { Select } from '@/studio/ui/Select';
import { StatusBadge } from '@/studio/ui/StatusBadge';

export interface TillStaffView {
  staffId: string;
  name: string;
  email: string;
  role: 'OWNER' | 'MANAGER' | 'CASHIER' | 'KITCHEN' | 'CAPTAIN';
  active: boolean;
  since: string;
}

const ROLES = ['CASHIER', 'MANAGER', 'KITCHEN', 'CAPTAIN'] as const;

/** The till's people for one restaurant, and the form a Super Admin uses to add a cashier, a manager or a kitchen member. */
export function TillStaffPanel({ restaurantId, staff }: { restaurantId: string; staff: TillStaffView[] }) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();

  const add = useActionForm(
    (values) =>
      addTillStaff({ restaurantId, name: values.name ?? '', email: values.email ?? '', role: values.role ?? 'CASHIER', password: values.password ?? '' }),
    {
      validate: (values) =>
        requireFields(values, { name: t('error.text.nameEnter'), email: t('error.text.emailInvalid'), password: t('error.text.passwordChoose') }),
      onSuccess: () => {
        toast.success(t('restaurants.people.till.added'));
        router.refresh();
      },
    },
  );

  return (
    <section aria-labelledby="till-title" className="flex max-w-4xl flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="till-title" className="text-md font-semibold text-text">
          {t('restaurants.people.till.title')}
        </h2>
        <p className="max-w-[64ch] text-sm text-muted">{t('restaurants.people.till.intro')}</p>
      </div>

      {staff.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">{t('restaurants.people.till.title')}</caption>
            <tbody>
              {staff.map((person) => (
                <tr key={person.staffId} className="border-b border-line">
                  <td className="h-10 px-3 first:ps-4">
                    <span className="flex items-center gap-2">
                      <bdi className="font-medium text-text">{person.name}</bdi>
                      {!person.active && <StatusBadge>{t('status.deactivated')}</StatusBadge>}
                    </span>
                  </td>
                  <td className="h-10 px-3">
                    <span dir="ltr" className="inline-block text-muted">
                      {person.email}
                    </span>
                  </td>
                  <td className="h-10 px-3">{t(`pos.role.${person.role}`)}</td>
                  <td className="h-10 whitespace-nowrap px-3 text-muted">{formatDate(person.since, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form {...add.props} className="flex max-w-md flex-col gap-3">
        <FormError form={add} fields={['name', 'email', 'password', 'role']} />
        <Field label={t('restaurants.people.till.name')} error={add.fieldError('name')}>
          <Input name="name" autoComplete="off" />
        </Field>
        <Field label={t('restaurants.people.till.email')} error={add.fieldError('email')}>
          <Input name="email" type="email" dir="ltr" className="rtl:text-right" autoComplete="off" />
        </Field>
        <Field label={t('restaurants.people.till.password')} error={add.fieldError('password')}>
          <Input name="password" type="password" dir="ltr" className="rtl:text-right" autoComplete="new-password" />
        </Field>
        <Field label={t('restaurants.people.till.role')} error={add.fieldError('role')}>
          <Select name="role" defaultValue="CASHIER" options={ROLES.map((role) => ({ value: role, label: t(`pos.role.${role}`) }))} />
        </Field>
        <Button type="submit" variant="primary" icon={<UserPlus aria-hidden />} pending={add.pending} className="self-start">
          {add.pending ? t('restaurants.people.till.adding') : t('restaurants.people.till.submit')}
        </Button>
      </form>
    </section>
  );
}
