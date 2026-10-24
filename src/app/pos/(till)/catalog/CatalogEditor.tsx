'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { previewOf } from '@/server/domain/pos/visible';
import {
  createKitchenSection,
  deleteKitchenSection,
  posCreateCategory,
  posCreateProduct,
  posDeleteCategory,
  posDeleteProduct,
  posSaveProductBasics,
  posSetAvailability,
  posSetCategorySection,
  posSetProductSetting,
  posUpdateCategory,
  renameKitchenSection,
} from '@/app/studio/_actions/pos';
import type { Locale } from '@/lib/locale';
import type { posCatalogEditor } from '@/server/studio/queries/pos';
import type { ActionResult } from '@/server/studio/framework/result';
import { describeFailure } from '@/studio/errors';
import { requireFields, useActionForm, type FormValues } from '@/studio/forms';
import { useLocale, useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';
import { Button } from '@/studio/ui/Button';
import { ConfirmDialog } from '@/studio/ui/ConfirmDialog';
import { Field } from '@/studio/ui/Field';
import { FormError } from '@/studio/ui/FormError';
import { Input } from '@/studio/ui/Input';
import { Select } from '@/studio/ui/Select';
import { Switch } from '@/studio/ui/Switch';

type Editor = Awaited<ReturnType<typeof posCatalogEditor.run>>;
type Category = Editor['catalog']['categories'][number];
type Product = Category['products'][number];
type Section = Editor['sections'][number];

const LANGUAGE_NAMES: Record<Locale, string> = { en: 'English', ar: 'العربية', ckb: 'کوردی' };

/** A whole number from a field; anything else goes to the server as it is, which refuses it. */
const whole = (value: string | undefined): number => (value && /^\d+$/.test(value.trim()) ? Number(value.trim()) : Number.NaN);

const namesOf = (values: FormValues, locales: readonly Locale[]) => Object.fromEntries(locales.map((locale) => [locale, values[`name.${locale}`] ?? '']));

/** What an add form shows again: the typed values after a refusal, nothing after a success (so a press cannot add it twice). */
const afterRefusal = <T,>(form: { data: T | null; fieldError: (name: string) => string | undefined; value: (name: string) => string | undefined }) => ({
  fieldError: form.fieldError,
  value: (name: string) => (form.data === null ? form.value(name) : undefined),
});

/** One-press calls: the answer becomes a toast, and the page re-reads. */
function useCall() {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function call(run: () => Promise<ActionResult<unknown>>): Promise<boolean> {
    setBusy(true);
    const result = await settle(run);
    setBusy(false);
    if (result.ok) {
      toast.success(t('pos.catalog.saved'));
      router.refresh();
    } else {
      toast.error(describeFailure(t, locale, result.error).message);
    }
    return result.ok;
  }
  return { busy, call };
}

function NameFields({ locales, names, form }: { locales: readonly Locale[]; names: Partial<Record<Locale, string>>; form: { fieldError: (n: string) => string | undefined; value: (n: string) => string | undefined } }) {
  const t = useT();
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {locales.map((locale) => (
        <Field key={locale} label={t('pos.catalog.nameIn', { language: LANGUAGE_NAMES[locale] })} error={form.fieldError(`name.${locale}`)}>
          <Input name={`name.${locale}`} lang={locale} dir={locale === 'en' ? 'ltr' : 'rtl'} defaultValue={form.value(`name.${locale}`) ?? names[locale] ?? ''} />
        </Field>
      ))}
    </div>
  );
}

function DeleteButton({ label, title, onDelete }: { label: string; title: string; onDelete: () => Promise<ActionResult<unknown>> }) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        {label}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={title}
        confirmLabel={label}
        onConfirm={async () => {
          const result = await settle(onDelete);
          if (!result.ok) return { message: describeFailure(t, locale, result.error).message };
          toast.success(t('pos.catalog.saved'));
          router.refresh();
          return true;
        }}
      />
    </>
  );
}

