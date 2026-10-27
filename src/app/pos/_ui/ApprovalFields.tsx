'use client';

import { DISCOUNT_REASONS, type Approver } from '@/lib/pos-approval';
import { useT } from '@/studio/i18n';
import { Alert } from '@/studio/ui/Alert';
import { Field } from '@/studio/ui/Field';
import { Input, PasswordInput } from '@/studio/ui/Input';
import { Select } from '@/studio/ui/Select';

/** The manager who approves, and their own PIN: put inside a dialog's form when a cashier's action needs approval. */
export function ApprovalFields({ approvers, errors }: { approvers: Approver[]; errors: Record<string, string> }) {
  const t = useT();
  if (approvers.length === 0) return <Alert tone="danger">{t('pos.approval.none')}</Alert>;
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line p-3">
      <p className="text-sm text-muted">{t('pos.approval.hint')}</p>
      <Field label={t('pos.approval.manager')} error={errors.approvalStaffId}>
        <Select name="approvalStaffId" size="lg" options={approvers.map((approver) => ({ value: approver.staffId, label: approver.name }))} />
      </Field>
      <Field label={t('pos.approval.pin')} error={errors.approvalPin}>
        <PasswordInput name="approvalPin" size="lg" inputMode="numeric" autoComplete="off" maxLength={8} dir="ltr" />
      </Field>
    </div>
  );
}

/** Why a discount is given: a short list, and a note that the last choice requires. */
export function DiscountReasonFields({ errors }: { errors: Record<string, string> }) {
  const t = useT();
  return (
    <div className="flex flex-wrap items-end gap-3">
      <Field label={t('pos.discount.reason')} className="w-56">
        <Select name="reason" size="lg" defaultValue="MANAGER_DECISION" options={DISCOUNT_REASONS.map((reason) => ({ value: reason, label: t(`pos.discount.reason.${reason}`) }))} />
      </Field>
      <Field label={t('pos.discount.note')} error={errors.note} className="min-w-48 flex-1">
        <Input name="note" size="lg" maxLength={300} />
      </Field>
    </div>
  );
}

/** The approval typed into a dialog's form, or undefined when none was asked for or no PIN was typed. */
export function approvalOf(form: FormData): { staffId: string; pin: string } | undefined {
  const staffId = String(form.get('approvalStaffId') ?? '');
  const pin = String(form.get('approvalPin') ?? '').trim();
  return staffId !== '' && pin !== '' ? { staffId, pin } : undefined;
}
