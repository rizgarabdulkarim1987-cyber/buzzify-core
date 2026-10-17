'use client';

import { ExternalLink, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { deleteAsset, deleteSharedAsset, mediaUsage, sharedMediaUsage, updateAsset, updateSharedAsset } from '@/app/studio/_actions/media';
import { LOCALES } from '@/lib/locale';
import type { AssetUsage } from '@/server/media/usage';
import type { MediaRow } from '@/server/studio/services/media';
import { describeFailure } from '@/studio/errors';
import { formatBytes, formatDate, numberFormat } from '@/studio/format';
import { useLocale, useT } from '@/studio/i18n';
import { useRefuse } from '@/studio/refuse';
import { Button } from '@/studio/ui/Button';
import { ConfirmDialog } from '@/studio/ui/ConfirmDialog';
import { Field } from '@/studio/ui/Field';
import { Input } from '@/studio/ui/Input';
import { assetName, typeName } from './MediaGrid';

export interface MediaDetailsProps {
  row: MediaRow;
  /** The restaurant whose library this is; null for the shared library. */
  restaurantId: string | null;
  /** Whether the person may change and delete it (the shared library is a Super Admin's). */
  editable: boolean;
  /** The library's folders, offered as the person types one. */
  folders: readonly string[];
  onDeleted: () => void;
}

/**
 * One picture of the library (spec 11): a larger preview and the file itself, its type, size and dimensions, its alt
 * text in each language, its folder and tags, and where menus use it. Deleting a picture in use is refused, and the
 * list says where to remove it first.
 */
export function MediaDetails({ row, restaurantId, editable, folders, onDeleted }: MediaDetailsProps) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const refuse = useRefuse();
  const titleId = useId();
  const foldersId = useId();
  const number = numberFormat(locale);
  const [alt, setAlt] = useState<Record<string, string>>({ ...row.alt });
  const [folder, setFolder] = useState(row.folder);
  const [tags, setTags] = useState(row.tags.join(', '));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [usage, setUsage] = useState<AssetUsage | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [saving, startSaving] = useTransition();
  const shared = restaurantId === null;

  // Where the picture is used, read when it is chosen. The shared library's uses span every restaurant: a Super Admin's to read.
  useEffect(() => {
    if (shared && !editable) return;
    let current = true;
    void (shared ? sharedMediaUsage({ assetId: row.id }) : mediaUsage({ restaurantId, assetId: row.id })).then((result) => {
      if (current && result.ok) setUsage(result.data);
    });
    return () => {
      current = false;
    };
  }, [row.id, restaurantId, shared, editable]);

  const save = () =>
    startSaving(async () => {
      const input = { assetId: row.id, version: row.version, alt, folder, tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean) };
      const result = shared ? await updateSharedAsset(input) : await updateAsset({ ...input, restaurantId });
      if (!result.ok) {
        const described = describeFailure(t, locale, result.error);
        setErrors(described.fields);
        if (Object.keys(described.fields).length === 0) toast.error(described.message);
        return;
      }
      setErrors({});
      toast.success(t('media.details.saved'));
      router.refresh();
    });

  const uses = usage ? usage.drafts.length + usage.revisions.length : 0;

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-5 rounded-lg border border-line bg-raised p-4">
      <h2 id={titleId} className="text-md font-semibold text-text">
        {t('media.details.title')}
      </h2>
      <div className="studio-checker flex aspect-[4/3] items-center justify-center overflow-hidden rounded-md border border-line p-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- the library's own rendition, at its own size */}
        <img src={row.previewUrl} alt={assetName(t, locale, row)} className="max-h-full max-w-full object-contain" />
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted">{t('media.details.type')}</dt>
        <dd className="text-text">{typeName(row.mime)}</dd>
        <dt className="text-muted">{t('media.details.size')}</dt>
        <dd className="text-text">{formatBytes(row.bytes, locale)}</dd>
        {row.width && row.height && (
          <>
            <dt className="text-muted">{t('media.details.dimensions')}</dt>
            <dd className="text-text">
              <span dir="ltr">{`${number.format(row.width)} × ${number.format(row.height)} px`}</span>
            </dd>
          </>
        )}
        <dt className="text-muted">{t('media.details.added')}</dt>
        <dd className="text-text">
          <time dateTime={row.createdAt}>{formatDate(row.createdAt, locale)}</time>
        </dd>
      </dl>
      <a href={row.originalUrl} target="_blank" rel="noopener noreferrer" className="inline-flex w-fit items-center gap-1.5 text-sm text-text underline underline-offset-2 hover:text-muted">
        <ExternalLink aria-hidden className="size-3.5" />
        {t('media.details.open')}
      </a>

      {editable ? (
        <form
          key={`${row.id}:${row.version}`}
          noValidate
          className="flex flex-col gap-3 border-t border-line pt-4"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          {LOCALES.map((language) => (
            <Field key={language} label={t('media.details.alt', { language: t(`menus.language.${language}`) })} error={errors[`alt.${language}`]}>
              <Input
                dir={language === 'en' ? 'ltr' : 'rtl'}
                lang={language}
                value={alt[language] ?? ''}
                maxLength={250}
                onChange={(event) => setAlt((current) => ({ ...current, [language]: event.target.value }))}
              />
            </Field>
          ))}
          <Field label={t('media.details.folder')} error={errors.folder}>
            <Input value={folder} maxLength={60} list={foldersId} onChange={(event) => setFolder(event.target.value)} />
          </Field>
          <datalist id={foldersId}>
            {folders.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          <Field label={t('media.details.tags')} hint={t('media.details.tagsHint')} error={errors.tags}>
            <Input value={tags} onChange={(event) => setTags(event.target.value)} />
          </Field>
          <div className="flex items-center gap-2">
            <Button type="submit" variant="primary" pending={saving}>
              {t('media.details.save')}
            </Button>
            <Button variant="ghost" icon={<Trash2 aria-hidden />} className="ms-auto text-danger" onClick={() => setConfirm(true)}>
              {t('media.details.delete')}
            </Button>
          </div>
        </form>
      ) : (
        <p className="border-t border-line pt-4 text-sm text-muted">{t('media.details.readOnly')}</p>
      )}

      {usage && (
        <div className="flex flex-col gap-2 border-t border-line pt-4">
          <h3 className="text-sm font-medium text-text">{t('media.details.usedIn')}</h3>
          {uses === 0 ? (
            <p className="text-sm text-muted">{t('media.details.unused')}</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {usage.drafts.map((use, index) => {
                const text = `${use.menuName} · ${use.where === 'product' ? use.label : t(`media.usage.${use.where}`)}`;
                // A restaurant's logo belongs to the restaurant, not to a menu.
                const href = use.where === 'restaurant' ? (restaurantId ? `/studio/restaurants/${restaurantId}` : null) : `/studio/menus/${use.menuId}`;
                return (
                  <li key={`d${index}`} dir="auto">
                    {href ? (
                      <Link href={href} className="text-text underline-offset-2 hover:underline">
                        {text}
                      </Link>
                    ) : (
                      <span className="text-text">{text}</span>
                    )}
                  </li>
                );
              })}
              {usage.revisions.map((use, index) => (
                <li key={`r${index}`} className="text-muted" dir="auto">
                  {t('media.usage.revision', { menu: use.menuName, number: number.format(use.number) })}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t('media.details.deleteTitle')}
        body={t('media.details.deleteBody')}
        confirmLabel={t('media.details.deleteConfirm')}
        onConfirm={async () => {
          const result = shared ? await deleteSharedAsset({ assetId: row.id }) : await deleteAsset({ restaurantId, assetId: row.id });
          if (!result.ok) return refuse(result);
          toast.success(t('media.details.deleted'));
          onDeleted();
          router.refresh();
          return true;
        }}
      />
    </section>
  );
}
