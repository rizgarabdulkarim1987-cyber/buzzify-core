'use client';

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
} from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowDown, ArrowUp, FolderPlus, GripVertical, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useId, useState, useTransition, type ReactNode } from 'react';
import { toast } from 'sonner';
import { createCategory, createProduct, deleteCategory, deleteProduct, moveProduct, reorderCategories, updateCategory } from '@/app/studio/_actions/content';
import { parsePriceInput } from '@/lib/money-input';
import type { ContentTree } from '@/server/studio/services/content';
import { describeFailure } from '@/studio/errors';
import { numberFormat } from '@/studio/format';
import { useLocale, useT } from '@/studio/i18n';
import { useRefuse } from '@/studio/refuse';
import { Button } from '@/studio/ui/Button';
import { ConfirmDialog } from '@/studio/ui/ConfirmDialog';
import { cx } from '@/studio/ui/cx';
import { Dialog } from '@/studio/ui/Dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/studio/ui/DropdownMenu';
import { EmptyState } from '@/studio/ui/EmptyState';
import { Field } from '@/studio/ui/Field';
import { Alert } from '@/studio/ui/Alert';
import { IconButton } from '@/studio/ui/IconButton';
import { Input } from '@/studio/ui/Input';
import { isolated } from '@/studio/ui/isolate';
import { Switch } from '@/studio/ui/Switch';
import { ProductDrawer } from './ProductDrawer';
import { MissingMarker, ProductList, type ProductRow } from './ProductList';
import { displayName, PRICE_PROBLEM_KEYS, type Names } from './shared';
import { TranslationFields } from './TranslationFields';

type CategoryRow = ContentTree['categories'][number];

export interface CategoryTreeProps {
  menuId: string;
  restaurantId: string;
  tree: ContentTree;
  /** `content.prices`: prices and differences can be set. */
  canPrice: boolean;
  /** `content.media`: pictures can be uploaded. */
  canMedia: boolean;
}

/** The messages under one text's inputs: `names.ar` becomes `{ ar: … }`. */
function byLanguage(fields: Record<string, string>, prefix: string): Partial<Record<'en' | 'ar' | 'ckb', string>> {
  return Object.fromEntries(
    Object.entries(fields)
      .filter(([path]) => path.startsWith(`${prefix}.`))
      .map(([path, message]) => [path.slice(prefix.length + 1), message]),
  );
}

/**
 * The Content tab (spec 10.3): the menu's categories in their order, each with its products. Categories are dragged by
 * their handle (or moved with Space and the arrow keys, or with Move up and Move down in their menu); products open in
 * the drawer. Every change goes to the draft; guests see it after a publish.
 */
