'use client';

import { ImagePlus, Images, LoaderCircle, RotateCw, Trash2, Upload, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Dialog as RadixDialog } from 'radix-ui';
import { useCallback, useEffect, useId, useRef, useState, useTransition, type ReactNode } from 'react';
import { toast } from 'sonner';
import { loadProduct, saveProduct } from '@/app/studio/_actions/content';
import type { Locale } from '@/lib/locale';
import type { ContentTree, ProductEditing } from '@/server/studio/services/content';
import { describeFailure } from '@/studio/errors';
import { useLocale, useT } from '@/studio/i18n';
import { MediaPicker, type PickedMedia } from '@/studio/media/MediaPicker';
import { uploadMedia } from '@/studio/media/upload';
import { Alert } from '@/studio/ui/Alert';
import { Button } from '@/studio/ui/Button';
import { ConfirmDialog } from '@/studio/ui/ConfirmDialog';
import { cx } from '@/studio/ui/cx';
import { Field } from '@/studio/ui/Field';
import { IconButton } from '@/studio/ui/IconButton';
import { Input } from '@/studio/ui/Input';
import { Select } from '@/studio/ui/Select';
import { Switch } from '@/studio/ui/Switch';
import { comparable, draftOf, toSave, type MediaDraft, type ProductDraft } from './draft';
import { GroupsEditor } from './GroupsEditor';
import { displayName, newKey, type Names } from './shared';
import { TagFields } from './TagFields';
import { TranslationFields } from './TranslationFields';
import { VariantsEditor } from './VariantsEditor';

export interface ProductDrawerProps {
  menuId: string;
  restaurantId: string;
  productId: string;
  /** The name the list shows, for the title while the product loads. */
  name: string;
  tree: Pick<ContentTree, 'locales' | 'defaultLocale' | 'currency' | 'categories'>;
  canPrice: boolean;
  canMedia: boolean;
  onClose: () => void;
}

