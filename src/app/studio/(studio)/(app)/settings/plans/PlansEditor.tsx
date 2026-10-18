'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { updatePlans } from '@/app/studio/_actions/plans';
import { direction, LOCALE_NAMES, LOCALES, type Locale } from '@/lib/locale';
import { PLAN_TIERS, type FeatureArea, type FeatureDef, type PlanTier } from '@/server/domain/entitlements';
import { describeFailure, type DescribedFailure } from '@/studio/errors';
import { useLocale, useT } from '@/studio/i18n';
import { Alert, FailureAlert } from '@/studio/ui/Alert';
import { Button } from '@/studio/ui/Button';
import { Field } from '@/studio/ui/Field';
import { Input } from '@/studio/ui/Input';
import { StatusBadge } from '@/studio/ui/StatusBadge';
import { Switch } from '@/studio/ui/Switch';

type StoredPlans = Record<PlanTier, { names: Record<Locale, string>; features: Record<string, boolean> }>;

const LIVE_AREAS: readonly FeatureArea[] = ['design', 'immersive', 'publishing', 'selling'];

/**
 * Settings → Plans (spec 8.2): the three plans side by side, their names in the Studio's three languages, every feature
 * as a switch per plan (the ones later projects will build under "Coming later", so where each starts can be decided
 * now), and the WhatsApp number the upgrade button opens. Read-only for every Super Admin but the platform owner.
 */
export function PlansEditor({
  plans,
  whatsapp,
  features,
  canEdit,
}: {
  plans: StoredPlans;
  whatsapp: string;
  features: FeatureDef[];
  canEdit: boolean;
}) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const [draft, setDraft] = useState<StoredPlans>(plans);
  // Stored as digits only; shown with the + people write it with.
  const [number, setNumber] = useState(whatsapp ? `+${whatsapp}` : '');
  const [saving, startSaving] = useTransition();
  const [failure, setFailure] = useState<DescribedFailure | null>(null);
  const [attempt, setAttempt] = useState(0);

  const dirty = JSON.stringify(draft) !== JSON.stringify(plans) || number.replace(/[\s+\-()]/g, '') !== whatsapp;
  const locked = !canEdit || saving;

  const setName = (tier: PlanTier, language: Locale, name: string) => {
    setDraft((current) => ({ ...current, [tier]: { ...current[tier], names: { ...current[tier].names, [language]: name } } }));
    setFailure(null);
  };
  const setFeature = (tier: PlanTier, key: string, on: boolean) => {
    setDraft((current) => ({ ...current, [tier]: { ...current[tier], features: { ...current[tier].features, [key]: on } } }));
    setFailure(null);
  };

  const save = () =>
    startSaving(async () => {
      setAttempt((count) => count + 1);
      const result = await updatePlans({ plans: draft, whatsapp: number });
      if (!result.ok) return setFailure(describeFailure(t, locale, result.error));
      setFailure(null);
      toast.success(t('plansSettings.saved'));
      router.refresh();
    });

  const groups = [
    ...LIVE_AREAS.map((area) => ({ label: t(`plans.area.${area}`), rows: features.filter((f) => f.status === 'live' && f.area === area) })),
    { label: t('plans.area.later'), rows: features.filter((f) => f.status === 'reserved') },
  ].filter((group) => group.rows.length > 0);

  const headerCell = 'h-9 px-3 text-start text-xs font-medium text-muted';

  return (
    <div className="flex max-w-4xl flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h2 className="text-md font-semibold text-text">{t('plansSettings.title')}</h2>
        <p className="max-w-[72ch] text-sm text-muted">{t('plansSettings.intro')}</p>
      </div>
      {!canEdit && <Alert>{t('plansSettings.readOnly')}</Alert>}

      <section aria-labelledby="plan-names" className="flex flex-col gap-3">
        <h3 id="plan-names" className="text-sm font-semibold text-text">
          {t('plansSettings.names')}
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-line">
                <td className={headerCell} />
                {PLAN_TIERS.map((tier) => (
                  <th key={tier} scope="col" className={headerCell}>
                    {draft[tier].names[locale]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {LOCALES.map((language) => (
                <tr key={language} className="border-b border-line">
                  <th scope="row" lang={language} className="h-12 w-32 px-3 text-start font-normal text-muted first:ps-4">
                    {LOCALE_NAMES[language]}
                  </th>
                  {PLAN_TIERS.map((tier) => (
                    <td key={tier} className="h-12 px-3">
                      <Input
                        value={draft[tier].names[language]}
                        maxLength={40}
                        dir={direction(language)}
                        lang={language}
                        readOnly={locked}
                        aria-label={t('plansSettings.nameLabel', { plan: draft[tier].names[locale], language: LOCALE_NAMES[language] })}
                        onChange={(event) => setName(tier, language, event.target.value)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="plan-features" className="flex flex-col gap-3">
        <h3 id="plan-features" className="text-sm font-semibold text-text">
          {t('plansSettings.features')}
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className={`${headerCell} ps-4`}>
                  {t('plans.feature')}
                </th>
                {PLAN_TIERS.map((tier) => (
                  <th key={tier} scope="col" className={`${headerCell} w-32`}>
                    {draft[tier].names[locale]}
                  </th>
                ))}
              </tr>
            </thead>
            {groups.map((group) => (
              <tbody key={group.label} aria-label={group.label}>
                <tr>
                  <th scope="rowgroup" colSpan={1 + PLAN_TIERS.length} className="h-9 bg-surface px-4 text-start text-xs font-medium text-muted">
                    {group.label}
                  </th>
                </tr>
                {group.rows.map((feature) => {
                  const name = t(`plans.feature.${feature.key}`);
                  return (
                    <tr key={feature.key} className="border-b border-line">
                      <th scope="row" className="h-11 px-3 text-start font-normal text-text first:ps-4">
                        <span className="flex flex-wrap items-center gap-2">
                          {name}
                          {feature.status === 'reserved' && <StatusBadge>{t('plans.notBuilt', { project: String(feature.project) })}</StatusBadge>}
                        </span>
                      </th>
                      {PLAN_TIERS.map((tier) => (
                        <td key={tier} className="h-11 px-3">
                          <Switch
                            checked={draft[tier].features[feature.key] ?? false}
                            disabled={locked}
                            onCheckedChange={(on) => setFeature(tier, feature.key, on)}
                            aria-label={t('plansSettings.switch', { feature: name, plan: draft[tier].names[locale] })}
                          />
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            ))}
          </table>
        </div>
      </section>

      <Field label={t('plansSettings.whatsapp')} hint={t('plansSettings.whatsappHint')} error={failure?.fields.whatsapp} className="max-w-sm">
        <Input
          type="tel"
          inputMode="tel"
          dir="ltr"
          autoComplete="tel"
          value={number}
          readOnly={locked}
          placeholder="+964 750 123 4567"
          onChange={(event) => {
            setNumber(event.target.value);
            setFailure(null);
          }}
        />
      </Field>

      {failure && <FailureAlert attempt={attempt} message={failure.message} />}

      {canEdit && (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" disabled={!dirty} pending={saving} onClick={save}>
            {saving ? t('common.saving') : t('plansSettings.save')}
          </Button>
        </div>
      )}
    </div>
  );
}