export function CategoryTree({ menuId, restaurantId, tree, canPrice, canMedia }: CategoryTreeProps) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const refuse = useRefuse();
  const [busy, startWork] = useTransition();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<CategoryRow | null>(null);
  const [addingTo, setAddingTo] = useState<CategoryRow | null>(null);
  const [deletingCategory, setDeletingCategory] = useState<CategoryRow | null>(null);
  const [deletingProduct, setDeletingProduct] = useState<ProductRow | null>(null);
  const [open, setOpen] = useState<{ id: string; name: string } | null>(null);

  // The order shown: the server's, or the one just chosen while it is being saved.
  const serverOrder = tree.categories.map((category) => category.id);
  const [chosen, setChosen] = useState<{ basis: string; order: string[] } | null>(null);
  const order = chosen && chosen.basis === serverOrder.join() ? chosen.order : serverOrder;
  const byId = new Map(tree.categories.map((category) => [category.id, category]));
  const categories = order.map((id) => byId.get(id)).filter((category): category is CategoryRow => category !== undefined);
  const nameOf = (category: CategoryRow) => displayName(category.names, locale, tree.defaultLocale) || category.slug;

  // A stable id for the ids dnd-kit writes into the page, so the server's HTML and the browser's agree.
  const dndId = useId();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const reorder = (next: string[]) => {
    setChosen({ basis: serverOrder.join(), order: next });
    startWork(async () => {
      const result = await reorderCategories({ menuId, order: next });
      if (!result.ok) {
        setChosen(null);
        toast.error(describeFailure(t, locale, result.error).message);
      }
      router.refresh();
    });
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    reorder(arrayMove(order, order.indexOf(String(active.id)), order.indexOf(String(over.id))));
  };

  const position = (id: unknown) => order.indexOf(String(id)) + 1;
  const named = (id: unknown) => {
    const category = byId.get(String(id));
    return category ? nameOf(category) : '';
  };
  const announcements: Announcements = {
    onDragStart: ({ active }) => t('content.dnd.picked', { name: named(active.id), position: position(active.id), count: order.length }),
    onDragOver: ({ active, over }) => (over ? t('content.dnd.over', { name: named(active.id), position: position(over.id), count: order.length }) : undefined),
    onDragEnd: ({ active, over }) => (over ? t('content.dnd.dropped', { name: named(active.id), position: position(over.id), count: order.length }) : undefined),
    onDragCancel: ({ active }) => t('content.dnd.cancelled', { name: named(active.id) }),
  };

  const moveProductTo = (product: ProductRow, categoryId: string, index: number) =>
    startWork(async () => {
      const result = await moveProduct({ menuId, productId: product.id, categoryId, index });
      if (!result.ok) toast.error(describeFailure(t, locale, result.error).message);
      router.refresh();
    });

  const addCategoryButton = (
    <Button variant="primary" icon={<FolderPlus aria-hidden />} onClick={() => setAdding(true)}>
      {t('content.addCategory')}
    </Button>
  );
  const number = numberFormat(locale);
  const productCount = tree.categories.reduce((sum, category) => sum + category.products.length, 0);

  return (
    <div className="flex max-w-5xl flex-col gap-4 px-8 pb-10 pt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">{t('content.summary', { categories: number.format(tree.categories.length), products: number.format(productCount) })}</p>
        {tree.categories.length > 0 && addCategoryButton}
      </div>

      {categories.length === 0 ? (
        <EmptyState icon={<FolderPlus aria-hidden />} title={t('content.emptyTitle')} body={t('content.emptyBody')} action={addCategoryButton} />
      ) : (
        <DndContext
          id={dndId}
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
          accessibility={{ announcements, screenReaderInstructions: { draggable: t('content.dnd.instructions') } }}
        >
          <SortableContext items={order} strategy={verticalListSortingStrategy}>
            <ol aria-label={t('content.categories')} className="flex flex-col gap-4">
              {categories.map((category, index) => (
                <SortableCategory key={category.id} category={category} name={nameOf(category)}>
                  <div className="ms-auto flex shrink-0 items-center gap-1">
                    <Button size="sm" variant="ghost" icon={<Plus aria-hidden />} onClick={() => setAddingTo(category)}>
                      {t('content.addProduct')}
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <IconButton label={t('content.categoryActions', { name: nameOf(category) })} icon={<MoreHorizontal aria-hidden />} size="sm" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem icon={<Pencil aria-hidden />} onSelect={() => setEditing(category)}>
                          {t('content.edit')}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          icon={<ArrowUp aria-hidden />}
                          disabled={index === 0 || busy}
                          onSelect={() => reorder(arrayMove(order, index, index - 1))}
                        >
                          {t('content.moveUp')}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          icon={<ArrowDown aria-hidden />}
                          disabled={index === categories.length - 1 || busy}
                          onSelect={() => reorder(arrayMove(order, index, index + 1))}
                        >
                          {t('content.moveDown')}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem danger icon={<Trash2 aria-hidden />} onSelect={() => setDeletingCategory(category)}>
                          {t('content.delete')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <ProductList
                    products={category.products}
                    currency={tree.currency}
                    defaultLocale={tree.defaultLocale}
                    busy={busy}
                    onOpen={(product) => setOpen({ id: product.id, name: displayName(product.names, locale, tree.defaultLocale) })}
                    onMove={(product, to) => moveProductTo(product, category.id, to)}
                    onDelete={setDeletingProduct}
                  />
                </SortableCategory>
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      )}

      {adding && <CategoryDialog menuId={menuId} locales={tree.locales} category={null} onClose={() => setAdding(false)} />}
      {editing && (
        <CategoryDialog key={`${editing.id}:${editing.version}`} menuId={menuId} locales={tree.locales} category={editing} onClose={() => setEditing(null)} />
      )}
      {addingTo && (
        <ProductDialog
          menuId={menuId}
          tree={tree}
          category={addingTo}
          canPrice={canPrice}
          onClose={() => setAddingTo(null)}
          onCreated={(id, name) => setOpen({ id, name })}
        />
      )}
      {open && (
        <ProductDrawer
          key={open.id}
          menuId={menuId}
          restaurantId={restaurantId}
          productId={open.id}
          name={open.name}
          tree={tree}
          canPrice={canPrice}
          canMedia={canMedia}
          onClose={() => setOpen(null)}
        />
      )}

      <ConfirmDialog
        open={deletingCategory !== null}
        onOpenChange={(next) => {
          if (!next) setDeletingCategory(null);
        }}
        title={isolated(t('content.category.deleteTitle'), { name: deletingCategory ? nameOf(deletingCategory) : '' })}
        body={t('content.category.deleteBody')}
        confirmLabel={t('content.delete')}
        onConfirm={async () => {
          if (!deletingCategory) return true;
          const result = await deleteCategory({ menuId, categoryId: deletingCategory.id, version: deletingCategory.version });
          if (!result.ok) return refuse(result);
          toast.success(t('content.category.deleted'));
          router.refresh();
          return true;
        }}
      />
      <ConfirmDialog
        open={deletingProduct !== null}
        onOpenChange={(next) => {
          if (!next) setDeletingProduct(null);
        }}
        title={isolated(t('content.product.deleteTitle'), {
          name: deletingProduct ? displayName(deletingProduct.names, locale, tree.defaultLocale) || deletingProduct.slug : '',
        })}
        body={t('content.product.deleteBody')}
        confirmLabel={t('content.delete')}
        onConfirm={async () => {
          if (!deletingProduct) return true;
          const result = await deleteProduct({ menuId, productId: deletingProduct.id, version: deletingProduct.version });
          if (!result.ok) return refuse(result);
          toast.success(t('content.product.deleted'));
          router.refresh();
          return true;
        }}
      />
    </div>
  );
}

/** One category in the sortable list: its handle, heading and markers, then what `children` adds (actions, products). */
function SortableCategory({ category, name, children }: { category: CategoryRow; name: string; children: [ReactNode, ReactNode] }) {
  const t = useT();
  const headingId = useId();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: category.id });
  const [actions, products] = children;
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cx('rounded-lg border border-line bg-raised', isDragging && 'relative z-10 shadow-dialog')}
    >
      <section aria-labelledby={headingId}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line py-2 pe-2 ps-1.5">
          <button
            ref={setActivatorNodeRef}
            type="button"
            {...attributes}
            {...listeners}
            aria-label={t('content.reorder', { name })}
            className="inline-flex size-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-sm text-muted transition-colors hover:bg-hover hover:text-text active:cursor-grabbing"
          >
            <GripVertical aria-hidden className="size-4" />
          </button>
          <div className={cx('flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1', !category.isActive && 'opacity-60')}>
            <h2 id={headingId} className="truncate text-md font-semibold text-text">
              {name}
            </h2>
            <span dir="ltr" className="font-mono text-xs text-muted">
              /{category.slug}
            </span>
          </div>
          {!category.isActive && <span className="rounded-sm border border-line px-1.5 text-xs text-muted">{t('content.category.hiddenBadge')}</span>}
          <MissingMarker missing={category.missing} />
          {actions}
        </div>
        <div className={cx(!category.isActive && 'opacity-60')}>{products}</div>
      </section>
    </li>
  );
}

