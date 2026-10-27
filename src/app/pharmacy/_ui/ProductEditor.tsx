'use client';

import { Archive, ArrowLeft, ArrowRight, CircleAlert, History, Save } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { archiveProduct, createProduct, updateProduct } from '@/app/pharmacy/_actions/catalog';
import { draftKey, useDraft } from '@/lib/use-draft';
import type { Currency } from '@/server/domain/pharmacy/money';
import type { PriceHistoryRow } from '@/server/pharmacy/prices';
import { describeFailure, type DescribedFailure } from '@/studio/errors';
import { formatDateTime } from '@/studio/format';
import { useLocale, useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';
import { Alert } from '@/studio/ui/Alert';
import { Button } from '@/studio/ui/Button';
import { Checkbox } from '@/studio/ui/Checkbox';
import { Field } from '@/studio/ui/Field';
import { FormSection } from '@/studio/ui/FormSection';
import { Input } from '@/studio/ui/Input';
import { Select } from '@/studio/ui/Select';
import { StatusBadge } from '@/studio/ui/StatusBadge';
import { BarcodeList } from './BarcodeList';
import { PriceHistory } from './PriceHistory';
import { draftOf, inputOf, type EditorProduct, type ProductDraft } from './product-draft';
import { UnitLadderEditor } from './UnitLadderEditor';
import { UnsavedBadge } from './UnsavedBadge';
import { isolate, WriteBlocked, type Writable } from './WriteBlocked';

export interface ProductEditorProps {
  /** Whose draft this is: drafts are kept per person, screen and product on this device. */
  userId: string;
  /** The stored product; null for a new one. */
  product: EditorProduct | null;
  /** The branches the person works in, for the stock levels. */
  branches: Array<{ id: string; name: string }>;
  categories: Array<{ id: string; name: string }>;
  currencies: Currency[];
  history: PriceHistoryRow[];
  historyCursor?: string | null;
  writable: Writable;
  /** `price.change` and the pharmacy open: the price form is drawn. */
  canChangePrice: boolean;
  /** Where the person works: a price set here is for this branch, or business-wide for "All branches". */
  place?: { branchId: string | null; branchName: string | null };
  /** Every branch of the business by id, for the price history's "where". */
  branchNames?: Record<string, string>;
}

type Tab = 'details' | 'prices';

/** The `BARCODE_IN_USE` refusal's details, for the explanation and the way on. */
interface Held {
  index: number;
  productId: string;
  name: string;
  archived: boolean;
}

function heldOf(failure: DescribedFailure | null, raw: Record<string, string> | undefined): Held | null {
  if (!failure || raw?.phCode !== 'BARCODE_IN_USE' || !raw.productId) return null;
  const key = Object.keys(raw).find((name) => /^barcodes\.\d+\.code$/.test(name));
  return { index: key ? Number(key.split('.')[1]) : -1, productId: raw.productId, name: raw.productName ?? '', archived: raw.productArchived === 'true' };
}

/**
 * A product's editor: identity, packs, barcodes, storage and stock levels, and (for a saved product) its price history.
 * Every change is kept as a draft on this device (`useDraft`), offered back if the person leaves and returns; the badge
 * says when something is unsaved, and leaving asks first. Without the right to change (a read-only pharmacy, a role that
 * only looks, support) the fields are read only, there is no save button, and the screen says why. Nothing moves.
 */
export function ProductEditor(props: ProductEditorProps) {
  const { userId, product, branches, categories, currencies, history, historyCursor = null, writable, canChangePrice } = props;
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const ids = useId();
  const initial = draftOf(product, branches.map((b) => b.id), t('pharmacy.catalog.unit.defaultBase'));
  const draft = useDraft<ProductDraft>(draftKey(userId, 'product', product?.id ?? 'new'), initial);
  const value = draft.value;
  const [version, setVersion] = useState(product?.version ?? 0);
  const [active, setActive] = useState(product?.active ?? true);
  const [tab, setTab] = useState<Tab>('details');
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<{ described: DescribedFailure; raw: Record<string, string> | undefined } | null>(null);
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [restoreSeen, setRestoreSeen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const editable = writable.ok;

  // Leaving the page (closing, reloading, typing another address) with unsaved changes asks first.
  useEffect(() => {
    if (!draft.dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [draft.dirty]);

  const change = (patch: Partial<ProductDraft>) => {
    setSaved(false);
    draft.set({ ...value, ...patch });
  };

  const errors: Record<string, string> = { ...(failure?.described.fields ?? {}), ...clientErrors };
  const held = heldOf(failure?.described ?? null, failure?.raw);
  const duplicate = failure?.raw?.phCode === 'DUPLICATE_PRODUCT' && failure.raw.productId ? failure.raw : null;

  const save = async () => {
    setAttempt((n) => n + 1);
    const built = inputOf(value);
    if ('errors' in built) {
      setClientErrors(Object.fromEntries(Object.keys(built.errors).map((name) => [name, t('pharmacy.catalog.field.wholeNumber')])));
      setFailure(null);
      return;
    }
    setClientErrors({});
    setPending(true);
    const result = await settle(() =>
      product ? updateProduct({ ...built.input, productId: product.id, expectedVersion: version }) : createProduct(built.input),
    );
    setPending(false);
    if (!result.ok) {
      setFailure({ described: describeFailure(t, locale, result.error), raw: result.error.fields });
      return;
    }
    setFailure(null);
    const data = result.data as { id: string; version: number };
    draft.clear();
    setSaved(true);
    if (!product) {
      router.push(`/pharmacy/catalog/${data.id}`);
      return;
    }
    setVersion(data.version);
    router.refresh();
  };

  const archive = async () => {
    if (!product || !window.confirm(t('pharmacy.catalog.archiveConfirm'))) return;
    setPending(true);
    const result = await settle(() => archiveProduct({ productId: product.id, expectedVersion: version }));
    setPending(false);
    if (!result.ok) {
      setFailure({ described: describeFailure(t, locale, result.error), raw: result.error.fields });
      return;
    }
    const data = result.data as { version: number };
    setVersion(data.version);
    setActive(false);
    router.refresh();
  };

  const leave = (event: MouseEvent<HTMLAnchorElement>) => {
    if (draft.dirty && !window.confirm(t('pharmacy.catalog.leaveConfirm'))) event.preventDefault();
  };

  const share = () => {
    if (!held || held.index < 0) return;
    change({ barcodes: value.barcodes.map((b, i) => (i === held.index ? { ...b, shared: true } : b)) });
    setFailure(null);
  };

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next: Tab = event.key === 'Home' ? 'details' : event.key === 'End' ? 'prices' : tab === 'details' ? 'prices' : 'details';
    setTab(next);
    document.getElementById(`${ids}-tab-${next}`)?.focus();
  };

  // A sentence for the whole form: the failure's own, unless every problem sits beside a field shown here.
  const fieldNames = ['tradeName', 'genericName', 'activeIngredient', 'strength', 'form', 'manufacturer', 'rxLevel', 'categoryId', 'storageNote', 'shelfLocation', 'levels'];
  const besideFields = failure && Object.keys(failure.described.fields).length > 0 && Object.keys(failure.described.fields).every((name) => fieldNames.includes(name) || name.startsWith('barcodes.') || name.startsWith('levels.'));
  const formMessage = failure && !held && !duplicate && !(failure.described.code === 'INVALID' && besideFields) ? failure.described.message : null;
  const BackIcon = locale === 'en' ? ArrowLeft : ArrowRight;

  const details = (
    <fieldset disabled={!editable || pending} className="flex min-w-0 flex-col">
      <legend className="sr-only">{t('pharmacy.catalog.tab.details')}</legend>
      <FormSection id={`${ids}-identity`} title={t('pharmacy.catalog.section.identity')} intro={t('pharmacy.catalog.section.identityIntro')}>
        <Field label={t('pharmacy.catalog.field.tradeName')} error={errors.tradeName}>
          <Input name="tradeName" dir="auto" maxLength={200} value={value.tradeName} onChange={(e) => change({ tradeName: e.target.value })} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('pharmacy.catalog.field.genericName')} optional error={errors.genericName}>
            <Input dir="auto" maxLength={200} value={value.genericName} onChange={(e) => change({ genericName: e.target.value })} />
          </Field>
          <Field label={t('pharmacy.catalog.field.activeIngredient')} optional error={errors.activeIngredient}>
            <Input dir="auto" maxLength={200} value={value.activeIngredient} onChange={(e) => change({ activeIngredient: e.target.value })} />
          </Field>
          <Field label={t('pharmacy.catalog.field.strength')} hint={t('pharmacy.catalog.field.strengthHint')} optional error={errors.strength}>
            <Input dir="auto" maxLength={200} value={value.strength} onChange={(e) => change({ strength: e.target.value })} />
          </Field>
          <Field label={t('pharmacy.catalog.field.form')} hint={t('pharmacy.catalog.field.formHint')} optional error={errors.form}>
            <Input dir="auto" maxLength={200} value={value.form} onChange={(e) => change({ form: e.target.value })} />
          </Field>
          <Field label={t('pharmacy.catalog.field.manufacturer')} optional error={errors.manufacturer}>
            <Input dir="auto" maxLength={200} value={value.manufacturer} onChange={(e) => change({ manufacturer: e.target.value })} />
          </Field>
          <Field label={t('pharmacy.catalog.field.rxLevel')} error={errors.rxLevel}>
            <Select
              value={value.rxLevel}
              onChange={(e) => change({ rxLevel: e.target.value as ProductDraft['rxLevel'] })}
              options={(['OTC', 'RX', 'RESTRICTED'] as const).map((rx) => ({ value: rx, label: t(`pharmacy.catalog.rx.${rx}`) }))}
            />
          </Field>
          {categories.length > 0 && (
            <Field label={t('pharmacy.catalog.field.category')} optional error={errors.categoryId}>
              <Select
                value={value.categoryId}
                onChange={(e) => change({ categoryId: e.target.value })}
                options={[{ value: '', label: t('pharmacy.catalog.field.noCategory') }, ...categories.map((c) => ({ value: c.id, label: c.name }))]}
              />
            </Field>
          )}
        </div>
      </FormSection>

      <FormSection id={`${ids}-units`} title={t('pharmacy.catalog.section.units')} intro={t('pharmacy.catalog.section.unitsIntro')}>
        <UnitLadderEditor
          levels={value.levels}
          disabled={!editable}
          errors={errors}
          onChange={(levels, removed) =>
            change({
              levels,
              barcodes:
                removed === undefined
                  ? value.barcodes
                  : value.barcodes.filter((b) => b.level !== removed).map((b) => (b.level > removed ? { ...b, level: b.level - 1 } : b)),
            })
          }
        />
      </FormSection>

      <FormSection id={`${ids}-barcodes`} title={t('pharmacy.catalog.section.barcodes')} intro={t('pharmacy.catalog.section.barcodesIntro')}>
        <BarcodeList barcodes={value.barcodes} levels={value.levels} disabled={!editable} errors={errors} onChange={(barcodes) => change({ barcodes })} />
      </FormSection>

      <FormSection id={`${ids}-storage`} title={t('pharmacy.catalog.section.storage')}>
        <Checkbox label={t('pharmacy.catalog.field.requiresCold')} checked={value.requiresCold} onChange={(e) => change({ requiresCold: e.target.checked })} />
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,12rem)]">
          <Field label={t('pharmacy.catalog.field.storageNote')} optional error={errors.storageNote}>
            <Input dir="auto" maxLength={200} value={value.storageNote} onChange={(e) => change({ storageNote: e.target.value })} />
          </Field>
          <Field label={t('pharmacy.catalog.field.shelfLocation')} hint={t('pharmacy.catalog.field.shelfHint')} optional error={errors.shelfLocation}>
            <Input dir="auto" maxLength={200} value={value.shelfLocation} onChange={(e) => change({ shelfLocation: e.target.value })} />
          </Field>
        </div>
      </FormSection>

      {branches.length > 0 && (
        <FormSection id={`${ids}-branches`} title={t('pharmacy.catalog.section.branches')} intro={t('pharmacy.catalog.section.branchesIntro')}>
          <ul className="flex flex-col gap-3">
            {branches.map((branch) => {
              const setting = value.branchSettings[branch.id] ?? { minQty: '0', reorderQty: '0' };
              const put = (patch: Partial<typeof setting>) => change({ branchSettings: { ...value.branchSettings, [branch.id]: { ...setting, ...patch } } });
              return (
                <li key={branch.id} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,8rem)_minmax(0,8rem)] sm:items-end">
                  <p className="min-w-0 break-words text-sm font-medium text-text" dir="auto">
                    {branch.name}
                  </p>
                  <Field label={<><span className="sr-only">{branch.name}: </span>{t('pharmacy.catalog.field.minQty')}</>} error={errors[`branch.${branch.id}.minQty`]}>
                    <Input inputMode="numeric" dir="ltr" value={setting.minQty} onChange={(e) => put({ minQty: e.target.value })} />
                  </Field>
                  <Field label={<><span className="sr-only">{branch.name}: </span>{t('pharmacy.catalog.field.reorderQty')}</>} error={errors[`branch.${branch.id}.reorderQty`]}>
                    <Input inputMode="numeric" dir="ltr" value={setting.reorderQty} onChange={(e) => put({ reorderQty: e.target.value })} />
                  </Field>
                </li>
              );
            })}
          </ul>
        </FormSection>
      )}

      {editable && (
        <div className="flex flex-wrap items-center gap-3 border-t border-line py-6">
          <Button variant="primary" size="lg" icon={<Save aria-hidden />} pending={pending} onClick={() => void save()}>
            {t('pharmacy.catalog.save')}
          </Button>
          {product && active && (
            <Button variant="secondary" size="lg" icon={<Archive aria-hidden />} disabled={pending} onClick={() => void archive()}>
              {t('pharmacy.catalog.archive')}
            </Button>
          )}
        </div>
      )}
    </fieldset>
  );

  return (
    <div className="flex min-w-0 flex-col gap-4 px-4 pb-10 pt-6 sm:px-8">
      <div>
        <Link href="/pharmacy/catalog" onClick={leave} className="inline-flex min-h-11 items-center gap-1.5 rounded-md text-sm font-medium text-text underline underline-offset-2">
          <BackIcon aria-hidden className="size-4 shrink-0" />
          {t('pharmacy.catalog.back')}
        </Link>
      </div>
      <header className="flex flex-col gap-2">
        <h1 className="break-words text-xl font-semibold text-text" dir="auto">
          {product ? value.tradeName.trim() || product.tradeName : value.tradeName.trim() || t('pharmacy.catalog.newTitle')}
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          {product && !active && <StatusBadge>{t('pharmacy.catalog.archivedBadge')}</StatusBadge>}
          <UnsavedBadge dirty={draft.dirty} saved={saved} />
        </div>
      </header>

      <WriteBlocked writable={writable} />
      {product && !active && (
        <Alert>
          <span>{t('pharmacy.catalog.archived')}</span>
        </Alert>
      )}

      {draft.restored && !restoreSeen && (
        <div role="status" className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-text">
          <History aria-hidden className="size-4 shrink-0 text-muted" />
          <span className="min-w-0 flex-1">
            {t('pharmacy.catalog.draft.restored')}
            {draft.restoredAt && <span className="text-muted"> ({formatDateTime(draft.restoredAt, locale)})</span>}
          </span>
          <Button size="sm" onClick={() => setRestoreSeen(true)}>
            {t('pharmacy.catalog.draft.keep')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              draft.clear(initial);
              setRestoreSeen(true);
            }}
          >
            {t('pharmacy.catalog.draft.discard')}
          </Button>
        </div>
      )}

      {!pending && formMessage && (
        <Alert key={attempt} tone="danger">
          {formMessage}
          {failure?.described.code === 'CONFLICT' && failure.raw?.changedAt && (
            <>
              {' '}
              <button type="button" className="font-medium underline underline-offset-2" onClick={() => router.refresh()}>
                {t('pharmacy.catalog.reload')}
              </button>
            </>
          )}
        </Alert>
      )}
      {!pending && held && (
        <div role="alert" key={attempt} className="flex flex-col gap-2 rounded-md bg-danger-wash px-3 py-2.5 text-sm text-danger">
          <p className="flex items-start gap-2.5">
            <CircleAlert aria-hidden className="mt-px size-4 shrink-0" />
            <span className="min-w-0">
              {held.archived
                ? t('pharmacy.catalog.barcode.heldArchived', { name: isolate(held.name) })
                : t('pharmacy.catalog.barcode.heldActive', { name: isolate(held.name) })}
            </span>
          </p>
          <div className="flex flex-wrap gap-2 ps-6">
            {held.index >= 0 && (
              <Button size="sm" onClick={share}>
                {t('pharmacy.catalog.barcode.share')}
              </Button>
            )}
            <Link href={`/pharmacy/catalog/${held.productId}`} className="inline-flex min-h-7 items-center font-medium text-text underline underline-offset-2">
              {t('pharmacy.catalog.barcode.openHolder', { name: isolate(held.name) })}
            </Link>
          </div>
        </div>
      )}
      {!pending && duplicate && (
        <Alert key={attempt} tone="danger">
          {t('pharmacy.catalog.duplicate', { name: isolate(duplicate.productName ?? '') })}{' '}
          <Link href={`/pharmacy/catalog/${duplicate.productId}`} className="font-medium underline underline-offset-2">
            {t('pharmacy.catalog.openDuplicate')}
          </Link>
        </Alert>
      )}
      {draft.dirty && editable && !held && value.barcodes.some((b) => b.shared && !product?.barcodes.find((p) => p.code === b.code)?.shared) && (
        <p className="text-sm text-muted">{t('pharmacy.catalog.barcode.shareNote')}</p>
      )}

      {product ? (
        <>
          <div role="tablist" aria-label={t('pharmacy.catalog.tabs')} className="flex gap-1 border-b border-line">
            {(['details', 'prices'] as const).map((name) => (
              <button
                key={name}
                id={`${ids}-tab-${name}`}
                type="button"
                role="tab"
                aria-selected={tab === name}
                aria-controls={`${ids}-panel-${name}`}
                tabIndex={tab === name ? 0 : -1}
                onClick={() => setTab(name)}
                onKeyDown={onTabKey}
                className={
                  tab === name
                    ? 'min-h-11 border-b-2 border-ink px-3 text-sm font-semibold text-text'
                    : 'min-h-11 border-b-2 border-transparent px-3 text-sm font-medium text-muted hover:text-text'
                }
              >
                {t(name === 'details' ? 'pharmacy.catalog.tab.details' : 'pharmacy.catalog.tab.prices')}
              </button>
            ))}
          </div>
          <div id={`${ids}-panel-details`} role="tabpanel" aria-labelledby={`${ids}-tab-details`} hidden={tab !== 'details'}>
            {details}
          </div>
          <div id={`${ids}-panel-prices`} role="tabpanel" aria-labelledby={`${ids}-tab-prices`} hidden={tab !== 'prices'}>
            <PriceHistory
              productId={product.id}
              units={product.units}
              currencies={currencies}
              initial={{ items: history, nextCursor: historyCursor }}
              branchNames={props.branchNames ?? Object.fromEntries(branches.map((b) => [b.id, b.name]))}
              place={props.place ?? { branchId: null, branchName: null }}
              canChange={canChangePrice && editable}
            />
          </div>
        </>
      ) : (
        details
      )}
    </div>
  );
}
