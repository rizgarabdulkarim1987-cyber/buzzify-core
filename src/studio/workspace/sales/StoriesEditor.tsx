'use client';

import { ImageIcon, Plus } from 'lucide-react';
import { useState } from 'react';
import { deleteStory, saveStory } from '@/app/studio/_actions/stories';
import type { Locale } from '@/lib/locale';
import { DEFAULT_STORY_HOURS, STORY_HOURS } from '@/server/domain/stories';
import type { StoriesStudioView, StoryStudioRow } from '@/server/studio/services/stories-view';
import { formatDateTime } from '@/studio/format';
import { useLocale, useT } from '@/studio/i18n';
import { MediaPicker } from '@/studio/media/MediaPicker';
import { Button } from '@/studio/ui/Button';
import { ConfirmDialog } from '@/studio/ui/ConfirmDialog';
import { Dialog } from '@/studio/ui/Dialog';
import { EmptyState } from '@/studio/ui/EmptyState';
import { Field } from '@/studio/ui/Field';
import { Select } from '@/studio/ui/Select';
import { Switch } from '@/studio/ui/Switch';
import type { Names } from '../content/shared';
import { TranslationFields } from '../content/TranslationFields';
import { Locked, PageIntro, RuleList, RuleRow, useSave } from './shared';

interface Draft {
  storyId?: string;
  assetId: string;
  thumb: string | null;
  productId: string;
  captions: Names;
  /** '' keeps the current end time of a story being edited; a number of hours starts the clock again. */
  hours: string;
  isActive: boolean;
}

const blank = (): Draft => ({ assetId: '', thumb: null, productId: '', captions: {}, hours: String(DEFAULT_STORY_HOURS), isActive: true });

/**
 * The Stories page (plan feature `guest.stories`): pictures from the library with a caption, shown in a row at the top
 * of the guest menu until they end. They show within a minute of saving, with no publish.
 */
export function StoriesEditor({ menuId, view, canEdit }: { menuId: string; view: StoriesStudioView; canEdit: boolean }) {
  const t = useT();
  const { locale } = useLocale();
  const { pending, errors, setErrors, save } = useSave();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [picking, setPicking] = useState(false);
  const [deleting, setDeleting] = useState<StoryStudioRow | null>(null);
  // Without the plan the stories stay readable and can still be deleted, but nothing new can be made.
  const allowed = view.upgrade.allowed.includes('guest.stories');
  const readOnly = !canEdit || !allowed;
  const locales = view.locales as Locale[];
  const change = (patch: Partial<Draft>) => setDraft((current) => (current ? { ...current, ...patch } : current));
  const open = (next: Draft) => {
    setErrors({});
    setDraft(next);
  };
  const label = (story: StoryStudioRow) => story.captions[locale] || story.captions[view.defaultLocale] || Object.values(story.captions)[0] || t('stories.untitled');

  const submit = () => {
    if (!draft) return;
    const { storyId, assetId, productId, captions, hours, isActive } = draft;
    void save(
      () =>
        saveStory({
          menuId,
          ...(storyId ? { storyId } : {}),
          assetId,
          productId: productId || null,
          captions,
          ...(hours ? { hours: Number(hours) } : {}),
          isActive,
        }),
      () => setDraft(null),
    );
  };

  const hoursOptions = [...(draft?.storyId ? [{ value: '', label: t('stories.hours.keep') }] : []), ...STORY_HOURS.map((hours) => ({ value: String(hours), label: t(`stories.hours.${hours}`) }))];

  return (
    <div className="flex flex-col gap-6">
      <PageIntro
        title={t('stories.title')}
        body={t('stories.intro')}
        action={
          !readOnly && (
            <Button size="sm" variant="secondary" icon={<Plus aria-hidden />} onClick={() => open(blank())}>
              {t('stories.add')}
            </Button>
          )
        }
      />
      <Locked feature="guest.stories" upgrade={view.upgrade} />

      {view.stories.length === 0 ? (
        <EmptyState icon={<ImageIcon aria-hidden />} title={t('stories.empty')} />
      ) : (
        <RuleList label={t('stories.title')}>
          {view.stories.map((story) => (
            <RuleRow
              key={story.id}
              title={label(story)}
              details={t(story.ended ? 'stories.endedAt' : 'stories.endsAt', { when: formatDateTime(story.expiresAt, locale) })}
              isActive={story.isActive}
              stateLabel={story.ended ? t('stories.ended') : undefined}
              editLabel={t('stories.editOne', { name: label(story) })}
              deleteLabel={t('stories.deleteOne', { name: label(story) })}
              onEdit={() => open({ storyId: story.id, assetId: story.assetId, thumb: story.thumb, productId: story.productId ?? '', captions: story.captions, hours: '', isActive: story.isActive })}
              onDelete={() => setDeleting(story)}
              readOnly={!canEdit}
              extra={story.thumb ? <img src={story.thumb} alt="" className="size-10 rounded-full object-cover" /> : undefined}
            />
          ))}
        </RuleList>
      )}

      <Dialog
        open={draft !== null}
        onOpenChange={(next) => !next && setDraft(null)}
        title={draft?.storyId ? t('stories.editTitle') : t('stories.addTitle')}
        width="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDraft(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" onClick={submit} disabled={pending || !draft?.assetId || !allowed}>
              {pending ? t('common.saving') : t('common.save')}
            </Button>
          </>
        }
      >
        {draft && (
          <div className="flex flex-col gap-4">
            <Field label={t('stories.picture')} error={errors.assetId}>
              <div className="flex items-center gap-3">
                {draft.thumb ? <img src={draft.thumb} alt="" className="size-16 rounded-lg object-cover" /> : null}
                <Button variant="secondary" onClick={() => setPicking(true)}>
                  {draft.assetId ? t('stories.changePicture') : t('stories.choosePicture')}
                </Button>
              </div>
            </Field>
            <TranslationFields label={t('stories.caption')} locales={locales} values={draft.captions} maxLength={140} onChange={(captions) => change({ captions })} />
            <Field label={t('stories.dish')} optional error={errors.productId}>
              <Select
                options={[{ value: '', label: t('stories.noDish') }, ...view.products.map((product) => ({ value: product.id, label: product.name }))]}
                value={draft.productId}
                onChange={(event) => change({ productId: event.target.value })}
              />
            </Field>
            <Field label={t('stories.runFor')}>
              <Select options={hoursOptions} value={draft.hours} onChange={(event) => change({ hours: event.target.value })} />
            </Field>
            <label className="flex items-center justify-between gap-4">
              <span className="text-sm text-text">{t('sales.active')}</span>
              <Switch aria-label={t('sales.active')} checked={draft.isActive} onCheckedChange={(isActive) => change({ isActive })} />
            </label>
          </div>
        )}
      </Dialog>

      <MediaPicker open={picking} onOpenChange={setPicking} restaurantId={view.restaurantId} onPick={([first]) => first && change({ assetId: first.assetId, thumb: first.thumbUrl })} />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(next) => !next && setDeleting(null)}
        title={t('stories.deleteTitle')}
        body={deleting ? t('stories.deleteBody', { name: label(deleting) }) : undefined}
        confirmLabel={t('sales.delete')}
        onConfirm={async () => {
          if (!deleting) return true;
          const ok = await save(() => deleteStory({ menuId, storyId: deleting.id }), () => setDeleting(null), t('sales.deleted'));
          return ok ? true : { message: t('sales.deleteFailed') };
        }}
      />
    </div>
  );
}
