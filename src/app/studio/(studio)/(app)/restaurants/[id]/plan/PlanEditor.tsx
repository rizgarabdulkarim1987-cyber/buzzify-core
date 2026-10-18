'use client';

import { Check, Lock } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { setRestaurantPlan } from '@/app/studio/_actions/plans';
import { PLAN_TIERS, type FeatureArea, type FeatureKey, type PlanTier } from '@/server/domain/entitlements';
import type { PlanTabFeature, PlanTabView } from '@/server/studio/services/plans';
import { describeFailure, type DescribedFailure } from '@/studio/errors';
import { useLocale, useT } from '@/studio/i18n';
import { UpgradeAction } from '@/studio/plans/UpgradeHint';
import { FailureAlert } from '@/studio/ui/Alert';
import { Button } from '@/studio/ui/Button';
import { ConfirmDialog } from '@/studio/ui/ConfirmDialog';
import { cx } from '@/studio/ui/cx';
import { Field } from '@/studio/ui/Field';
import { Select } from '@/studio/ui/Select';
import { StatusBadge } from '@/studio/ui/StatusBadge';
import { Textarea } from '@/studio/ui/Textarea';

const AREAS: readonly FeatureArea[] = ['design', 'immersive', 'publishing', 'selling'];

type Extra = 'plan' | 'on' | 'off';
const toExtra = (value: boolean | null): Extra => (value === null ? 'plan' : value ? 'on' : 'off');

interface Draft {
  plan: PlanTier;
  extras: Partial<Record<FeatureKey, Extra>>;
  note: string;
}

/** Whether the restaurant would have `feature` with `draft`: its extra when it has one, else its plan. */
function has(feature: PlanTabFeature, draft: Draft): boolean {
  const extra = draft.extras[feature.key] ?? 'plan';
  return extra === 'plan' ? feature.plans.includes(draft.plan) : extra === 'on';
}

/**
 * The Plan tab (spec 8.1): the plan, each live feature with whether this restaurant has it, and for the platform owner
 * the controls: the plan, an extra per feature, the note. A save that takes something away asks first, naming what
 * guests stop seeing; nothing stored is deleted, so moving back restores it.
 */
