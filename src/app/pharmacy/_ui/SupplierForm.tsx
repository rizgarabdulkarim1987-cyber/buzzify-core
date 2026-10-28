'use client';

import { Archive, ArchiveRestore, CircleAlert, Info, Save } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { archiveSupplier, createSupplier, updateSupplier } from '@/app/pharmacy/_actions/suppliers';
import { draftKey, useDraft } from '@/lib/use-draft';
import { useLeaveGuard } from '@/lib/use-leave-guard';
import type { Currency } from '@/server/domain/pharmacy/money';
import type { SupplierView } from '@/server/pharmacy/suppliers';
import { useLocale, useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';
import { Button } from '@/studio/ui/Button';
import { Field } from '@/studio/ui/Field';
import { Input } from '@/studio/ui/Input';
import { Select } from '@/studio/ui/Select';
import { Textarea } from '@/studio/ui/Textarea';
import { OfflineNotice } from './OfflineNotice';
import { phMessage } from './ph-failure';
import { emptySupplierDraft, supplierInputOf, supplierSignature, type SupplierDraft } from './purchasing-logic';
import { newClientKey, keyFor } from './sell-logic';
import { UnsavedBadge } from './UnsavedBadge';
import { useOnline } from './use-online';

export interface SupplierFormProps {
  userId: string;
  restaurantId: string;
  currencies: Currency[];
  /** The supplier being edited; null for a new one. */
  supplier: SupplierView | null;
  writable: boolean;
}

function draftOf(s: SupplierView): SupplierDraft {
  return {
    version: s.version,
    clientKey: newClientKey('sup'),
    name: s.name,
    phone: s.phone,
    contactName: s.contactName,
    addressNote: s.addressNote,
    defaultCurrency: s.defaultCurrency,
    termsDays: String(s.termsDays),
    note: s.note,
  };
}

/**
 * The supplier form (new and edit). The typed values stay on this device (`useDraft`) with the badge and a leave guard;
 * a save sends the idempotency key made for exactly these values, so a retry after a lost answer is recorded once. A
 * stale version shows the conflict and offers to reload. Archiving asks first. No motion.
 */
export function SupplierForm({ userId, restaurantId, currencies, supplier, writable }: SupplierFormProps) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const online = useOnline();
  const [firstKey] = useState(() => newClientKey('sup'));
  const start = useMemo(() => (supplier ? draftOf(supplier) : emptySupplierDraft(firstKey, currencies[0] ?? 'IQD')), [supplier, firstKey, currencies]);
  const draft = useDraft<SupplierDraft>(draftKey(userId, `supplier@${restaurantId}`, supplier?.id ?? 'new'), start);
  const value = draft.value;
  const [pending, setPending] = useState<null | 'save' | 'archive'>(null);
  const [failure, setFailure] = useState<{ message: string; stale: boolean; fields: Record<string, string> } | null>(null);
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [archiving, setArchiving] = useState(false);
  useLeaveGuard(draft.dirty, t('pharmacy.catalog.leaveConfirm'));

  const change = (patch: Partial<SupplierDraft>) => {
    setSaved(false);
    draft.set({ ...value, ...patch });
  };
  const busy = pending !== null;
  const can = writable && online && !busy;
  const fieldError = (name: string): string | undefined => (problems[name] ? t(`pharmacy.purchasing.supplier.problem.${problems[name]}`) : failure?.fields[name]);

  const save = async () => {
    const built = supplierInputOf(value);
    setProblems(built.problems);
    if (!built.input) return;
    setPending('save');
    const sig = supplierSignature(value);
    const attempt = keyFor(value.keySig ? { sig: value.keySig, key: value.clientKey } : null, sig, 'sup');
    if (attempt.key !== value.clientKey || value.keySig !== sig) draft.set({ ...value, clientKey: attempt.key, keySig: sig });
    const result = await settle(() =>
      supplier ? updateSupplier({ ...built.input, supplierId: supplier.id, expectedVersion: value.version }) : createSupplier({ ...built.input, clientKey: attempt.key }),
    );
    setPending(null);
    if (!result.ok) {
      const code = result.error.fields?.phCode;
      if (code === 'CLIENT_KEY_MISMATCH' || code === 'CLIENT_KEY_USED') draft.set({ ...value, clientKey: newClientKey('sup'), keySig: '' });
      setFailure({ message: phMessage(t, locale, result.error, 'pharmacy.purchasing'), stale: result.error.code === 'CONFLICT' && !code, fields: result.error.fields ?? {} });
      return;
    }
    const data = result.data as { id: string };
    setFailure(null);
    setSaved(true);
    draft.clear(value);
    if (supplier) router.refresh();
    else router.replace(`/pharmacy/purchasing/suppliers/${data.id}`);
  };

  const archive = async (archived: boolean) => {
    if (!supplier) return;
    setPending('archive');
    const result = await settle(() => archiveSupplier({ supplierId: supplier.id, archived }));
    setPending(null);
    setArchiving(false);
    if (!result.ok) {
      setFailure({ message: phMessage(t, locale, result.error, 'pharmacy.purchasing'), stale: false, fields: {} });
      return;
    }
    setFailure(null);
    router.refresh();
  };

  const reload = () => {
    draft.clear(supplier ? draftOf(supplier) : start);
    setFailure(null);
    router.refresh();
  };

  return (
    <form
      className="flex min-w-0 max-w-2xl flex-col gap-4"
      data-testid="supplier-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (can) void save();
      }}
    >
      <div className="flex flex-wrap items-center gap-3 text-sm text-muted">
        <UnsavedBadge dirty={draft.dirty} saved={saved} />
        {supplier && !supplier.active && (
          <span data-testid="supplier-archived" className="inline-flex items-center gap-1.5 rounded-sm border border-line-strong bg-surface px-1.5 py-0.5 text-xs font-medium text-text">
            <Archive aria-hidden className="size-3.5 shrink-0" />
            {t('pharmacy.purchasing.supplier.archivedBadge')}
          </span>
        )}
      </div>
      <OfflineNotice />
      {draft.restored && (
        <div role="status" className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-text">
          <span className="flex min-w-0 items-start gap-2.5">
            <Info aria-hidden className="mt-px size-4 shrink-0 text-muted" />
            {t('pharmacy.catalog.draft.restored')}
          </span>
          <Button size="lg" className="min-h-11" onClick={() => draft.clear(start)}>
            {t('pharmacy.catalog.draft.discard')}
          </Button>
        </div>
      )}
      {failure && (
        <div role="alert" data-testid="supplier-error" className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md bg-danger-wash px-3 py-2.5 text-sm text-danger">
          <span className="flex min-w-0 items-start gap-2.5">
            <CircleAlert aria-hidden className="mt-px size-4 shrink-0" />
            <span className="min-w-0">{failure.message}</span>
          </span>
          {failure.stale && (
            <Button size="lg" className="min-h-11" onClick={reload}>
              {t('pharmacy.purchasing.reload')}
            </Button>
          )}
        </div>
      )}
      <fieldset disabled={!writable || busy} className="flex min-w-0 flex-col gap-4">
        <legend className="sr-only">{t('pharmacy.purchasing.supplier.details')}</legend>
        <Field label={t('pharmacy.purchasing.supplier.name')} error={fieldError('name')}>
          <Input className="min-h-11" dir="auto" maxLength={120} autoComplete="off" value={value.name} onChange={(e) => change({ name: e.target.value })} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('pharmacy.purchasing.supplier.phone')} optional error={fieldError('phone')}>
            <Input className="min-h-11" dir="ltr" inputMode="tel" maxLength={40} autoComplete="off" value={value.phone} onChange={(e) => change({ phone: e.target.value })} />
          </Field>
          <Field label={t('pharmacy.purchasing.supplier.contact')} optional error={fieldError('contactName')}>
            <Input className="min-h-11" dir="auto" maxLength={120} autoComplete="off" value={value.contactName} onChange={(e) => change({ contactName: e.target.value })} />
          </Field>
          <Field label={t('pharmacy.purchasing.supplier.currency')} error={fieldError('defaultCurrency')}>
            <Select
              className="[&_select]:min-h-11"
              value={value.defaultCurrency}
              onChange={(e) => change({ defaultCurrency: e.target.value as Currency })}
              options={currencies.map((c) => ({ value: c, label: c }))}
            />
          </Field>
          <Field label={t('pharmacy.purchasing.supplier.terms')} hint={t('pharmacy.purchasing.supplier.termsHint')} error={fieldError('termsDays')}>
            <Input className="min-h-11" dir="ltr" inputMode="numeric" autoComplete="off" value={value.termsDays} onChange={(e) => change({ termsDays: e.target.value })} />
          </Field>
        </div>
        <Field label={t('pharmacy.purchasing.supplier.address')} optional error={fieldError('addressNote')}>
          <Textarea rows={2} dir="auto" maxLength={300} value={value.addressNote} onChange={(e) => change({ addressNote: e.target.value })} />
        </Field>
        <Field label={t('pharmacy.purchasing.supplier.note')} optional error={fieldError('note')}>
          <Textarea rows={2} dir="auto" maxLength={500} value={value.note} onChange={(e) => change({ note: e.target.value })} />
        </Field>
      </fieldset>

      {archiving && supplier && (
        <div role="region" aria-label={t('pharmacy.purchasing.supplier.archiveTitle')} data-testid="supplier-archive-confirm" className="flex flex-col gap-3 rounded-md border border-line-strong bg-raised p-4">
          <p className="flex items-start gap-2.5 text-sm text-text">
            <Archive aria-hidden className="mt-px size-4 shrink-0" />
            {t('pharmacy.purchasing.supplier.archiveBody')}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="danger" size="lg" className="min-h-11" pending={pending === 'archive'} disabled={!can} onClick={() => void archive(true)}>
              {t('pharmacy.purchasing.supplier.archiveYes')}
            </Button>
            <Button size="lg" className="min-h-11" disabled={busy} onClick={() => setArchiving(false)}>
              {t('pharmacy.receive.confirm.back')}
            </Button>
          </div>
        </div>
      )}

      {writable && (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="primary" size="lg" className="min-h-11" icon={<Save aria-hidden />} pending={pending === 'save'} disabled={!can}>
            {t('pharmacy.purchasing.save')}
          </Button>
          {supplier?.active && (
            <Button size="lg" className="min-h-11" icon={<Archive aria-hidden />} disabled={busy} onClick={() => setArchiving(true)}>
              {t('pharmacy.purchasing.supplier.archive')}
            </Button>
          )}
          {supplier && !supplier.active && (
            <Button size="lg" className="min-h-11" icon={<ArchiveRestore aria-hidden />} pending={pending === 'archive'} disabled={!can} onClick={() => void archive(false)}>
              {t('pharmacy.purchasing.supplier.unarchive')}
            </Button>
          )}
        </div>
      )}
    </form>
  );
}
