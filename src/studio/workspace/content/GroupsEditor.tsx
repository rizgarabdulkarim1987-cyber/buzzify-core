'use client';

import { Plus, Trash2 } from 'lucide-react';
import type { Locale } from '@/lib/locale';
import { useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';
import { Checkbox } from '@/studio/ui/Checkbox';
import { Field } from '@/studio/ui/Field';
import { IconButton } from '@/studio/ui/IconButton';
import { Input } from '@/studio/ui/Input';
import type { GroupDraft, OptionDraft } from './draft';
import { newKey } from './shared';
import { TranslationFields } from './TranslationFields';

export interface GroupsEditorProps {
  locales: readonly Locale[];
  groups: GroupDraft[];
  onChange: (groups: GroupDraft[]) => void;
  /** Messages by the server's field paths (`groups.0.minSelect`, `groups.0.options.1.priceDelta`). */
  errors: Record<string, string>;
  canPrice: boolean;
}

/**
 * A product's option groups ("Milk", "Extras"): how many of its options a guest picks at least and at most, and each
 * option with what it adds to the price. A suggested option is the one the menu proposes first.
 */
export function GroupsEditor({ locales, groups, onChange, errors, canPrice }: GroupsEditorProps) {
  const t = useT();

  const update = (index: number, change: Partial<GroupDraft>) => onChange(groups.map((group, at) => (at === index ? { ...group, ...change } : group)));
  const updateOption = (index: number, position: number, change: Partial<OptionDraft>) =>
    update(index, { options: groups[index]!.options.map((option, at) => (at === position ? { ...option, ...change } : option)) });

  const add = () =>
    onChange([...groups, { key: newKey(), names: {}, minSelect: '0', maxSelect: '1', options: [{ key: newKey(), names: {}, priceDelta: '', isSuggested: false }] }]);

  return (
    <div className="flex flex-col gap-3">
      {groups.length > 0 && (
        <ol className="flex flex-col gap-3">
          {groups.map((group, index) => {
            const n = index + 1;
            return (
              <li key={group.key} className="flex flex-col gap-3 rounded-md border border-line p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-text">{t('content.groups.title', { n })}</span>
                  <IconButton
                    label={t('content.groups.remove', { n })}
                    icon={<Trash2 aria-hidden />}
                    size="sm"
                    onClick={() => onChange(groups.filter((_, at) => at !== index))}
                  />
                </div>
                <TranslationFields
                  label={t('content.groups.name', { n })}
                  showLabel={false}
                  locales={locales}
                  values={group.names}
                  maxLength={120}
                  onChange={(names) => update(index, { names })}
                />
                <div className="flex flex-wrap gap-3">
                  <Field label={t('content.groups.min', { n })} error={errors[`groups.${index}.minSelect`]} className="w-40">
                    <Input
                      value={group.minSelect}
                      inputMode="numeric"
                      dir="ltr"
                      onChange={(event) => update(index, { minSelect: event.target.value })}
                      className="tabular-nums"
                    />
                  </Field>
                  <Field label={t('content.groups.max', { n })} error={errors[`groups.${index}.maxSelect`]} className="w-40">
                    <Input
                      value={group.maxSelect}
                      inputMode="numeric"
                      dir="ltr"
                      onChange={(event) => update(index, { maxSelect: event.target.value })}
                      className="tabular-nums"
                    />
                  </Field>
                </div>

                <ol className="flex flex-col divide-y divide-line border-y border-line" aria-label={t('content.groups.options', { n })}>
                  {group.options.map((option, position) => {
                    const m = position + 1;
                    return (
                      <li key={option.key} className="flex flex-col gap-2 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-sm text-muted">{t('content.options.title', { m })}</span>
                          <IconButton
                            label={t('content.options.remove', { n, m })}
                            icon={<Trash2 aria-hidden />}
                            size="sm"
                            onClick={() => update(index, { options: group.options.filter((_, at) => at !== position) })}
                          />
                        </div>
                        <TranslationFields
                          label={t('content.options.name', { n, m })}
                          showLabel={false}
                          locales={locales}
                          values={option.names}
                          maxLength={120}
                          onChange={(names) => updateOption(index, position, { names })}
                        />
                        <div className="flex flex-wrap items-end gap-4">
                          <Field
                            label={t('content.options.delta', { n, m })}
                            error={errors[`groups.${index}.options.${position}.priceDelta`]}
                            className="w-48"
                          >
                            <Input
                              value={option.priceDelta}
                              inputMode="decimal"
                              dir="ltr"
                              disabled={!canPrice}
                              placeholder="+0.00"
                              onChange={(event) => updateOption(index, position, { priceDelta: event.target.value })}
                              className="tabular-nums"
                            />
                          </Field>
                          <Checkbox
                            label={t('content.options.suggested')}
                            aria-label={t('content.options.suggestedLabel', { n, m })}
                            checked={option.isSuggested}
                            onChange={(event) => updateOption(index, position, { isSuggested: event.target.checked })}
                            className="mb-1.5"
                          />
                        </div>
                      </li>
                    );
                  })}
                </ol>
                <div>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Plus aria-hidden />}
                    onClick={() => update(index, { options: [...group.options, { key: newKey(), names: {}, priceDelta: '', isSuggested: false }] })}
                  >
                    {t('content.options.add')}
                  </Button>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <div>
        <Button size="sm" icon={<Plus aria-hidden />} onClick={add}>
          {t('content.groups.add')}
        </Button>
      </div>
    </div>
  );
}