/** Adding a category (only its names) or editing one (names, address, shown to guests). Mounted only while open. */
function CategoryDialog({
  menuId,
  locales,
  category,
  onClose,
}: {
  menuId: string;
  locales: ContentTree['locales'];
  category: CategoryRow | null;
  onClose: () => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const formId = useId();
  const [names, setNames] = useState<Names>(category?.names ?? {});
  const [slug, setSlug] = useState(category?.slug ?? '');
  const [isActive, setIsActive] = useState(category?.isActive ?? true);
  const [problem, setProblem] = useState<{ message: string; fields: Record<string, string>; attempt: number } | null>(null);
  const [pending, startPending] = useTransition();

  const submit = () =>
    startPending(async () => {
      const result = category
        ? await updateCategory({ menuId, categoryId: category.id, version: category.version, names, slug: slug.trim(), isActive })
        : await createCategory({ menuId, names });
      if (!result.ok) {
        const described = describeFailure(t, locale, result.error);
        setProblem({ message: described.message, fields: described.fields, attempt: (problem?.attempt ?? 0) + 1 });
        return;
      }
      toast.success(t(category ? 'content.category.saved' : 'content.category.added'));
      router.refresh();
      onClose();
    });

  const submitLabel = category ? t('common.save') : t('content.addCategory');
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={category ? t('content.category.editTitle') : t('content.addCategoryTitle')}
      width="md"
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" type="submit" form={formId} pending={pending}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className="flex flex-col gap-4"
      >
        {problem && (
          <Alert key={problem.attempt} tone="danger">
            {problem.message}
          </Alert>
        )}
        <TranslationFields label={t('content.name')} locales={locales} values={names} maxLength={120} errors={byLanguage(problem?.fields ?? {}, 'names')} onChange={setNames} />
        {category && (
          <>
            <Field label={t('content.category.slug')} hint={t('content.category.slugHint')} error={problem?.fields.slug}>
              <Input value={slug} dir="ltr" maxLength={48} onChange={(event) => setSlug(event.target.value)} className="font-mono" />
            </Field>
            <label className="flex items-start justify-between gap-6">
              <span className="flex flex-col gap-0.5">
                <span className="text-base text-text">{t('content.category.shown')}</span>
                <span className="text-sm text-muted">{t('content.category.shownHint')}</span>
              </span>
              <Switch aria-label={t('content.category.shown')} checked={isActive} onCheckedChange={setIsActive} />
            </label>
          </>
        )}
      </form>
    </Dialog>
  );
}