export function PlanEditor({ restaurantId, view }: { restaurantId: string; view: PlanTabView }) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const initial: Draft = useMemo(
    () => ({ plan: view.plan, extras: Object.fromEntries(view.features.map((f) => [f.key, toExtra(f.extra)])), note: view.note ?? '' }),
    [view],
  );
  const [draft, setDraft] = useState<Draft>(initial);
  const [saving, startSaving] = useTransition();
  const [failure, setFailure] = useState<DescribedFailure | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [confirming, setConfirming] = useState(false);

  const saved = { plan: view.plan, extras: initial.extras, note: initial.note };
  const lost = view.features.filter((feature) => has(feature, saved) && !has(feature, draft));
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const lockedCount = view.features.filter((feature) => !has(feature, saved)).length;

  const change = (next: Partial<Draft>) => {
    setDraft((current) => ({ ...current, ...next }));
    setFailure(null);
  };

  /** Saves the draft; the refusal, in the person's language, when there is one. */
  const send = async (): Promise<DescribedFailure | null> => {
    setAttempt((count) => count + 1);
    const extras = Object.fromEntries(
      Object.entries(draft.extras).flatMap(([key, extra]) => (extra === 'plan' ? [] : [[key, extra === 'on']])),
    );
    const result = await setRestaurantPlan({ restaurantId, plan: draft.plan, extras, note: draft.note });
    if (!result.ok) {
      const refused = describeFailure(t, locale, result.error);
      setFailure(refused);
      return refused;
    }
    setFailure(null);
    toast.success(t('plans.saved'));
    router.refresh();
    return null;
  };

  const save = () => {
    if (lost.length > 0) return setConfirming(true);
    startSaving(async () => {
      await send();
    });
  };

  return (
    <section aria-labelledby="plan-title" className="flex max-w-4xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="plan-title" className="text-md font-semibold text-text">
            {t('plans.title')}
          </h2>
          <StatusBadge tone="ink">{view.planNames[view.plan]}</StatusBadge>
        </div>
        <p className="max-w-[72ch] text-sm text-muted">{view.canEdit ? t('plans.introOwner') : t('plans.intro')}</p>
      </div>

      {view.canEdit && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium text-text">{t('plans.choose')}</legend>
          <div role="radiogroup" aria-label={t('plans.choose')} className="inline-flex w-fit rounded-md border border-line-strong bg-raised p-0.5">
            {PLAN_TIERS.map((tier) => {
              const chosen = draft.plan === tier;
              return (
                <button
                  key={tier}
                  type="button"
                  role="radio"
                  aria-checked={chosen}
                  disabled={saving}
                  onClick={() => change({ plan: tier })}
                  className={cx(
                    'h-8 min-w-24 rounded-[5px] px-3 text-sm font-medium transition-colors duration-150',
                    chosen ? 'bg-ink text-on-ink' : 'text-text hover:bg-hover',
                  )}
                >
                  {view.planNames[tier]}
                </button>
              );
            })}
          </div>
        </fieldset>
      )}

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{t('plans.title')}</caption>
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="h-9 px-3 text-start text-xs font-medium text-muted first:ps-4">
                {t('plans.feature')}
              </th>
              <th scope="col" className="h-9 w-48 px-3 text-start text-xs font-medium text-muted">
                {t('plans.status')}
              </th>
              {view.canEdit && (
                <th scope="col" className="h-9 w-44 px-3 text-start text-xs font-medium text-muted last:pe-4">
                  {t('plans.extra')}
                </th>
              )}
            </tr>
          </thead>
          {AREAS.map((area) => {
            const rows = view.features.filter((feature) => feature.area === area);
            if (rows.length === 0) return null;
            return (
              <tbody key={area} aria-label={t(`plans.area.${area}`)}>
                <tr>
                  <th scope="rowgroup" colSpan={view.canEdit ? 3 : 2} className="h-9 bg-surface px-4 text-start text-xs font-medium text-muted">
                    {t(`plans.area.${area}`)}
                  </th>
                </tr>
                {rows.map((feature) => {
                  const on = has(feature, draft);
                  const name = t(`plans.feature.${feature.key}`);
                  return (
                    <tr key={feature.key} className="border-b border-line">
                      <th scope="row" className="h-11 px-3 text-start font-normal text-text first:ps-4">
                        {name}
                      </th>
                      <td className="h-11 px-3">
                        {on ? (
                          <span className="inline-flex items-center gap-1.5 text-success">
                            <Check aria-hidden className="size-3.5" />
                            {t('plans.included')}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-muted">
                            <Lock aria-hidden className="size-3.5" />
                            {feature.lowestPlan ? t('plans.inPlan', { plan: view.planNames[feature.lowestPlan] }) : t('plans.inNoPlan')}
                          </span>
                        )}
                      </td>
                      {view.canEdit && (
                        <td className="h-11 px-3 last:pe-4">
                          <Select
                            aria-label={t('plans.extraLabel', { feature: name })}
                            value={draft.extras[feature.key] ?? 'plan'}
                            disabled={saving}
                            onChange={(event) => change({ extras: { ...draft.extras, [feature.key]: event.target.value as Extra } })}
                            options={[
                              { value: 'plan', label: t('plans.extra.plan') },
                              { value: 'on', label: t('plans.extra.on') },
                              { value: 'off', label: t('plans.extra.off') },
                            ]}
                          />
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            );
          })}
        </table>
      </div>

      {!view.canEdit && lockedCount > 0 && (
        // Anyone but the owner can ask for what the restaurant does not have: the first locked feature names the plan.
        <div className="flex flex-wrap items-center gap-3">
          <UpgradeAction feature={view.features.find((feature) => !has(feature, saved))!.key} info={view.upgrade} />
        </div>
      )}

      {view.note !== null &&
        (view.canEdit ? (
          <Field label={t('plans.note')} hint={t('plans.noteHint')} className="max-w-xl">
            <Textarea rows={3} maxLength={2000} value={draft.note} disabled={saving} onChange={(event) => change({ note: event.target.value })} />
          </Field>
        ) : (
          view.note && (
            <div className="flex max-w-xl flex-col gap-1">
              <h3 className="text-sm font-medium text-text">{t('plans.note')}</h3>
              <p className="whitespace-pre-line text-sm text-text">{view.note}</p>
            </div>
          )
        ))}

      {failure && <FailureAlert attempt={attempt} message={failure.message} />}

      {view.canEdit && (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" disabled={!dirty} pending={saving} onClick={save}>
            {saving ? t('common.saving') : t('plans.save')}
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('plans.confirmTitle', { restaurant: view.upgrade.restaurantName })}
        body={
          <div className="flex flex-col gap-2">
            <p>{t('plans.confirmBody')}</p>
            <ul className="list-disc ps-5">
              {lost.map((feature) => (
                <li key={feature.key}>{t(`plans.feature.${feature.key}`)}</li>
              ))}
            </ul>
          </div>
        }
        confirmLabel={t('plans.save')}
        tone="danger"
        onConfirm={async () => {
          const refused = await send();
          return refused === null ? true : { message: refused.message };
        }}
      />
    </section>
  );
}