function sectionOptions(t: ReturnType<typeof useT>, sections: readonly Section[]) {
  return [{ value: '', label: t('pos.catalog.noSection') }, ...sections.map((section) => ({ value: section.id, label: section.name }))];
}

// Kitchen sections ----------------------------------------------------------------------------------------------------

function SectionRow({ section }: { section: Section }) {
  const t = useT();
  const router = useRouter();
  const form = useActionForm((values) => renameKitchenSection({ sectionId: section.id, name: values.name ?? '' }), {
    keep: ['name'],
    onSuccess: () => {
      toast.success(t('pos.catalog.saved'));
      router.refresh();
    },
  });
  return (
    <li className="flex flex-wrap items-end gap-3 px-4 py-3">
      <form key={section.name} {...form.props} className="flex flex-wrap items-end gap-3">
        <Field label={t('pos.catalog.sectionName')} error={form.fieldError('name')}>
          <Input name="name" defaultValue={form.value('name') ?? section.name} />
        </Field>
        <Button type="submit" variant="secondary" pending={form.pending}>
          {t('pos.catalog.sectionRename')}
        </Button>
      </form>
      <DeleteButton label={t('pos.catalog.sectionDelete')} title={section.name} onDelete={() => deleteKitchenSection({ sectionId: section.id })} />
    </li>
  );
}

function SectionsPanel({ sections }: { sections: Section[] }) {
  const t = useT();
  const router = useRouter();
  const form = useActionForm((values) => createKitchenSection({ name: values.name ?? '' }), {
    keep: ['name'],
    validate: (values) => requireFields(values, { name: t('error.text.designNameEnter') }),
    onSuccess: () => {
      toast.success(t('pos.catalog.saved'));
      router.refresh();
    },
  });
  return (
    <section aria-labelledby="pos-sections" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="pos-sections" className="text-base font-semibold text-text">
          {t('pos.catalog.sections')}
        </h2>
        <p className="text-sm text-muted">{t('pos.catalog.sectionsHint')}</p>
      </div>
      {sections.length === 0 ? (
        <p className="text-sm text-muted">{t('pos.catalog.sectionNone')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
          {sections.map((section) => (
            <SectionRow key={section.id} section={section} />
          ))}
        </ul>
      )}
      <form {...form.props} className="flex flex-wrap items-end gap-3">
        <FormError form={form} fields={['name']} />
        <Field label={t('pos.catalog.sectionName')} error={form.fieldError('name')}>
          <Input name="name" defaultValue={afterRefusal(form).value('name')} />
        </Field>
        <Button type="submit" pending={form.pending}>
          {t('pos.catalog.sectionAdd')}
        </Button>
      </form>
    </section>
  );
}

// Products ------------------------------------------------------------------------------------------------------------

function ProductRow({ product, category, categories, sections, locales, setting }: {
  product: Product;
  category: Category;
  categories: Category[];
  sections: Section[];
  locales: Locale[];
  setting: { sectionId: string | null; soldOutOverride: boolean };
}) {
  const t = useT();
  const router = useRouter();
  const { busy, call } = useCall();
  const form = useActionForm(
    (values) =>
      posSaveProductBasics({
        productId: product.id,
        version: product.version,
        names: namesOf(values, locales),
        price: whole(values.price),
        categoryId: values.categoryId ?? category.id,
      }),
    {
      keep: ['price'],
      onSuccess: () => {
        toast.success(t('pos.catalog.saved'));
        router.refresh();
      },
    },
  );
  return (
    <li className="flex flex-col gap-3 px-4 py-4">
      <form key={product.version} {...form.props} className="flex flex-col gap-3">
        <FormError form={form} fields={['price', 'categoryId', ...locales.map((locale) => `names.${locale}`)]} />
        <NameFields locales={locales} names={product.names} form={form} />
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t('pos.catalog.productPrice')} error={form.fieldError('price')}>
            <Input name="price" inputMode="numeric" dir="ltr" className="rtl:text-right" defaultValue={form.value('price') ?? String(product.price)} />
          </Field>
          <Field label={t('pos.catalog.productCategory')} error={form.fieldError('categoryId')}>
            <Select
              name="categoryId"
              defaultValue={category.id}
              options={categories.map((item) => ({ value: item.id, label: item.names.ar ?? item.names.en ?? item.names.ckb ?? item.slug }))}
            />
          </Field>
          <div className="flex items-end">
            <Button type="submit" pending={form.pending}>
              {t('pos.catalog.productSave')}
            </Button>
          </div>
        </div>
      </form>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <label className="flex items-center gap-2 text-sm text-text">
          <Switch checked={product.isAvailable} disabled={busy} onCheckedChange={(isAvailable) => void call(() => posSetAvailability({ productId: product.id, isAvailable }))} />
          {t('pos.catalog.productInStock')}
        </label>
        <label className="flex items-center gap-2 text-sm text-text">
          <Switch
            checked={setting.soldOutOverride}
            disabled={busy}
            onCheckedChange={(soldOutOverride) => void call(() => posSetProductSetting({ productId: product.id, sectionId: setting.sectionId, soldOutOverride }))}
          />
          {t('pos.catalog.productSoldOutTill')}
        </label>
        <label className="flex items-center gap-2 text-sm text-text">
          {t('pos.catalog.productSection')}
          <Select
            value={setting.sectionId ?? ''}
            disabled={busy}
            onChange={(event) => void call(() => posSetProductSetting({ productId: product.id, sectionId: event.target.value || null, soldOutOverride: setting.soldOutOverride }))}
            options={sectionOptions(t, sections)}
          />
        </label>
        {product.isHidden && <span className="text-sm text-muted">{t('pos.catalog.productHidden')}</span>}
        <DeleteButton
          label={t('pos.catalog.productDelete')}
          title={product.names.ar ?? product.names.en ?? product.names.ckb ?? product.slug}
          onDelete={() => posDeleteProduct({ productId: product.id, version: product.version })}
        />
      </div>
    </li>
  );
}