/** Adding a product to a category: its names and price; the drawer opens on it next for the rest. */
function ProductDialog({
  menuId,
  tree,
  category,
  canPrice,
  onClose,
  onCreated,
}: {
  menuId: string;
  tree: ContentTree;
  category: CategoryRow;
  canPrice: boolean;
  onClose: () => void;
  onCreated: (productId: string, name: string) => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const formId = useId();
  const [names, setNames] = useState<Names>({});
  const [price, setPrice] = useState('');
  const [problem, setProblem] = useState<{ message: string; fields: Record<string, string>; attempt: number } | null>(null);
  const [pending, startPending] = useTransition();

  const submit = () =>
    startPending(async () => {
      const attempt = (problem?.attempt ?? 0) + 1;
      const parsed = canPrice ? parsePriceInput(price, tree.currency) : ({ ok: true, minor: 0 } as const);
      if (!parsed.ok) {
        setProblem({ message: t('error.INVALID'), fields: { price: t(PRICE_PROBLEM_KEYS[parsed.reason]) }, attempt });
        return;
      }
      const result = await createProduct({ menuId, categoryId: category.id, names, price: parsed.minor });
      if (!result.ok) {
        const described = describeFailure(t, locale, result.error);
        setProblem({ message: described.message, fields: described.fields, attempt });
        return;
      }
      router.refresh();
      onClose();
      onCreated(result.data.productId, displayName(names, locale, tree.defaultLocale));
    });

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={t('content.addProductTitle')}
      description={isolated(t('content.product.addIn'), { category: displayName(category.names, locale, tree.defaultLocale) || category.slug })}
      width="md"
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" type="submit" form={formId} pending={pending}>
            {t('content.addProduct')}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className="flex flex-col gap-4"
      >
        {problem && (
          <Alert key={problem.attempt} tone="danger">
            {problem.message}
          </Alert>
        )}
        <TranslationFields label={t('content.name')} locales={tree.locales} values={names} maxLength={120} errors={byLanguage(problem?.fields ?? {}, 'names')} onChange={setNames} />
        <Field label={t('content.price')} hint={canPrice ? tree.currency : t('content.price.locked')} error={problem?.fields.price} className="max-w-48">
          <Input value={price} inputMode="decimal" dir="ltr" disabled={!canPrice} onChange={(event) => setPrice(event.target.value)} className="tabular-nums" />
        </Field>
      </form>
    </Dialog>
  );
}
