'use client';

import { ArrowDown, ArrowUp, MapPin, Pencil, Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { createBranch, deleteBranch, reorderBranches, updateBranch } from '@/app/studio/_actions/restaurants';
import { emptyWorkingHours, type WorkingHours } from '@/server/domain/restaurant-profile';
import { describeFailure } from '@/studio/errors';
import { useActionForm, type FormValues } from '@/studio/forms';
import { useLocale, useT } from '@/studio/i18n';
import { useRefuse } from '@/studio/refuse';
import { Button } from '@/studio/ui/Button';
import { ConfirmDialog } from '@/studio/ui/ConfirmDialog';
import { Dialog } from '@/studio/ui/Dialog';
import { EmptyState } from '@/studio/ui/EmptyState';
import { Field } from '@/studio/ui/Field';
import { FormError } from '@/studio/ui/FormError';
import { IconButton } from '@/studio/ui/IconButton';
import { Input } from '@/studio/ui/Input';
import { isolated } from '@/studio/ui/isolate';
import { parseHours, WorkingHoursField } from '../../WorkingHoursField';

export interface BranchView {
  id: string;
  name: string;
  address: string;
  city: string;
  phone: string;
  workingHours: WorkingHours;
  version: number;
}

const FIELDS = ['name', 'address', 'city', 'phone', 'workingHours'] as const;

const fieldsOf = (values: FormValues) => ({
  name: values.name ?? '',
  address: values.address ?? '',
  city: values.city ?? '',
  phone: values.phone ?? '',
  workingHours: parseHours(values.workingHours),
});

/** The restaurant's branches in their order: add, edit, delete and move. Without the right to edit, only the list. */
export function BranchesManager({ restaurantId, branches, canEdit }: { restaurantId: string; branches: BranchView[]; canEdit: boolean }) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const refuse = useRefuse();
  const [editing, setEditing] = useState<BranchView | 'new' | null>(null);
  const [deleting, setDeleting] = useState<BranchView | null>(null);
  const [moving, startMoving] = useTransition();

  const move = (from: number, to: number) =>
    startMoving(async () => {
      const order = branches.map((branch) => branch.id);
      const [item] = order.splice(from, 1);
      order.splice(to, 0, item!);
      const result = await reorderBranches({ restaurantId, order });
      if (!result.ok) toast.error(describeFailure(t, locale, result.error).message);
      router.refresh();
    });

  const add = canEdit && (
    <Button variant="primary" icon={<Plus aria-hidden />} onClick={() => setEditing('new')}>
      {t('restaurants.branches.add')}
    </Button>
  );

  return (
    <section aria-labelledby="branches-title" className="flex max-w-4xl flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="branches-title" className="text-md font-semibold text-text">
            {t('restaurants.branches.title')}
          </h2>
          <p className="max-w-[60ch] text-sm text-muted">{t('restaurants.branches.intro')}</p>
        </div>
        {branches.length > 0 && add}
      </div>

      {branches.length === 0 ? (
        <EmptyState
          icon={<MapPin aria-hidden />}
          title={t('restaurants.branches.emptyTitle')}
          body={t('restaurants.branches.emptyBody')}
          action={add || undefined}
        />
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {branches.map((branch, index) => (
            <li key={branch.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-base font-medium text-text">{branch.name}</span>
                <span className="truncate text-sm text-muted">
                  {[branch.address, branch.city].filter(Boolean).join(', ') || t('restaurants.summary.notSet')}
                </span>
              </div>
              {branch.phone && (
                <span dir="ltr" className="text-sm tabular-nums text-muted">
                  {branch.phone}
                </span>
              )}
              {canEdit && (
                <div className="flex shrink-0 items-center gap-0.5">
                  <IconButton
                    label={t('restaurants.branches.moveUp', { name: branch.name })}
                    icon={<ArrowUp aria-hidden />}
                    size="sm"
                    disabled={index === 0 || moving}
                    onClick={() => move(index, index - 1)}
                  />
                  <IconButton
                    label={t('restaurants.branches.moveDown', { name: branch.name })}
                    icon={<ArrowDown aria-hidden />}
                    size="sm"
                    disabled={index === branches.length - 1 || moving}
                    onClick={() => move(index, index + 1)}
                  />
                  <IconButton
                    label={t('restaurants.branches.editLabel', { name: branch.name })}
                    icon={<Pencil aria-hidden />}
                    size="sm"
                    onClick={() => setEditing(branch)}
                  />
                  <IconButton
                    label={t('restaurants.branches.deleteLabel', { name: branch.name })}
                    icon={<Trash2 aria-hidden />}
                    size="sm"
                    onClick={() => setDeleting(branch)}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <BranchDialog
          key={editing === 'new' ? 'new' : `${editing.id}:${editing.version}`}
          restaurantId={restaurantId}
          branch={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title={isolated(t('restaurants.branches.deleteTitle'), { name: deleting?.name ?? '' })}
        body={t('restaurants.branches.deleteBody')}
        confirmLabel={t('restaurants.branches.deleteConfirm')}
        onConfirm={async () => {
          if (!deleting) return true;
          const result = await deleteBranch({ restaurantId, branchId: deleting.id });
          if (!result.ok) return refuse(result);
          toast.success(t('restaurants.branches.deleted'));
          router.refresh();
          return true;
        }}
      />
    </section>
  );
}

/** The form for one branch in a dialog. It is mounted only while open, so each opening starts from the stored branch. */
function BranchDialog({ restaurantId, branch, onClose }: { restaurantId: string; branch: BranchView | null; onClose: () => void }) {
  const t = useT();
  const router = useRouter();
  const formId = useId();
  const form = useActionForm<unknown>(
    (values) =>
      branch
        ? updateBranch({ restaurantId, branchId: branch.id, version: branch.version, ...fieldsOf(values) })
        : createBranch({ restaurantId, ...fieldsOf(values) }),
    {
      keep: FIELDS,
      onSuccess: () => {
        toast.success(t(branch ? 'restaurants.branches.saved' : 'restaurants.branches.added'));
        router.refresh();
        onClose();
      },
    },
  );
  const kept = (name: (typeof FIELDS)[number], fallback: string) => form.value(name) ?? fallback;
  const hoursMessage = Object.entries(form.errors).find(([name]) => name === 'workingHours' || name.startsWith('workingHours.'))?.[1];

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={branch ? t('restaurants.branches.editTitle') : t('restaurants.branches.addTitle')}
      width="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form={formId} variant="primary" pending={form.pending}>
            {form.pending ? t('common.saving') : t('common.save')}
          </Button>
        </>
      }
    >
      <form id={formId} {...form.props} className="flex flex-col gap-4">
        <FormError form={form} fields={FIELDS}>
          {form.failure?.code === 'CONFLICT' && (
            <Button
              size="sm"
              variant="secondary"
              className="mt-2"
              onClick={() => {
                router.refresh();
                onClose();
              }}
            >
              {t('restaurants.form.reload')}
            </Button>
          )}
        </FormError>
        <Field label={t('restaurants.branches.name')} error={form.fieldError('name')}>
          <Input name="name" autoComplete="off" autoFocus defaultValue={kept('name', branch?.name ?? '')} />
        </Field>
        <Field label={t('restaurants.form.address')} optional error={form.fieldError('address')}>
          <Input name="address" autoComplete="off" defaultValue={kept('address', branch?.address ?? '')} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('restaurants.form.city')} optional error={form.fieldError('city')}>
            <Input name="city" autoComplete="off" defaultValue={kept('city', branch?.city ?? '')} />
          </Field>
          <Field label={t('restaurants.form.phone')} optional error={form.fieldError('phone')}>
            <Input name="phone" type="tel" dir="ltr" className="rtl:text-right" autoComplete="off" defaultValue={kept('phone', branch?.phone ?? '')} />
          </Field>
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-text">{t('restaurants.form.hours')}</span>
          <WorkingHoursField
            name="workingHours"
            defaultValue={branch?.workingHours ?? emptyWorkingHours()}
            error={hoursMessage}
            focusOnError={hoursMessage !== undefined && Object.keys(form.errors).every((name) => name.startsWith('workingHours'))}
            attempt={form.attempt}
          />
        </div>
      </form>
    </Dialog>
  );
}
