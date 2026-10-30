'use client';

import { CircleAlert, CircleCheck, Info, Save, ShieldAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { setControlledSettings, setCreditSettings } from '@/app/pharmacy/_actions/customers';
import { useLocale, useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';
import { Dialog } from '@/studio/ui/Dialog';
import { Field } from '@/studio/ui/Field';
import { OfflineNotice } from './OfflineNotice';
import { phMessage } from './ph-failure';
import { FIELD, FieldInput, Note, TOUCH_BTN, TOUCH_PRIMARY } from './sell-parts';
import { useOnline } from './use-online';

export interface SettingsIn {
  controlledEnabled: boolean;
  controlledMaxQty: number;
  rxRetentionDays: number;
  creditEnabled: boolean;
  version: number;
}

const whole = (text: string, min: number, max: number): number | null => {
  if (!/^\d{1,9}$/.test(text.trim())) return null;
  const n = Number(text.trim());
  return n >= min && n <= max ? n : null;
};

/**
 * The controlled-drug and credit settings. The owner edits them; a branch manager sees them and cannot change them (`editable`
 * false: no control that writes is drawn). Both groups share the settings row's version: every save sends the version it knows
 * and keeps the one the server answers with, so saving the second group right after the first is not a false conflict. Switching
 * controlled sales ON asks first and says what it means; switching it off, or changing the numbers, does not.
 */
export function PharmacySettings({ initial, editable }: { initial: SettingsIn; editable: boolean }) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const online = useOnline();
  const [version, setVersion] = useState(initial.version);
  const [controlled, setControlled] = useState(initial.controlledEnabled);
  // What the server holds now: the confirmation asks only when this is off, whatever the page props have refreshed to yet.
  const [savedOn, setSavedOn] = useState(initial.controlledEnabled);
  const [maxQty, setMaxQty] = useState(String(initial.controlledMaxQty));
  const [retention, setRetention] = useState(String(initial.rxRetentionDays));
  const [credit, setCredit] = useState(initial.creditEnabled);
  const [busy, setBusy] = useState<'controlled' | 'credit' | null>(null);
  const [asking, setAsking] = useState(false);
  const [message, setMessage] = useState<{ group: 'controlled' | 'credit'; tone: 'danger' | 'success'; text: string } | null>(null);
  const lock = useRef(false);

  const qty = whole(maxQty, 0, 1_000_000);
  const days = whole(retention, 1, 36_500);
  const can = editable && online && busy === null;

  const run = async (group: 'controlled' | 'credit', call: () => Promise<unknown>, after?: () => void) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(group);
    setMessage(null);
    const result = await settle<{ version: number }>(call as () => Promise<never>);
    setBusy(null);
    lock.current = false;
    if (!result.ok) {
      setMessage({ group, tone: 'danger', text: phMessage(t, locale, result.error, 'pharmacy.settings') });
      return;
    }
    setVersion(result.data.version);
    after?.();
    setMessage({ group, tone: 'success', text: t('pharmacy.settings.saved') });
    router.refresh();
  };

  const saveControlled = () => {
    if (!can || qty === null || days === null) return;
    const value = controlled;
    void run('controlled', () => setControlledSettings({ controlledEnabled: value, controlledMaxQty: qty, rxRetentionDays: days, version }), () => setSavedOn(value));
  };
  const askOrSave = () => {
    if (!can || qty === null || days === null) return;
    if (controlled && !savedOn) setAsking(true);
    else saveControlled();
  };

  const notice = (group: 'controlled' | 'credit') =>
    message && message.group === group ? (
      <Note icon={message.tone === 'danger' ? <CircleAlert aria-hidden /> : <CircleCheck aria-hidden />} tone={message.tone} role={message.tone === 'danger' ? 'alert' : 'status'} testId={`settings-${group}-message`}>
        {message.text}
      </Note>
    ) : null;

  const check = (id: string, checked: boolean, onChange: (v: boolean) => void, label: string, hint: string, testId: string) => (
    <label htmlFor={id} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md border border-line px-3 py-3">
      <input id={id} type="checkbox" checked={checked} disabled={!editable} onChange={(e) => onChange(e.target.checked)} className="mt-1 size-5 shrink-0 accent-ink" data-testid={testId} />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-base font-medium text-text">{label}</span>
        <span className="text-sm text-muted">{hint}</span>
      </span>
    </label>
  );

  return (
    <div className="flex min-w-0 max-w-2xl flex-col gap-8" data-testid="pharmacy-settings">
      <OfflineNotice />
      {!editable && (
        <Note icon={<Info aria-hidden />} tone="info" role="status" testId="settings-readonly">
          {t('pharmacy.settings.readOnly')}
        </Note>
      )}
      <section aria-labelledby="set-controlled-h" className="flex flex-col gap-4" data-testid="settings-controlled">
        <h2 id="set-controlled-h" className="text-lg font-semibold text-text">
          {t('pharmacy.settings.controlled.title')}
        </h2>
        {check('set-controlled', controlled, setControlled, t('pharmacy.settings.controlled.on'), t('pharmacy.settings.controlled.onHint'), 'settings-controlled-on')}
        <Field label={t('pharmacy.settings.controlled.maxQty')} hint={t('pharmacy.settings.controlled.maxQtyHint')} error={qty === null ? t('pharmacy.settings.problem.whole') : undefined}>
          <FieldInput className={FIELD} dir="ltr" inputMode="numeric" autoComplete="off" data-testid="settings-max-qty" value={maxQty} disabled={!editable} onChange={(e) => setMaxQty(e.target.value)} />
        </Field>
        <Field label={t('pharmacy.settings.controlled.retention')} hint={t('pharmacy.settings.controlled.retentionHint')} error={days === null ? t('pharmacy.settings.problem.days') : undefined}>
          <FieldInput className={FIELD} dir="ltr" inputMode="numeric" autoComplete="off" data-testid="settings-retention" value={retention} disabled={!editable} onChange={(e) => setRetention(e.target.value)} />
        </Field>
        <Note icon={<Info aria-hidden />} tone="info" testId="settings-question-b">
          {t('pharmacy.settings.controlled.questionB')}
        </Note>
        {notice('controlled')}
        {editable && (
          <div>
            <button type="button" className={TOUCH_PRIMARY} data-testid="settings-controlled-save" disabled={!can || qty === null || days === null} onClick={askOrSave}>
              <Save aria-hidden className="size-4" />
              {busy === 'controlled' ? t('pharmacy.settings.saving') : t('pharmacy.settings.save')}
            </button>
          </div>
        )}
      </section>

      <section aria-labelledby="set-credit-h" className="flex flex-col gap-4" data-testid="settings-credit">
        <h2 id="set-credit-h" className="text-lg font-semibold text-text">
          {t('pharmacy.settings.credit.title')}
        </h2>
        {check('set-credit', credit, setCredit, t('pharmacy.settings.credit.on'), t('pharmacy.settings.credit.onHint'), 'settings-credit-on')}
        {notice('credit')}
        {editable && (
          <div>
            <button type="button" className={TOUCH_PRIMARY} data-testid="settings-credit-save" disabled={!can} onClick={() => void run('credit', () => setCreditSettings({ creditEnabled: credit, version }))}>
              <Save aria-hidden className="size-4" />
              {busy === 'credit' ? t('pharmacy.settings.saving') : t('pharmacy.settings.save')}
            </button>
          </div>
        )}
      </section>

      <Dialog
        open={asking}
        onOpenChange={(next) => {
          if (busy === null) setAsking(next);
        }}
        width="md"
        title={t('pharmacy.settings.controlled.confirmTitle')}
        footer={
          <>
            <button type="button" className={TOUCH_BTN} data-testid="settings-confirm-cancel" onClick={() => setAsking(false)}>
              {t('pharmacy.settings.controlled.confirmCancel')}
            </button>
            <button
              type="button"
              className={TOUCH_PRIMARY}
              data-testid="settings-confirm-ok"
              disabled={!can}
              onClick={() => {
                setAsking(false);
                saveControlled();
              }}
            >
              <ShieldAlert aria-hidden className="size-4" />
              {t('pharmacy.settings.controlled.confirmOk')}
            </button>
          </>
        }
      >
        <p className="text-base text-text" data-testid="settings-confirm-body">
          {t('pharmacy.settings.controlled.confirmBody')}
        </p>
      </Dialog>
    </div>
  );
}
