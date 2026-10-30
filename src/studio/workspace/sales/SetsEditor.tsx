'use client';

import { Package, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { deleteSet, saveSet } from '@/app/studio/_actions/sales';
import type { Locale } from '@/lib/locale';
import { formatPriceInput, parsePriceInput } from '@/lib/money-input';
import type { Daypart } from '@/server/domain/types';
import { useLocale, useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';
import { ConfirmDialog } from '@/studio/ui/ConfirmDialog';
import { cx } from '@/studio/ui/cx';
import { Dialog } from '@/studio/ui/Dialog';
import { EmptyState } from '@/studio/ui/EmptyState';
import { Field } from '@/studio/ui/Field';
import { IconButton } from '@/studio/ui/IconButton';
import { Input } from '@/studio/ui/Input';
import { Select } from '@/studio/ui/Select';
import { Switch } from '@/studio/ui/Switch';
import { formatMoney, newKey, PRICE_PROBLEM_KEYS, type Names } from '../content/shared';
import { TranslationFields } from '../content/TranslationFields';
import { daypartsText, DaypartToggles, dishOptions, DishSelect, Locked, PageIntro, RuleList, RuleRow, useNamer, useSave, type RulesView } from './shared';

type SetView = RulesView['sets'][number];

interface ItemDraft {
  key: string;
  productId: string;
  variantId: string | null;
  quantity: number;
}

interface SetDraft {
  bundleId?: string;
  version?: number;
  slug?: string;
  names: Names;
  descriptions: Names;
  price: string;
  items: ItemDraft[];
  /** Digits as typed; empty is an ordinary set. */
  people: string;
  dayparts: Daypart[];
  isActive: boolean;
}

const newItem = (): ItemDraft => ({ key: newKey(), productId: '', variantId: null, quantity: 1 });

/** The Sets page: dishes sold together for less than they cost one by one, offered in the cart as "make it a set". */
export function SetsEditor({ menuId, rules, canPrice }: { menuId: string; rules: RulesView; canPrice: boolean }) {
  const t = useT();
  const { locale } = useLocale();
  const name = useNamer(rules.defaultLocale);
  const { pending, errors, setErrors, save } = useSave();
  const [draft, setDraft] = useState<SetDraft | null>(null);
  const [deleting, setDeleting] = useState<SetView | null>(null);
  const readOnly = !rules.upgrade.allowed.includes('selling.smart');
  const money = (minor: number) => formatMoney(minor, rules.currency, locale);
  const dishes = dishOptions(rules, name);
  const products = new Map(rules.products.map((product) => [product.id, product]));

  /** One of a dish at its regular price in a size, or its default size. */
  const itemPrice = (productId: string, variantId: string | null) => {
    const product = products.get(productId);
    if (!product) return 0;
    const variant = variantId ? product.variants.find((v) => v.id === variantId) : product.variants.find((v) => v.isDefault);
    return Math.max(0, product.price + (variant?.priceDelta ?? 0));
  };

  const open = (next: SetDraft) => {
    setErrors({});
    setDraft(next);
  };
  const change = (patch: Partial<SetDraft>) => setDraft((current) => (current ? { ...current, ...patch } : current));
  const changeItem = (key: string, patch: Partial<ItemDraft>) =>
    setDraft((current) => (current ? { ...current, items: current.items.map((item) => (item.key === key ? { ...item, ...patch } : item)) } : current));

  const itemsTotal = draft ? draft.items.reduce((sum, item) => sum + itemPrice(item.productId, item.variantId) * item.quantity, 0) : 0;
  const price = draft ? parsePriceInput(draft.price, rules.currency) : null;
  const saving = price?.ok ? itemsTotal - price.minor : null;

  const submit = () => {
    if (!draft || !price) return;
    if (!price.ok) {
      setErrors({ price: t(PRICE_PROBLEM_KEYS[price.reason]) });
      return;
    }
    const items = draft.items.filter((item) => item.productId !== '').map(({ productId, variantId, quantity }) => ({ productId, variantId, quantity }));
    const { bundleId, version, slug, names, descriptions, dayparts, isActive } = draft;
    const typedPeople = draft.people.trim();
    const people = typedPeople === '' ? null : Number(typedPeople);
    void save(
      () => saveSet({ menuId, ...(bundleId ? { bundleId, version } : {}), ...(slug ? { slug } : {}), names, descriptions, price: price.minor, items, people, dayparts, isActive }),
      () => setDraft(null),
    );
  };

  return (
    <div className="flex flex-col gap-5">
      <PageIntro
        title={t('sales.sets.title')}
        body={t('sales.sets.intro')}
        action={
          !readOnly &&
          canPrice && (
            <Button
              variant="primary"
              icon={<Plus aria-hidden />}
              disabled={rules.products.length < 2}
              onClick={() => open({ names: {}, descriptions: {}, price: '', items: [newItem(), newItem()], people: '', dayparts: [], isActive: true })}
            >
              {t('sales.sets.add')}
            </Button>
          )
        }
      />
      <Locked feature="selling.smart" upgrade={rules.upgrade} />

      {rules.sets.length === 0 ? (
        <EmptyState icon={<Package aria-hidden />} title={t('sales.sets.emptyTitle')} body={t('sales.sets.emptyBody')} />
      ) : (
        <RuleList label={t('sales.sets.title')}>
          {rules.sets.map((set) => {
            const contents = set.items.map((item) => `${item.quantity > 1 ? `${item.quantity} × ` : ''}${name(products.get(item.productId)?.names ?? {})}`).join(', ');
            const deal = set.price < set.itemsTotal;
            return (
              <RuleRow
                key={set.id}
                title={
                  <span className="inline-flex flex-wrap items-baseline gap-x-2">
                    {name(set.names)}
                    <span className="text-sm font-normal tabular-nums text-muted">{money(set.price)}</span>
                  </span>
                }
                details={
                  <>
                    {[set.people ? t('sales.sets.forPeople', { n: set.people }) : '', contents, daypartsText(t, set.dayparts)].filter(Boolean).join(' · ')}
                    <span className={cx('block', deal ? 'text-success' : 'text-danger')}>
                      {deal ? t('sales.sets.saves', { amount: money(set.itemsTotal - set.price), total: money(set.itemsTotal) }) : t('sales.sets.noSaving', { total: money(set.itemsTotal) })}
                    </span>
                  </>
                }
                isActive={set.isActive}
                editLabel={t('sales.sets.editOne', { name: name(set.names) })}
                deleteLabel={t('sales.sets.deleteOne', { name: name(set.names) })}
                onEdit={() =>
                  open({
                    bundleId: set.id,
                    version: set.version,
                    slug: set.slug,
                    names: set.names,
                    descriptions: set.descriptions,
                    price: formatPriceInput(set.price, rules.currency),
                    items: set.items.map((item) => ({ key: newKey(), ...item })),
                    people: set.people ? String(set.people) : '',
                    dayparts: set.dayparts,
                    isActive: set.isActive,
                  })
                }
                onDelete={() => setDeleting(set)}
                readOnly={readOnly}
              />
            );
          })}
        </RuleList>
      )}

      <Dialog
        open={draft !== null}
        onOpenChange={(next) => !next && setDraft(null)}
        title={draft?.bundleId ? t('sales.sets.editTitle') : t('sales.sets.addTitle')}
        description={t('sales.sets.dialogIntro')}
        width="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDraft(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" onClick={submit} disabled={pending}>
              {pending ? t('common.saving') : t('common.save')}
            </Button>
          </>
        }
      >
        {draft && (
          <div className="flex flex-col gap-4">
            <TranslationFields label={t('sales.sets.name')} locales={rules.locales as Locale[]} values={draft.names} maxLength={120} onChange={(names) => change({ names })} />
            {errors.names && <p className="-mt-2 text-sm text-danger">{errors.names}</p>}
            <TranslationFields
              label={t('sales.sets.description')}
              locales={rules.locales as Locale[]}
              values={draft.descriptions}
              maxLength={300}
              onChange={(descriptions) => change({ descriptions })}
            />

            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium text-text">{t('sales.sets.items')}</legend>
              {draft.items.map((item, index) => {
                const product = products.get(item.productId);
                return (
                  <div key={item.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_5rem_auto]">
                    <Field label={t('sales.sets.dish', { n: index + 1 })} hideLabel={index > 0} className="col-span-2 sm:col-span-1">
                      <DishSelect options={dishes} value={item.productId} onChange={(productId) => changeItem(item.key, { productId, variantId: null })} />
                    </Field>
                    <Field label={t('sales.sets.size')} hideLabel={index > 0}>
                      <Select
                        disabled={!product || product.variants.length === 0}
                        options={[
                          { value: '', label: t('sales.sets.defaultSize') },
                          ...(product?.variants ?? []).map((variant) => ({ value: variant.id, label: name(variant.names) })),
                        ]}
                        value={item.variantId ?? ''}
                        onChange={(event) => changeItem(item.key, { variantId: event.target.value || null })}
                      />
                    </Field>
                    <Field label={t('sales.sets.quantity')} hideLabel={index > 0}>
                      <Select
                        options={Array.from({ length: 10 }, (_, n) => ({ value: String(n + 1), label: String(n + 1) }))}
                        value={String(item.quantity)}
                        onChange={(event) => changeItem(item.key, { quantity: Number(event.target.value) })}
                      />
                    </Field>
                    <IconButton
                      label={t('sales.sets.removeItem', { n: index + 1 })}
                      icon={<Trash2 aria-hidden />}
                      disabled={draft.items.length <= 2}
                      onClick={() => change({ items: draft.items.filter((entry) => entry.key !== item.key) })}
                    />
                  </div>
                );
              })}
              {errors.items && <p className="text-sm text-danger">{errors.items}</p>}
              <Button size="sm" variant="secondary" icon={<Plus aria-hidden />} className="w-fit" disabled={draft.items.length >= 8} onClick={() => change({ items: [...draft.items, newItem()] })}>
                {t('sales.sets.addItem')}
              </Button>
            </fieldset>

            <div className="grid items-start gap-4 sm:grid-cols-2">
              <Field label={t('sales.sets.price')} hint={rules.currency} error={errors.price}>
                <Input value={draft.price} inputMode="decimal" dir="ltr" disabled={!canPrice} onChange={(event) => change({ price: event.target.value })} className="tabular-nums" />
              </Field>
              <div aria-live="polite" className="flex flex-col gap-0.5 rounded-md border border-line bg-surface px-3 py-2 text-sm">
                <span className="text-muted">{t('sales.sets.oneByOne', { total: money(itemsTotal) })}</span>
                {saving !== null && saving > 0 && <span className="font-medium text-success">{t('sales.sets.guestSaves', { amount: money(saving) })}</span>}
                {saving !== null && saving <= 0 && itemsTotal > 0 && <span className="font-medium text-danger">{t('sales.sets.priceTooHigh')}</span>}
              </div>
            </div>
            <Field label={t('sales.sets.people')} hint={t('sales.sets.peopleHint')} error={errors.people}>
              <Input value={draft.people} type="number" min={2} max={12} step={1} inputMode="numeric" dir="ltr" onChange={(event) => change({ people: event.target.value })} className="tabular-nums sm:w-32" />
            </Field>
            <label className="flex items-center justify-between gap-4">
              <span className="text-sm text-text">{t('sales.active')}</span>
              <Switch aria-label={t('sales.active')} checked={draft.isActive} onCheckedChange={(isActive) => change({ isActive })} />
            </label>
            <DaypartToggles value={draft.dayparts} onChange={(dayparts) => change({ dayparts })} error={errors.dayparts} />
          </div>
        )}
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(next) => !next && setDeleting(null)}
        title={t('sales.sets.deleteTitle')}
        body={deleting ? t('sales.sets.deleteBody', { name: name(deleting.names) }) : undefined}
        confirmLabel={t('sales.delete')}
        onConfirm={async () => {
          if (!deleting) return true;
          const ok = await save(() => deleteSet({ menuId, bundleId: deleting.id, version: deleting.version }), () => setDeleting(null), t('sales.deleted'));
          return ok ? true : { message: t('sales.deleteFailed') };
        }}
      />
    </div>
  );
}