function AddProduct({ category, locales }: { category: Category; locales: Locale[] }) {
  const t = useT();
  const router = useRouter();
  const form = useActionForm(
    (values) => posCreateProduct({ categoryId: category.id, names: namesOf(values, locales), price: whole(values.price) }),
    {
      keep: ['price', ...locales.map((locale) => `name.${locale}`)],
      onSuccess: () => {
        toast.success(t('pos.catalog.saved'));
        router.refresh();
      },
    },
  );
  return (
    <form {...form.props} className="flex flex-col gap-3 px-4 py-4">
      <FormError form={form} fields={['price', 'categoryId']} />
      <NameFields locales={locales} names={{}} form={afterRefusal(form)} />
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t('pos.catalog.productPrice')} error={form.fieldError('price')}>
          <Input name="price" inputMode="numeric" dir="ltr" className="rtl:text-right" defaultValue={afterRefusal(form).value('price') ?? '0'} />
        </Field>
        <Button type="submit" pending={form.pending}>
          {t('pos.catalog.productAdd')}
        </Button>
      </div>
    </form>
  );
}

// Categories ----------------------------------------------------------------------------------------------------------

function CategoryCard({ category, categories, sections, locales, sectionId, productSettings }: {
  category: Category;
  categories: Category[];
  sections: Section[];
  locales: Locale[];
  sectionId: string | null;
  productSettings: Editor['productSettings'];
}) {
  const t = useT();
  const router = useRouter();
  const { busy, call } = useCall();
  const [expanded, setExpanded] = useState(false);
  const { shown, hidden } = previewOf(category.products, expanded);
  const form = useActionForm(
    (values) => posUpdateCategory({ categoryId: category.id, version: category.version, names: namesOf(values, locales), slug: category.slug, isActive: category.isActive }),
    {
      onSuccess: () => {
        toast.success(t('pos.catalog.saved'));
        router.refresh();
      },
    },
  );
  return (
    <section className="flex flex-col rounded-lg border border-line">
      <div className="flex flex-col gap-3 border-b border-line px-4 py-4">
        <form key={category.version} {...form.props} className="flex flex-col gap-3">
          <FormError form={form} fields={locales.map((locale) => `names.${locale}`)} />
          <NameFields locales={locales} names={category.names} form={form} />
          <Button type="submit" variant="secondary" pending={form.pending} className="self-start">
            {t('common.save')}
          </Button>
        </form>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <label className="flex items-center gap-2 text-sm text-text">
            {t('pos.catalog.categorySection')}
            <Select
              value={sectionId ?? ''}
              disabled={busy}
              onChange={(event) => void call(() => posSetCategorySection({ categoryId: category.id, sectionId: event.target.value || null }))}
              options={sectionOptions(t, sections)}
            />
          </label>
          {!category.isActive && <span className="text-sm text-muted">{t('pos.catalog.categoryInactive')}</span>}
          <DeleteButton
            label={t('pos.catalog.categoryDelete')}
            title={category.names.ar ?? category.names.en ?? category.names.ckb ?? category.slug}
            onDelete={() => posDeleteCategory({ categoryId: category.id, version: category.version })}
          />
        </div>
      </div>
      {category.products.length === 0 ? (
        <p className="px-4 py-3 text-sm text-muted">{t('pos.catalog.productNone')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {shown.map((product) => (
            <ProductRow
              key={product.id}
              product={product}
              category={category}
              categories={categories}
              sections={sections}
              locales={locales}
              setting={productSettings[product.id] ?? { sectionId: null, soldOutOverride: false }}
            />
          ))}
          {hidden > 0 && (
            <li className="px-4 py-3">
              <Button variant="secondary" onClick={() => setExpanded(true)}>
                {t('pos.catalog.showAll', { count: hidden })}
              </Button>
            </li>
          )}
        </ul>
      )}
      <div className="border-t border-line">
        <AddProduct category={category} locales={locales} />
      </div>
    </section>
  );
}

function AddCategory({ locales }: { locales: Locale[] }) {
  const t = useT();
  const router = useRouter();
  const form = useActionForm((values) => posCreateCategory({ names: namesOf(values, locales) }), {
    keep: locales.map((locale) => `name.${locale}`),
    onSuccess: () => {
      toast.success(t('pos.catalog.saved'));
      router.refresh();
    },
  });
  return (
    <form {...form.props} className="flex flex-col gap-3 border-t border-line pt-6">
      <FormError form={form} fields={locales.map((locale) => `names.${locale}`)} />
      <NameFields locales={locales} names={{}} form={afterRefusal(form)} />
      <Button type="submit" pending={form.pending} className="self-start">
        {t('pos.catalog.categoryAdd')}
      </Button>
    </form>
  );
}

/** The product list: kitchen sections, then every category with its products, each saved on its own. */
export function CatalogEditor({ data }: { data: Editor }) {
  const t = useT();
  const { locales, categories } = data.catalog;
  return (
    <>
      <SectionsPanel sections={data.sections} />
      <section aria-labelledby="pos-categories" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="pos-categories" className="text-base font-semibold text-text">
            {t('pos.catalog.categories')}
          </h2>
          <p className="text-sm text-muted">{t('pos.catalog.studioHint')}</p>
        </div>
        {categories.length === 0 && <p className="text-sm text-muted">{t('pos.catalog.categoryNone')}</p>}
        {categories.map((category) => (
          <CategoryCard
            key={category.id}
            category={category}
            categories={categories}
            sections={data.sections}
            locales={locales}
            sectionId={data.categorySections[category.id] ?? null}
            productSettings={data.productSettings}
          />
        ))}
        <AddCategory locales={locales} />
      </section>
    </>
  );
}
