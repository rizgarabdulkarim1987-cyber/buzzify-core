'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { duplicateMenu } from '@/app/studio/_actions/menus';
import { SLUG_MAX, suggestSlug } from '@/server/domain/slug';
import { useT } from '@/studio/i18n';
import { useRefuse } from '@/studio/refuse';
import { ConfirmDialog } from '@/studio/ui/ConfirmDialog';
import { Field } from '@/studio/ui/Field';
import { Input } from '@/studio/ui/Input';
import { isolated } from '@/studio/ui/isolate';
import { Select } from '@/studio/ui/Select';
import { SlugField } from './SlugField';

export interface DuplicateTarget {
  id: string;
  name: string;
}

export interface DuplicateDialogProps {
  menuId: string;
  name: string;
  slug: string;
  /** The menu's own restaurant, where the copy goes unless another is chosen. */
  restaurantId: string;
  /** Every restaurant, for a Super Admin, who may copy into any of them; empty for everyone else. */
  targets: readonly DuplicateTarget[];
  origin: string;
  onClose: () => void;
}

/**
 * A copy of a menu as a new draft: its name and address (suggested from the original's, the address following the name
 * until the person edits it), and for a Super Admin the restaurant it goes to. It says what is not copied. Mounted only
 * while open, so each opening starts from the suggestions.
 */
export function DuplicateDialog({ menuId, name, slug, restaurantId, targets, origin, onClose }: DuplicateDialogProps) {
  const t = useT();
  const router = useRouter();
  const refuse = useRefuse();
  const fallback = `${slug}-copy`.slice(0, SLUG_MAX).replace(/-+$/, '');
  const [copyName, setCopyName] = useState(() => t('menus.duplicate.copyName', { name }));
  const [copySlug, setCopySlug] = useState(fallback);
  const [slugEdited, setSlugEdited] = useState(false);
  const [target, setTarget] = useState(restaurantId);

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={isolated(t('menus.duplicate.title'), { name })}
      body={t('menus.duplicate.body')}
      confirmLabel={t('menus.duplicate.confirm')}
      tone="primary"
      onConfirm={async () => {
        const result = await duplicateMenu({
          menuId,
          name: copyName,
          slug: copySlug,
          ...(target !== restaurantId ? { targetRestaurantId: target } : {}),
        });
        if (!result.ok) return refuse(result, ['name', 'slug']);
        toast.success(t('menus.duplicate.done'));
        router.push(`/studio/menus/${result.data.menuId}`);
        return true;
      }}
    >
      {(errors) => (
        <>
          <Field label={t('menus.duplicate.name')} error={errors.name}>
            <Input
              name="name"
              autoComplete="off"
              value={copyName}
              maxLength={200}
              onChange={(event) => {
                setCopyName(event.target.value);
                if (!slugEdited) setCopySlug(suggestSlug(event.target.value, fallback));
              }}
            />
          </Field>
          <SlugField
            value={copySlug}
            origin={origin}
            error={errors.slug}
            onChange={(value) => {
              setSlugEdited(true);
              setCopySlug(value);
            }}
          />
          {targets.length > 1 && (
            <Field label={t('menus.duplicate.restaurant')}>
              <Select value={target} onChange={(event) => setTarget(event.target.value)} options={targets.map((option) => ({ value: option.id, label: option.name }))} />
            </Field>
          )}
        </>
      )}
    </ConfirmDialog>
  );
}
