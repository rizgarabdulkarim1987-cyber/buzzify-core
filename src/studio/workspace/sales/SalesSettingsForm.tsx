'use client';

import { useState, type ReactNode } from 'react';
import { saveSalesSettings } from '@/app/studio/_actions/sales';
import type { FeatureKey } from '@/server/domain/entitlements';
import type { UpgradeInfo } from '@/server/studio/services/plans';
import type { SalesSettingsView } from '@/server/studio/services/sales';
import { useT } from '@/studio/i18n';
import { UpgradeHint } from '@/studio/plans/UpgradeHint';
import { Button } from '@/studio/ui/Button';
import { Checkbox } from '@/studio/ui/Checkbox';
import { Field } from '@/studio/ui/Field';
import { FormSection } from '@/studio/ui/FormSection';
import { Select } from '@/studio/ui/Select';
import { Switch } from '@/studio/ui/Switch';
import { PageIntro, useNamer, useSave } from './shared';

type View = SalesSettingsView & { upgrade: UpgradeInfo };

const CAPS = [0.25, 0.5, 0.75, 1, 1.5, 2] as const;

/** A setting that is a switch: what it does, why, and the way to upgrade when the plan leaves it out. */
function SwitchRow({
  label,
  hint,
  checked,
  onChange,
  feature,
  upgrade,
}: {
  label: string;
  hint: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  feature?: FeatureKey;
  upgrade: UpgradeInfo;
}) {
  const locked = feature !== undefined && !upgrade.allowed.includes(feature);
  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-start justify-between gap-6">
        <span className="flex flex-col gap-0.5">
          <span className="text-base text-text">{label}</span>
          <span className="max-w-[60ch] text-sm text-muted">{hint}</span>
        </span>
        <Switch aria-label={label} checked={checked} onCheckedChange={onChange} />
      </label>
      {locked && feature && <UpgradeHint feature={feature} info={upgrade} />}
    </div>
  );
}

/** The Sales tab's Settings: the labels guests see, the categories that complete a meal, and how much the menu suggests. */
export function SalesSettingsForm({ menuId, view }: { menuId: string; view: View }) {
  const t = useT();
  const name = useNamer('en');
  const { pending, errors, save } = useSave();
  const [form, setForm] = useState({
    priceStyle: view.priceStyle,
    showMostOrdered: view.showMostOrdered,
    showLowStock: view.showLowStock,
    upsellMaxOffers: view.upsellMaxOffers,
    pairingMaxOffers: view.pairingMaxOffers,
    upsellDeltaCapRatio: view.upsellDeltaCapRatio,
    mealCategoryIds: view.categories.filter((category) => category.completesMeal).map((category) => category.id),
  });
  const change = (patch: Partial<typeof form>) => setForm((current) => ({ ...current, ...patch }));
  const counts = [1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) }));
  const capOptions = [...new Set([...CAPS, view.upsellDeltaCapRatio])]
    .sort((a, b) => a - b)
    .map((ratio) => ({ value: String(ratio), label: t('sales.settings.capOption', { percent: Math.round(ratio * 100) }) }));

  return (
    <form
      className="flex flex-col gap-8"
      onSubmit={(event) => {
        event.preventDefault();
        void save(() => saveSalesSettings({ menuId, version: view.version, ...form }));
      }}
    >
      <PageIntro title={t('sales.settings.title')} body={t('sales.settings.intro')} />

      <FormSection id="sales-labels" title={t('sales.settings.labels')} intro={t('sales.settings.labelsIntro')}>
        <div className="flex flex-col gap-5">
          <SwitchRow
            label={t('sales.settings.plainPrices')}
            hint={t('sales.settings.plainPricesHint')}
            checked={form.priceStyle === 'plain'}
            onChange={(on) => change({ priceStyle: on ? 'plain' : 'symbol' })}
            upgrade={view.upgrade}
          />
          <SwitchRow
            label={t('sales.settings.mostOrdered')}
            hint={t('sales.settings.mostOrderedHint')}
            checked={form.showMostOrdered}
            onChange={(showMostOrdered) => change({ showMostOrdered })}
            feature="selling.socialProof"
            upgrade={view.upgrade}
          />
          <SwitchRow
            label={t('sales.settings.lowStock')}
            hint={t('sales.settings.lowStockHint')}
            checked={form.showLowStock}
            onChange={(showLowStock) => change({ showLowStock })}
            feature="selling.socialProof"
            upgrade={view.upgrade}
          />
        </div>
      </FormSection>

      <FormSection id="sales-meal" title={t('sales.settings.meal')} intro={t('sales.settings.mealIntro')}>
        <div className="flex flex-col gap-2">
          {view.categories.length === 0 ? (
            <p className="text-sm text-muted">{t('sales.settings.noCategories')}</p>
          ) : (
            view.categories.map((category) => (
              <Checkbox
                key={category.id}
                label={name(category.names)}
                checked={form.mealCategoryIds.includes(category.id)}
                onChange={(event) =>
                  change({
                    mealCategoryIds: event.target.checked ? [...form.mealCategoryIds, category.id] : form.mealCategoryIds.filter((id) => id !== category.id),
                  })
                }
              />
            ))
          )}
          {!view.upgrade.allowed.includes('selling.smart') && <UpgradeHint feature="selling.smart" info={view.upgrade} />}
        </div>
      </FormSection>

      <FormSection id="sales-limits" title={t('sales.settings.limits')} intro={t('sales.settings.limitsIntro')}>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t('sales.settings.upgradesShown')} error={errors.upsellMaxOffers}>
            <Select options={counts} value={String(form.upsellMaxOffers)} onChange={(event) => change({ upsellMaxOffers: Number(event.target.value) })} />
          </Field>
          <Field label={t('sales.settings.pairingsShown')} error={errors.pairingMaxOffers}>
            <Select options={counts} value={String(form.pairingMaxOffers)} onChange={(event) => change({ pairingMaxOffers: Number(event.target.value) })} />
          </Field>
          <Field label={t('sales.settings.cap')} hint={t('sales.settings.capHint')} error={errors.upsellDeltaCapRatio}>
            <Select options={capOptions} value={String(form.upsellDeltaCapRatio)} onChange={(event) => change({ upsellDeltaCapRatio: Number(event.target.value) })} />
          </Field>
        </div>
      </FormSection>

      <div className="flex justify-end">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? t('common.saving') : t('common.save')}
        </Button>
      </div>
    </form>
  );
}
