'use client';

import { Pill } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { deactivateAppPlan, upsertAppPlan } from '@/app/studio/_actions/app-plans';
import { direction, LOCALE_NAMES, LOCALES, type Locale } from '@/lib/locale';
import type { AppPlanRow, PharmacyLimits, RetailAppPlanRow } from '@/server/domain/pharmacy/limits';
import { describeFailure, type DescribedFailure } from '@/studio/errors';
import { useLocale, useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';
import { Alert, FailureAlert } from '@/studio/ui/Alert';
import { Button } from '@/studio/ui/Button';
import { ConfirmDialog } from '@/studio/ui/ConfirmDialog';
import { EmptyState } from '@/studio/ui/EmptyState';
import { Field } from '@/studio/ui/Field';
import { Input } from '@/studio/ui/Input';
import { StatusBadge } from '@/studio/ui/StatusBadge';
import { Switch } from '@/studio/ui/Switch';

type Names = Record<Locale, string>;

type ApplicationId = 'pharmacy' | 'retail';
type PlanRow = AppPlanRow<PharmacyLimits> | RetailAppPlanRow;

/** The limits each product's plans set, in the order the form lists them. */
const LIMIT_KEYS: Record<ApplicationId, readonly string[]> = {
  pharmacy: ['branches', 'users', 'storageMb', 'aiMonthlyBudgetMinor'],
  retail: ['branches', 'users', 'terminals', 'storageMb', 'aiMonthly'],
};

interface Draft {
  code: string;
  names: Names;
  limits: Record<string, string>;
  sortOrder: string;
  active: boolean;
}

const emptyDraft = (applicationId: ApplicationId): Draft => ({
  code: '',
  names: { en: '', ar: '', ckb: '' },
  limits: Object.fromEntries(LIMIT_KEYS[applicationId].map((key) => [key, '0'])),
  sortOrder: '0',
  active: true,
});

function draftOf(applicationId: ApplicationId, plan: PlanRow): Draft {
  const limits = plan.limits as Record<string, number> | null;
  return {
    code: plan.code,
    names: plan.name,
    limits: Object.fromEntries(LIMIT_KEYS[applicationId].map((key) => [key, String(limits?.[key] ?? 0)])),
    sortOrder: String(plan.sortOrder),
    active: plan.active,
  };
}

/** A whole number as typed; anything else is sent as the text it is, so the server names the problem. */
const asNumber = (text: string): number | string => (/^\d{1,10}$/.test(text.trim()) ? Number(text.trim()) : text);

/**
 * Billing → Plans (Pharmacy or Retail): each plan's names in the Studio's three languages, the limits it sets and whether it is on
 * sale, and a form for a new one. Prices are set in Settings → Billing, never here. Read-only for every Super Admin but
 * the platform owner.
 */
export function AppPlansEditor({ applicationId, plans, canEdit }: { applicationId: ApplicationId; plans: PlanRow[]; canEdit: boolean }) {
  const t = useT();
  return (
    <div className="flex max-w-4xl flex-col gap-10">
      {!canEdit && <Alert>{t('appPlans.readOnly')}</Alert>}
      {plans.length === 0 && !canEdit && <EmptyState icon={<Pill aria-hidden />} title={t('appPlans.emptyTitle')} body={t('appPlans.emptyBody')} />}
      {plans.length === 0 && canEdit && <p className="max-w-[72ch] text-sm text-muted">{t('appPlans.emptyBody')}</p>}
      {plans.map((plan) => (
        <PlanForm key={`${plan.code}:${plan.version}`} applicationId={applicationId} plan={plan} canEdit={canEdit} />
      ))}
      {canEdit && <PlanForm key="new" applicationId={applicationId} plan={null} canEdit />}
    </div>
  );
}

function PlanForm({ applicationId, plan, canEdit }: { applicationId: ApplicationId; plan: PlanRow | null; canEdit: boolean }) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const stored = plan ? draftOf(applicationId, plan) : emptyDraft(applicationId);
  const [draft, setDraft] = useState<Draft>(stored);
  const [saving, startSaving] = useTransition();
  const [failure, setFailure] = useState<DescribedFailure | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [confirming, setConfirming] = useState(false);

  const title = plan ? plan.name[locale] || plan.code : t('appPlans.new');
  const dirty = JSON.stringify(draft) !== JSON.stringify(stored);
  const fieldError = (path: string) => failure?.fields[path];
  const edit = (change: Partial<Draft>) => {
    setDraft((current) => ({ ...current, ...change }));
    setFailure(null);
  };

  const save = () =>
    startSaving(async () => {
      setAttempt((count) => count + 1);
      const result = await settle(() =>
        upsertAppPlan({
          applicationId,
          code: draft.code,
          name: draft.names,
          limits: Object.fromEntries(LIMIT_KEYS[applicationId].map((key) => [key, asNumber(draft.limits[key])])),
          sortOrder: asNumber(draft.sortOrder),
          active: draft.active,
          ...(plan ? { version: plan.version } : {}),
        }),
      );
      if (!result.ok) return setFailure(describeFailure(t, locale, result.error));
      setFailure(null);
      toast.success(t('appPlans.saved', { plan: draft.names[locale] || draft.code }));
      // A new plan's form starts empty again; a saved plan is remounted on its new version.
      if (!plan) setDraft(emptyDraft(applicationId));
      router.refresh();
    });

  const generalMessage = failure && Object.keys(failure.fields).length === 0 ? failure.message : null;
  const firstFieldMessage = failure ? Object.values(failure.fields)[0] : undefined;
  const heading = `plan-${plan?.code ?? 'new'}`;

  return (
    <section aria-labelledby={heading} className="flex flex-col gap-5 border-t border-line pt-6">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id={heading} className="text-md font-semibold text-text">
          {title}
        </h2>
        {plan && (
          <>
            <StatusBadge tone={plan.active ? 'success' : 'neutral'}>{t(plan.active ? 'appPlans.onSale' : 'appPlans.offSale')}</StatusBadge>
            <span className="text-sm text-muted">{t('appPlans.subscriptions', { count: plan.subscriptions })}</span>
          </>
        )}
      </div>
      {plan && plan.limits === null && <Alert tone="danger">{t('appPlans.invalidLimits')}</Alert>}

      <div className="grid gap-3 sm:grid-cols-3">
        {LOCALES.map((language) => (
          <Field key={language} label={<span lang={language}>{LOCALE_NAMES[language]}</span>} error={fieldError(`name.${language}`)}>
            <Input
              value={draft.names[language]}
              maxLength={80}
              dir={direction(language)}
              lang={language}
              readOnly={!canEdit || saving}
              aria-label={t('appPlans.nameLabel', { language: LOCALE_NAMES[language] })}
              onChange={(event) => edit({ names: { ...draft.names, [language]: event.target.value } })}
            />
          </Field>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('appPlans.code')} hint={plan ? undefined : t('appPlans.codeHint')} error={fieldError('code')}>
          <Input value={draft.code} maxLength={40} dir="ltr" readOnly={plan !== null || !canEdit || saving} onChange={(event) => edit({ code: event.target.value })} />
        </Field>
        <Field label={t('appPlans.sortOrder')} error={fieldError('sortOrder')}>
          <Input
            value={draft.sortOrder}
            inputMode="numeric"
            dir="ltr"
            className="rtl:text-right"
            readOnly={!canEdit || saving}
            onChange={(event) => edit({ sortOrder: event.target.value })}
          />
        </Field>
      </div>

      <div className="flex flex-col gap-3">
        <p className="max-w-[72ch] text-sm text-muted">{t('appPlans.limitsHint')}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {LIMIT_KEYS[applicationId].map((key) => (
            <Field key={key} label={t(`appPlans.limit.${key}`)} error={fieldError(`limits.${key}`)}>
              <Input
                value={draft.limits[key]}
                inputMode="numeric"
                dir="ltr"
                className="rtl:text-right"
                readOnly={!canEdit || saving}
                onChange={(event) => edit({ limits: { ...draft.limits, [key]: event.target.value } })}
              />
            </Field>
          ))}
        </div>
      </div>

      <label className="flex w-fit items-center gap-3 text-sm text-text">
        <Switch checked={draft.active} disabled={!canEdit || saving} onCheckedChange={(on) => edit({ active: on })} aria-label={t('appPlans.onSale')} />
        {t('appPlans.onSale')}
      </label>

      <FailureAlert attempt={attempt} message={generalMessage} fieldMessage={firstFieldMessage} />
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" disabled={!dirty} pending={saving} onClick={save}>
            {saving ? t('common.saving') : t(plan ? 'appPlans.save' : 'appPlans.create')}
          </Button>
          {plan?.active && (
            <Button variant="danger" disabled={saving} onClick={() => setConfirming(true)}>
              {t('appPlans.deactivate')}
            </Button>
          )}
        </div>
      )}
      {plan && (
        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          title={t('appPlans.deactivateTitle', { plan: title })}
          body={t('appPlans.deactivateBody')}
          confirmLabel={t('appPlans.deactivate')}
          onConfirm={async () => {
            const result = await settle(() => deactivateAppPlan({ applicationId, code: plan.code, version: plan.version }));
            if (!result.ok) return { message: describeFailure(t, locale, result.error).message };
            toast.success(t('appPlans.deactivated', { plan: title }));
            router.refresh();
            return true;
          }}
        />
      )}
    </section>
  );
}
