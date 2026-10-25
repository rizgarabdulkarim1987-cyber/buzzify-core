'use client';

import type { ZoneRow } from '@/server/pos/delivery-setup';
import { typedAmount } from '@/lib/pos-view';
import { useT } from '@/studio/i18n';
import { Field } from '@/studio/ui/Field';
import { Input } from '@/studio/ui/Input';
import { Select } from '@/studio/ui/Select';
import { Textarea } from '@/studio/ui/Textarea';

/** What the cashier types for a takeaway or delivery: kept as text until it is sent. */
export interface Draft {
  name: string;
  phone: string;
  address: string;
  note: string;
  zoneId: string;
  fee: string;
}

export const emptyDraft: Draft = { name: '', phone: '', address: '', note: '', zoneId: '', fee: '' };

/** The fee as a whole number, or null while the box is empty or not a number. */
export const feeOf = (draft: Draft): number | null => typedAmount(draft.fee);

interface FieldsProps {
  kind: 'TAKEAWAY' | 'DELIVERY';
  draft: Draft;
  onChange: (next: Draft) => void;
  zones: ZoneRow[];
  errors: Record<string, string>;
  /** Called when the phone box loses focus (the new-order dialog looks the customer up). */
  onPhoneBlur?: () => void;
  hint?: string | null;
}

/** The customer's boxes. A takeaway keeps a name and a phone; a delivery adds the address, the area and the fee. */
export function OffPremiseFields({ kind, draft, onChange, zones, errors, onPhoneBlur, hint }: FieldsProps) {
  const t = useT();
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch });
  const delivery = kind === 'DELIVERY';
  return (
    <div className="flex flex-col gap-3">
      <Field label={t('pos.offp.phone')} error={errors.customerPhone}>
        <Input name="phone" size="lg" inputMode="tel" dir="ltr" maxLength={40} value={draft.phone} onChange={(e) => set({ phone: e.target.value })} onBlur={onPhoneBlur} autoComplete="off" />
      </Field>
      {hint ? <p className="text-sm text-muted" role="status">{hint}</p> : null}
      <Field label={t('pos.offp.name')} error={errors.customerName}>
        <Input name="name" size="lg" dir="auto" maxLength={120} value={draft.name} onChange={(e) => set({ name: e.target.value })} autoComplete="off" />
      </Field>
      {delivery ? (
        <>
          <Field label={t('pos.offp.address')} error={errors.address}>
            <Textarea name="address" dir="auto" rows={3} maxLength={300} value={draft.address} onChange={(e) => set({ address: e.target.value })} />
          </Field>
          <Field label={t('pos.offp.addressNote')} error={errors.addressNote}>
            <Input name="note" size="lg" dir="auto" maxLength={300} value={draft.note} onChange={(e) => set({ note: e.target.value })} />
          </Field>
          {zones.length > 0 ? (
            <Field label={t('pos.offp.zone')} error={errors.zoneId}>
              <Select
                name="zone"
                size="lg"
                value={draft.zoneId}
                onChange={(e) => {
                  const zone = zones.find((z) => z.id === e.target.value);
                  set({ zoneId: e.target.value, fee: zone ? String(zone.fee) : draft.fee });
                }}
                options={[{ value: '', label: t('pos.offp.noZone') }, ...zones.map((zone) => ({ value: zone.id, label: zone.name }))]}
              />
            </Field>
          ) : null}
          <Field label={t('pos.offp.fee')} error={errors.deliveryFee}>
            <Input name="fee" size="lg" inputMode="numeric" dir="ltr" value={draft.fee} onChange={(e) => set({ fee: e.target.value })} placeholder="0" />
          </Field>
        </>
      ) : null}
    </div>
  );
}