/** The messages under one text's inputs: `names.ar` becomes `{ ar: … }` for the Arabic input. */
function byLanguage(errors: Record<string, string>, prefix: string): Partial<Record<Locale, string>> {
  const result: Partial<Record<Locale, string>> = {};
  for (const [path, message] of Object.entries(errors)) {
    if (path.startsWith(`${prefix}.`)) result[path.slice(prefix.length + 1) as Locale] = message;
  }
  return result;
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3 border-t border-line pt-5 first:border-t-0 first:pt-0">
      <div className="flex flex-col gap-0.5">
        <h3 id={id} className="text-md font-semibold text-text">
          {title}
        </h3>
        {hint && <p className="max-w-[65ch] text-sm text-muted">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

interface PendingUpload {
  file: File;
  preview: string;
  alt: Names;
  progress: number | null;
  problem: string | null;
}

/**
 * A product in a side sheet (spec 10.3): its texts in the menu's languages side by side, its price, sizes, option groups,
 * pictures, tags and highlights. Saving writes the draft at the version the drawer opened (someone else's save in
 * between is named, with a Reload); closing with unsaved changes asks first. Focus stays inside while it is open.
 */
export function ProductDrawer({ menuId, restaurantId, productId, name, tree, canPrice, canMedia, onClose }: ProductDrawerProps) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const [product, setProduct] = useState<ProductEditing | null>(null);
  const [draft, setDraft] = useState<ProductDraft | null>(null);
  const [initial, setInitial] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<{ code: string; message: string; attempt: number } | null>(null);
  const [loadProblem, setLoadProblem] = useState<string | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const [picking, setPicking] = useState(false);
  const [upload, setUpload] = useState<PendingUpload | null>(null);
  // What had focus when the drawer opened (the product's row): Radix gives focus back only to its own trigger, and the
  // drawer is opened from the list, so on close focus goes back here, where the person left off.
  const [opener] = useState(() => (typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null)));
  const [saving, startSaving] = useTransition();
  const [, startLoading] = useTransition();
  const body = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const { locales, currency } = tree;

  const load = useCallback(
    () =>
      startLoading(async () => {
        const result = await loadProduct({ menuId, productId });
        if (!result.ok) {
          setLoadProblem(describeFailure(t, locale, result.error).message);
          return;
        }
        const fresh = draftOf(result.data, currency);
        setProduct(result.data);
        setDraft(fresh);
        setInitial(comparable(fresh));
        setErrors({});
        setFailure(null);
      }),
    [menuId, productId, currency, t, locale],
  );

  // Loaded once per product. A refresh of the page around the drawer (after a save elsewhere, or the add that opened it)
  // gives it new props and a new translator; reloading then would throw away what the person has typed.
  const loadOnce = useRef(load);
  useEffect(() => loadOnce.current(), []);

  const dirty = draft !== null && comparable(draft) !== initial;
  const change = (patch: Partial<ProductDraft>) => setDraft((current) => (current ? { ...current, ...patch } : current));
  const requestClose = () => (dirty ? setDiscarding(true) : onClose());

  const save = () =>
    startSaving(async () => {
      if (!draft || !product) return;
      const built = toSave(draft, { menuId, productId, version: product.version, currency });
      const attempt = (failure?.attempt ?? 0) + 1;
      if (!built.ok) {
        setErrors(Object.fromEntries(Object.entries(built.errors).map(([path, key]) => [path, t(key)])));
        setFailure({ code: 'INVALID', message: t('error.INVALID'), attempt });
        return;
      }
      const result = await saveProduct(built.save);
      if (!result.ok) {
        const described = describeFailure(t, locale, result.error);
        setErrors(described.fields);
        setFailure({ code: described.code, message: described.message, attempt });
        return;
      }
      toast.success(t('content.drawer.saved'));
      router.refresh();
      onClose();
    });

  // After a refusal, the first field it names takes focus (the Save button had it); a conflict keeps focus on its alert.
  useEffect(() => {
    if (!failure || failure.code === 'CONFLICT') return;
    const invalid = body.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    invalid?.focus();
  }, [failure]);

  const addPicked = (items: PickedMedia[]) =>
    change({
      media: [
        ...(draft?.media ?? []),
        ...items
          .filter((item) => !draft?.media.some((entry) => entry.value.kind === 'asset' && entry.value.assetId === item.assetId))
          .map((item): MediaDraft => ({ key: newKey(), value: { kind: 'asset', assetId: item.assetId }, thumbUrl: item.thumbUrl })),
      ],
    });

  const startUpload = () => {
    if (!upload) return;
    const pending = upload;
    setUpload({ ...pending, progress: 0, problem: null });
    void uploadMedia(pending.file, { restaurantId }, { alt: pending.alt, onProgress: (fraction) => setUpload((current) => current && { ...current, progress: fraction }) }).then(
      (result) => {
        if (!result.ok) {
          setUpload((current) => current && { ...current, progress: null, problem: describeFailure(t, locale, result.error).message });
          return;
        }
        setDraft((current) =>
          current && { ...current, media: [...current.media, { key: newKey(), value: { kind: 'asset', assetId: result.data.assetId }, thumbUrl: pending.preview }] },
        );
        setUpload(null);
      },
    );
  };

  // The product as it was opened: the title stays put while its names are being edited.
  const title = (product && displayName(product.names, locale, tree.defaultLocale)) || name;
  const categories = tree.categories.map((category) => ({ value: category.id, label: displayName(category.names, locale, tree.defaultLocale) || category.slug }));

  return (
    <RadixDialog.Root
      open
      onOpenChange={(open) => {
        if (!open) requestClose();
      }}
    >
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-overlay data-[state=open]:animate-overlay-in" />
        <RadixDialog.Content
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            if (opener?.isConnected && opener !== document.body) {
              event.preventDefault();
              opener.focus();
            }
          }}
          className={cx(
            'fixed inset-y-0 end-0 z-50 flex w-[min(860px,100vw)] flex-col bg-raised shadow-dialog outline-none',
            'data-[state=open]:animate-sheet-in',
          )}
        >
          <header className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
            <div className="flex min-w-0 flex-col gap-0.5">
              <RadixDialog.Title className="truncate text-lg font-semibold text-text">{title}</RadixDialog.Title>
              {product && (
                <p dir="ltr" className="truncate font-mono text-xs text-muted rtl:text-end">
                  /{product.slug}
                </p>
              )}
            </div>
            <IconButton label={t('common.close')} icon={<X aria-hidden />} onClick={requestClose} className="-me-2" />
          </header>

          <div ref={body} className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            {!draft ? (
              <div className="flex items-center gap-2 py-10 text-sm text-muted" role="status">
                {loadProblem ?? (
                  <>
                    <LoaderCircle aria-hidden className="size-4 animate-spin" />
                    {t('content.drawer.loading')}
                  </>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-8">
                <Section title={t('content.drawer.texts')}>
                  <TranslationFields
                    label={t('content.name')}
                    locales={locales}
                    values={draft.names}
                    maxLength={120}
                    markMissing
                    errors={byLanguage(errors, 'names')}
                    onChange={(names) => change({ names })}
                  />
                  <TranslationFields
                    label={t('content.description')}
                    locales={locales}
                    values={draft.descriptions}
                    maxLength={1000}
                    multiline
                    errors={byLanguage(errors, 'descriptions')}
                    onChange={(descriptions) => change({ descriptions })}
                  />
                </Section>

                <Section title={t('content.drawer.basics')}>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <Field
                      label={t('content.price')}
                      hint={canPrice ? currency : t('content.price.locked')}
                      error={errors.price}
                    >
                      <Input
                        value={draft.price}
                        inputMode="decimal"
                        dir="ltr"
                        disabled={!canPrice}
                        onChange={(event) => change({ price: event.target.value })}
                        className="tabular-nums"
                      />
                    </Field>
                    <Field label={t('content.drawer.category')} error={errors.categoryId}>
                      <Select options={categories} value={draft.categoryId} onChange={(event) => change({ categoryId: event.target.value })} />
                    </Field>
                    <Field label={t('content.drawer.slug')} hint={t('content.drawer.slugHint')} error={errors.slug}>
                      <Input value={draft.slug} dir="ltr" maxLength={48} onChange={(event) => change({ slug: event.target.value })} className="font-mono" />
                    </Field>
                  </div>
                </Section>

                <Section title={t('content.sizes.heading')} hint={t('content.sizes.intro')}>
                  <VariantsEditor
                    locales={locales}
                    currency={currency}
                    price={draft.price}
                    variants={draft.variants}
                    onChange={(variants) => change({ variants })}
                    errors={errors}
                    canPrice={canPrice}
                  />
                </Section>

                <Section title={t('content.groups.heading')} hint={t('content.groups.intro')}>
                  <GroupsEditor locales={locales} groups={draft.groups} onChange={(groups) => change({ groups })} errors={errors} canPrice={canPrice} />
                </Section>

                <Section title={t('content.media.title')} hint={t('content.media.intro')}>
                  {draft.media.length > 0 && (
                    <ol aria-label={t('content.media.title')} className="flex flex-wrap gap-3">
                      {draft.media.map((entry, index) => (
                        <li key={entry.key} className="flex flex-col items-center gap-1">
                          <div className="relative size-24 overflow-hidden rounded-md border border-line bg-surface">
                            {entry.thumbUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element -- a library thumbnail or the file just chosen
                              <img src={entry.thumbUrl} alt="" className="size-full object-cover" />
                            ) : (
                              <span className="flex size-full items-center justify-center text-xs text-muted">{t(`content.media.kind.${entry.value.kind}`)}</span>
                            )}
                            {index === 0 && (
                              <span className="absolute bottom-1 start-1 rounded-sm bg-ink px-1 text-xs text-on-ink">{t('content.media.main')}</span>
                            )}
                          </div>
                          <IconButton
                            label={t('content.media.remove', { n: index + 1 })}
                            icon={<Trash2 aria-hidden />}
                            size="sm"
                            onClick={() => change({ media: draft.media.filter((_, at) => at !== index) })}
                          />
                        </li>
                      ))}
                    </ol>
                  )}
                  {errors.media && <p className="text-sm text-danger">{errors.media}</p>}

                  {upload ? (
                    <div className="flex flex-col gap-3 rounded-md border border-line bg-surface p-3">
                      <div className="flex items-start gap-3">
                        {/* eslint-disable-next-line @next/next/no-img-element -- the chosen file, before it is uploaded */}
                        <img src={upload.preview} alt="" className="size-16 shrink-0 rounded-md border border-line object-cover" />
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <span className="truncate text-sm font-medium text-text">{upload.file.name}</span>
                          <span className="text-sm text-muted">{t('content.media.altIntro')}</span>
                        </div>
                      </div>
                      <TranslationFields
                        label={t('content.media.alt')}
                        locales={locales}
                        values={upload.alt}
                        maxLength={250}
                        onChange={(alt) => setUpload({ ...upload, alt })}
                      />
                      {upload.progress !== null && (
                        <div
                          role="progressbar"
                          aria-label={t('content.media.progress')}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={Math.round(upload.progress * 100)}
                          className="h-1.5 overflow-hidden rounded-full bg-line"
                        >
                          <div className="h-full bg-ink transition-[width] duration-150" style={{ width: `${Math.round(upload.progress * 100)}%` }} />
                        </div>
                      )}
                      {upload.problem && (
                        <p role="alert" className="text-sm text-danger">
                          {upload.problem}
                        </p>
                      )}
                      <div className="flex gap-2">
                        <Button size="sm" variant="primary" icon={<Upload aria-hidden />} onClick={startUpload} disabled={upload.progress !== null}>
                          {t('content.media.uploadStart')}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={upload.progress !== null}
                          onClick={() => {
                            URL.revokeObjectURL(upload.preview);
                            setUpload(null);
                          }}
                        >
                          {t('common.cancel')}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" icon={<Images aria-hidden />} onClick={() => setPicking(true)}>
                        {t('content.media.choose')}
                      </Button>
                      {canMedia && (
                        <>
                          <input
                            ref={fileInput}
                            type="file"
                            accept="image/jpeg,image/png,image/webp,image/avif,image/svg+xml"
                            aria-label={t('content.media.upload')}
                            className="sr-only"
                            tabIndex={-1}
                            onChange={(event) => {
                              const file = event.target.files?.[0];
                              event.target.value = '';
                              if (file) setUpload({ file, preview: URL.createObjectURL(file), alt: {}, progress: null, problem: null });
                            }}
                          />
                          <Button size="sm" icon={<ImagePlus aria-hidden />} onClick={() => fileInput.current?.click()}>
                            {t('content.media.upload')}
                          </Button>
                        </>
                      )}
                    </div>
                  )}
                </Section>

                <Section title={t('content.tags.heading')} hint={t('content.tags.intro')}>
                  <TagFields
                    values={{ allergens: draft.allergens, dietary: draft.dietary, badges: draft.badges }}
                    onChange={(tags) => change(tags)}
                  />
                  <Field label={t('content.calories.label')} hint={t('content.calories.hint')} error={errors.calories} optional className="max-w-40">
                    <Input value={draft.calories} inputMode="numeric" dir="ltr" onChange={(event) => change({ calories: event.target.value })} className="tabular-nums" />
                  </Field>
                </Section>

                <Section title={t('content.drawer.highlights')}>
                  <div className="flex flex-col gap-3">
                    <label className="flex items-start justify-between gap-6">
                      <span className="flex flex-col gap-0.5">
                        <span className="text-base text-text">{t('content.signature')}</span>
                        <span className="text-sm text-muted">{t('content.signatureHint')}</span>
                      </span>
                      <Switch aria-label={t('content.signature')} checked={draft.isSignature} onCheckedChange={(isSignature) => change({ isSignature })} />
                    </label>
                    <label className="flex items-start justify-between gap-6">
                      <span className="flex flex-col gap-0.5">
                        <span className="text-base text-text">{t('content.featured')}</span>
                        <span className="text-sm text-muted">{t('content.featuredHint')}</span>
                      </span>
                      <Switch aria-label={t('content.featured')} checked={draft.isFeatured} onCheckedChange={(isFeatured) => change({ isFeatured })} />
                    </label>
                  </div>
                </Section>
              </div>
            )}
          </div>

          <footer className="flex flex-col gap-3 border-t border-line px-6 py-3">
            {failure && (
              <Alert key={failure.attempt} tone="danger">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span>{failure.message}</span>
                  {failure.code === 'CONFLICT' && (
                    <Button size="sm" icon={<RotateCw aria-hidden />} onClick={load}>
                      {t('content.drawer.reload')}
                    </Button>
                  )}
                </div>
              </Alert>
            )}
            <div className="flex items-center justify-end gap-2">
              {dirty && <span className="me-auto text-sm text-muted">{t('content.drawer.unsaved')}</span>}
              <Button onClick={requestClose}>{t('common.cancel')}</Button>
              <Button variant="primary" onClick={save} disabled={!draft} pending={saving}>
                {t('common.save')}
              </Button>
            </div>
          </footer>

          <MediaPicker open={picking} onOpenChange={setPicking} restaurantId={restaurantId} onPick={addPicked} />
          <ConfirmDialog
            open={discarding}
            onOpenChange={setDiscarding}
            title={t('content.drawer.discardTitle')}
            body={t('content.drawer.discardBody')}
            confirmLabel={t('content.drawer.discard')}
            onConfirm={async () => {
              onClose();
              return true;
            }}
          />
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
