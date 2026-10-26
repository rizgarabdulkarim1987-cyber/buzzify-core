'use client';

import { ArrowRight, Plus, TrendingUp } from 'lucide-react';
import { useState } from 'react';
import { deleteUpgrade, saveUpgrade } from '@/app/studio/_actions/sales';
import type { Locale } from '@/lib/locale';
import type { Daypart } from '@/server/domain/types';
import { useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';
import { ConfirmDialog } from '@/studio/ui/ConfirmDialog';
import { Dialog } from '@/studio/ui/Dialog';
import { EmptyState } from '@/studio/ui/EmptyState';
import { Field } from '@/studio/ui/Field';
import { Select } from '@/studio/ui/Select';
import { Switch } from '@/studio/ui/Switch';
import type { Names } from '../content/shared';
import { TranslationFields } from '../content/TranslationFields';
import {
  daypartsText,
  DaypartToggles,
  dishOptions,
  DishSelect,
  Locked,
  PageIntro,
  RuleList,
  RuleRow,
  strengthLevel,
  strengthOptions,
  useNamer,
  useSave,
  type RulesView,
} from './shared';

type Upgrade = RulesView['upgrades'][number];

interface UpgradeDraft {
  ruleId?: string;
  version?: number;
  sourceProductId: string;
  targetProductId: string;
  pitch: Names;
  effect: Names;
  priority: number;
  dayparts: Daypart[];
  isActive: boolean;
}

const blank = (): UpgradeDraft => ({ sourceProductId: '', targetProductId: '', pitch: {}, effect: {}, priority: 50, dayparts: [], isActive: true });
const draftOf = (rule: Upgrade): UpgradeDraft => ({ ...rule, ruleId: rule.id, priority: strengthLevel(rule.priority) });

/**
 * The Upgrades page: "when a guest opens X, offer Y instead". Bigger sizes and suggested extras are offered from the
 * product itself; these rules add a swap to a better dish.
 */
export function UpgradesEditor({ menuId, rules }: { menuId: string; rules: RulesView }) {
  const t = useT();
  const name = useNamer(rules.defaultLocale);
  const { pending, errors, setErrors, save } = useSave();
  const [draft, setDraft] = useState<UpgradeDraft | null>(null);
  const [deleting, setDeleting] = useState<Upgrade | null>(null);
  const readOnly = !rules.upgrade.allowed.includes('selling.smart');
  const dishes = dishOptions(rules, name);
  const dish = (id: string) => name(rules.products.find((product) => product.id === id)?.names ?? {});

  const open = (next: UpgradeDraft) => {
    setErrors({});
    setDraft(next);
  };
  const change = (patch: Partial<UpgradeDraft>) => setDraft((current) => (current ? { ...current, ...patch } : current));
  const submit = () => {
    if (!draft) return;
    void save(() => saveUpgrade({ menuId, ...draft }), () => setDraft(null));
  };

  return (
    <div className="flex flex-col gap-5">
      <PageIntro
        title={t('sales.upgrades.title')}
        body={t('sales.upgrades.intro')}
        action={
          !readOnly && (
            <Button variant="primary" icon={<Plus aria-hidden />} onClick={() => open(blank())} disabled={rules.products.length < 2}>
              {t('sales.upgrades.add')}
            </Button>
          )
        }
      />
      <Locked feature="selling.smart" upgrade={rules.upgrade} />

      {rules.upgrades.length === 0 ? (
        <EmptyState icon={<TrendingUp aria-hidden />} title={t('sales.upgrades.emptyTitle')} body={t('sales.upgrades.emptyBody')} />
      ) : (
        <RuleList label={t('sales.upgrades.title')}>
          {rules.upgrades.map((rule) => {
            const title = (
              <span className="inline-flex flex-wrap items-center gap-1.5">
                {dish(rule.sourceProductId)}
                <ArrowRight role="img" aria-label={t('sales.upgrades.to')} className="size-4 text-muted rtl:-scale-x-100" />
                {dish(rule.targetProductId)}
              </span>
            );
            const pitch = name(rule.pitch);
            return (
              <RuleRow
                key={rule.id}
                title={title}
                details={[pitch, daypartsText(t, rule.dayparts), t(`content.priority.${strengthLevel(rule.priority)}`)].filter(Boolean).join(' · ')}
                isActive={rule.isActive}
                editLabel={t('sales.upgrades.editOne', { from: dish(rule.sourceProductId), to: dish(rule.targetProductId) })}
                deleteLabel={t('sales.upgrades.deleteOne', { from: dish(rule.sourceProductId), to: dish(rule.targetProductId) })}
                onEdit={() => open(draftOf(rule))}
                onDelete={() => setDeleting(rule)}
                readOnly={readOnly}
              />
            );
          })}
        </RuleList>
      )}

      <Dialog
        open={draft !== null}
        onOpenChange={(next) => !next && setDraft(null)}
        title={draft?.ruleId ? t('sales.upgrades.editTitle') : t('sales.upgrades.addTitle')}
        description={t('sales.upgrades.dialogIntro')}
        width="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDraft(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" onClick={submit} disabled={pending || !draft?.sourceProductId || !draft?.targetProductId}>
              {pending ? t('common.saving') : t('common.save')}
            </Button>
          </>
        }
      >
        {draft && (
          <div className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('sales.upgrades.from')} hint={t('sales.upgrades.fromHint')} error={errors.sourceProductId}>
                <DishSelect options={dishes} value={draft.sourceProductId} onChange={(sourceProductId) => change({ sourceProductId })} />
              </Field>
              <Field label={t('sales.upgrades.offer')} hint={t('sales.upgrades.offerHint')} error={errors.targetProductId}>
                <DishSelect
                  options={dishes.filter((option) => option.value !== draft.sourceProductId)}
                  value={draft.targetProductId}
                  onChange={(targetProductId) => change({ targetProductId })}
                />
              </Field>
            </div>
            <TranslationFields
              label={t('sales.upgrades.pitch')}
              locales={rules.locales as Locale[]}
              values={draft.pitch}
              maxLength={120}
              onChange={(pitch) => change({ pitch })}
            />
            <TranslationFields
              label={t('sales.upgrades.effect')}
              locales={rules.locales as Locale[]}
              values={draft.effect}
              maxLength={120}
              onChange={(effect) => change({ effect })}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('sales.priority')} hint={t('sales.priorityHint')} error={errors.priority}>
                <Select options={strengthOptions(t)} value={String(draft.priority)} onChange={(event) => change({ priority: Number(event.target.value) })} />
              </Field>
              <label className="flex items-center justify-between gap-4 self-end py-2">
                <span className="text-sm text-text">{t('sales.active')}</span>
                <Switch aria-label={t('sales.active')} checked={draft.isActive} onCheckedChange={(isActive) => change({ isActive })} />
              </label>
            </div>
            <DaypartToggles value={draft.dayparts} onChange={(dayparts) => change({ dayparts })} error={errors.dayparts} />
          </div>
        )}
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(next) => !next && setDeleting(null)}
        title={t('sales.upgrades.deleteTitle')}
        body={deleting ? t('sales.upgrades.deleteBody', { from: dish(deleting.sourceProductId), to: dish(deleting.targetProductId) }) : undefined}
        confirmLabel={t('sales.delete')}
        onConfirm={async () => {
          if (!deleting) return true;
          const ok = await save(() => deleteUpgrade({ menuId, ruleId: deleting.id, version: deleting.version }), () => setDeleting(null), t('sales.deleted'));
          return ok ? true : { message: t('sales.deleteFailed') };
        }}
      />
    </div>
  );
}
