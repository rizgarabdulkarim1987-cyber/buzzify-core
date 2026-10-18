'use client';

import { Plus, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { deletePairing, savePairing } from '@/app/studio/_actions/sales';
import type { Locale } from '@/lib/locale';
import type { Daypart } from '@/server/domain/types';
import { useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';
import { ConfirmDialog } from '@/studio/ui/ConfirmDialog';
import { cx } from '@/studio/ui/cx';
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

type Pairing = RulesView['pairings'][number];

interface PairingDraft {
  ruleId?: string;
  version?: number;
  sourceKind: 'PRODUCT' | 'CATEGORY';
  sourceId: string;
  targetProductId: string;
  reason: Names;
  weight: number;
  dayparts: Daypart[];
  isActive: boolean;
}

const blank = (): PairingDraft => ({ sourceKind: 'CATEGORY', sourceId: '', targetProductId: '', reason: {}, weight: 50, dayparts: [], isActive: true });
const draftOf = (rule: Pairing): PairingDraft => ({
  ruleId: rule.id,
  version: rule.version,
  sourceKind: rule.sourceType,
  sourceId: rule.sourceId,
  targetProductId: rule.targetProductId,
  reason: rule.reason,
  weight: strengthLevel(rule.weight),
  dayparts: rule.dayparts,
  isActive: rule.isActive,
});

/** The Pairings page: "with X, a dish or a whole category, suggest Y", shown on the dish and in the cart. */
export function PairingsEditor({ menuId, rules }: { menuId: string; rules: RulesView }) {
  const t = useT();
  const name = useNamer(rules.defaultLocale);
  const { pending, errors, setErrors, save } = useSave();
  const [draft, setDraft] = useState<PairingDraft | null>(null);
  const [deleting, setDeleting] = useState<Pairing | null>(null);
  const readOnly = !rules.upgrade.allowed.includes('selling.smart');
  const dishes = dishOptions(rules, name);
  const dish = (id: string) => name(rules.products.find((product) => product.id === id)?.names ?? {});
  const category = (id: string) => name(rules.categories.find((entry) => entry.id === id)?.names ?? {});
  const source = (rule: Pick<Pairing, 'sourceType' | 'sourceId'>) =>
    rule.sourceType === 'PRODUCT' ? dish(rule.sourceId) : t('sales.pairings.anyIn', { category: category(rule.sourceId) });

  const open = (next: PairingDraft) => {
    setErrors({});
    setDraft(next);
  };
  const change = (patch: Partial<PairingDraft>) => setDraft((current) => (current ? { ...current, ...patch } : current));
  const submit = () => {
    if (!draft) return;
    const { sourceKind, sourceId, ...rest } = draft;
    void save(() => savePairing({ menuId, ...rest, source: { kind: sourceKind, id: sourceId } }), () => setDraft(null));
  };

  return (
    <div className="flex flex-col gap-5">
      <PageIntro
        title={t('sales.pairings.title')}
        body={t('sales.pairings.intro')}
        action={
          !readOnly && (
            <Button variant="primary" icon={<Plus aria-hidden />} onClick={() => open(blank())} disabled={rules.products.length === 0}>
              {t('sales.pairings.add')}
            </Button>
          )
        }
      />
      <Locked feature="selling.smart" upgrade={rules.upgrade} />

      {rules.pairings.length === 0 ? (
        <EmptyState icon={<Sparkles aria-hidden />} title={t('sales.pairings.emptyTitle')} body={t('sales.pairings.emptyBody')} />
      ) : (
        <RuleList label={t('sales.pairings.title')}>
          {rules.pairings.map((rule) => (
            <RuleRow
              key={rule.id}
              title={t('sales.pairings.rule', { source: source(rule), target: dish(rule.targetProductId) })}
              details={[name(rule.reason), daypartsText(t, rule.dayparts), t(`content.priority.${strengthLevel(rule.weight)}`)].filter(Boolean).join(' · ')}
              isActive={rule.isActive}
              editLabel={t('sales.pairings.editOne', { source: source(rule), target: dish(rule.targetProductId) })}
              deleteLabel={t('sales.pairings.deleteOne', { source: source(rule), target: dish(rule.targetProductId) })}
              onEdit={() => open(draftOf(rule))}
              onDelete={() => setDeleting(rule)}
              readOnly={readOnly}
            />
          ))}
        </RuleList>
      )}

      <Dialog
        open={draft !== null}
        onOpenChange={(next) => !next && setDraft(null)}
        title={draft?.ruleId ? t('sales.pairings.editTitle') : t('sales.pairings.addTitle')}
        description={t('sales.pairings.dialogIntro')}
        width="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDraft(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" onClick={submit} disabled={pending || !draft?.sourceId || !draft?.targetProductId}>
              {pending ? t('common.saving') : t('common.save')}
            </Button>
          </>
        }
      >
        {draft && (
          <div className="flex flex-col gap-4">
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1.5 text-sm font-medium text-text">{t('sales.pairings.with')}</legend>
              <div role="radiogroup" aria-label={t('sales.pairings.with')} className="inline-flex w-fit rounded-md border border-line p-0.5">
                {(['CATEGORY', 'PRODUCT'] as const).map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    role="radio"
                    aria-checked={draft.sourceKind === kind}
                    onClick={() => change({ sourceKind: kind, sourceId: '' })}
                    className={cx('h-7 rounded-sm px-3 text-sm transition-colors', draft.sourceKind === kind ? 'bg-text text-bg' : 'text-muted hover:text-text')}
                  >
                    {t(`sales.pairings.kind.${kind}`)}
                  </button>
                ))}
              </div>
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={draft.sourceKind === 'PRODUCT' ? t('sales.pairings.withDish') : t('sales.pairings.withCategory')} error={errors['source.id']}>
                {draft.sourceKind === 'PRODUCT' ? (
                  <DishSelect options={dishes} value={draft.sourceId} onChange={(sourceId) => change({ sourceId })} />
                ) : (
                  <Select
                    options={[
                      { value: '', label: t('sales.chooseCategory'), disabled: true },
                      ...rules.categories.map((entry) => ({ value: entry.id, label: name(entry.names) })),
                    ]}
                    value={draft.sourceId}
                    onChange={(event) => change({ sourceId: event.target.value })}
                  />
                )}
              </Field>
              <Field label={t('sales.pairings.suggest')} error={errors.targetProductId}>
                <DishSelect
                  options={dishes.filter((option) => draft.sourceKind === 'CATEGORY' || option.value !== draft.sourceId)}
                  value={draft.targetProductId}
                  onChange={(targetProductId) => change({ targetProductId })}
                />
              </Field>
            </div>
            <TranslationFields
              label={t('sales.pairings.reason')}
              locales={rules.locales as Locale[]}
              values={draft.reason}
              maxLength={120}
              onChange={(reason) => change({ reason })}
            />
            <p className="-mt-2 text-sm text-muted">{t('sales.pairings.reasonHint')}</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('sales.strength')} hint={t('sales.strengthHint')} error={errors.weight}>
                <Select options={strengthOptions(t)} value={String(draft.weight)} onChange={(event) => change({ weight: Number(event.target.value) })} />
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
        title={t('sales.pairings.deleteTitle')}
        body={deleting ? t('sales.pairings.deleteBody', { source: source(deleting), target: dish(deleting.targetProductId) }) : undefined}
        confirmLabel={t('sales.delete')}
        onConfirm={async () => {
          if (!deleting) return true;
          const ok = await save(() => deletePairing({ menuId, ruleId: deleting.id, version: deleting.version }), () => setDeleting(null), t('sales.deleted'));
          return ok ? true : { message: t('sales.deleteFailed') };
        }}
      />
    </div>
  );
}
