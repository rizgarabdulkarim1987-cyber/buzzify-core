'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { revokePosDevice } from '@/app/studio/_actions/pos';
import type { ActionResult } from '@/server/studio/framework/result';
import { formatStamp } from '@/lib/pos-format';
import { requireFields, useActionForm } from '@/studio/forms';
import { describeFailure } from '@/studio/errors';
import { useLocale, useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';
import { Button } from '@/studio/ui/Button';
import { ConfirmDialog } from '@/studio/ui/ConfirmDialog';
import { Field } from '@/studio/ui/Field';
import { FormError } from '@/studio/ui/FormError';
import { Input } from '@/studio/ui/Input';

interface DeviceRow {
  id: string;
  name: string;
  lastUsedAt: Date | string | null;
}

/** Registers this browser through the Route Handler that sets the device cookie (the secret never reaches the page). */
async function registerHere(values: Record<string, string>): Promise<ActionResult<{ deviceId: string }>> {
  const response = await fetch('/api/pos/device/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ name: values.name ?? '' }),
  });
  return (await response.json()) as ActionResult<{ deviceId: string }>;
}

/** The shared devices PIN sign-in works on. Registering stores this browser's secret in an HttpOnly cookie. */
export function DevicesSection({ devices, thisDeviceId }: { devices: DeviceRow[]; thisDeviceId: string | null }) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const [revoking, setRevoking] = useState<DeviceRow | null>(null);
  const form = useActionForm(registerHere, {
    validate: (values) => requireFields(values, { name: t('error.text.posDeviceName') }),
    onSuccess: () => {
      toast.success(t('pos.devices.registered'));
      router.refresh();
    },
  });

  return (
    <section aria-labelledby="pos-devices" className="flex flex-col gap-4 border-t border-line pt-6">
      <div className="flex flex-col gap-1">
        <h2 id="pos-devices" className="text-base font-semibold text-text">
          {t('pos.devices.title')}
        </h2>
        <p className="text-sm text-muted">{t('pos.devices.intro')}</p>
      </div>
      {devices.length === 0 ? (
        <p className="text-sm text-muted">{t('pos.devices.none')}</p>
      ) : (
        <ul className="flex max-w-xl flex-col divide-y divide-line rounded-lg border border-line">
          {devices.map((device) => (
            <li key={device.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="flex min-w-0 flex-col">
                <span dir="auto" className="truncate text-base text-text">
                  {device.name}
                  {device.id === thisDeviceId ? <span className="ms-2 text-sm text-muted">{t('pos.devices.thisOne')}</span> : null}
                </span>
                <span className="text-sm text-muted">
                  {device.lastUsedAt ? t('pos.devices.lastUsed', { time: formatStamp(device.lastUsedAt) }) : t('pos.devices.neverUsed')}
                </span>
              </div>
              <Button variant="secondary" size="md" className="min-h-12" onClick={() => setRevoking(device)}>
                {t('pos.devices.revoke')}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form {...form.props} className="flex max-w-md flex-col gap-4">
        <FormError form={form} fields={['name']} />
        <Field label={t('pos.devices.name')} error={form.fieldError('name')}>
          <Input name="name" autoComplete="off" maxLength={60} />
        </Field>
        <Button type="submit" size="lg" pending={form.pending} className="min-h-12 self-start" disabled={thisDeviceId !== null}>
          {t('pos.devices.register')}
        </Button>
      </form>
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title={t('pos.devices.revokeTitle', { name: revoking?.name ?? '' })}
        body={t('pos.devices.revokeBody')}
        confirmLabel={t('pos.devices.revoke')}
        tone="danger"
        onConfirm={async () => {
          if (!revoking) return true;
          const result = await settle(() => revokePosDevice({ deviceId: revoking.id }));
          if (!result.ok) return { message: describeFailure(t, locale, result.error).message };
          toast.success(t('pos.devices.revoked'));
          router.refresh();
          return true;
        }}
      />
    </section>
  );
}
