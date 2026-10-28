'use client';

import { ExternalLink, ImagePlus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type ReactNode } from 'react';
import { toast } from 'sonner';
import { saveAbout, setMenuAboutEnabled } from '@/app/studio/_actions/about';
import type { Locale } from '@/lib/locale';
import type { AboutStudioView, LocaleTexts } from '@/server/studio/services/about';
import { describeFailure } from '@/studio/errors';
import { useLocale, useT } from '@/studio/i18n';
import { MediaPicker } from '@/studio/media/MediaPicker';
import { Alert } from '@/studio/ui/Alert';
import { Button, buttonClasses } from '@/studio/ui/Button';
import { Checkbox } from '@/studio/ui/Checkbox';
import { Field } from '@/studio/ui/Field';
import { IconButton } from '@/studio/ui/IconButton';
import { Input } from '@/studio/ui/Input';
import { isRtl } from '../content/shared';
import { OfferList } from './OfferList';
import { fromDrafts, StoryEditor, toDrafts, type DraftBlock } from './StoryEditor';

function Section({ id, title, intro, children }: { id: string; title: string; intro?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="grid gap-x-12 gap-y-4 border-t border-line py-8 first:border-t-0 first:pt-2 xl:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
      <div className="flex flex-col gap-1">
        <h2 id={id} className="text-md font-semibold text-text">
          {title}
        </h2>
        {intro && <p className="text-sm text-muted">{intro}</p>}
      </div>
      <div className="flex min-w-0 max-w-2xl flex-col gap-4">{children}</div>
    </section>
  );
}

function Picture({ thumb, label }: { thumb: string | undefined; label: string }) {
  return thumb ? (
    // eslint-disable-next-line @next/next/no-img-element -- a library thumbnail
    <img src={thumb} alt={label} className="h-16 w-24 rounded-md border border-line object-cover" />
  ) : (
    <span className="flex h-16 w-24 items-center justify-center rounded-md border border-dashed border-line-strong text-xs text-muted">{label}</span>
  );
}

/**
 * The About tab: whether guests see the page, its title in each language, cover, story, gallery and the switches for the
 * profile's hours and contact, then the offers (each saved on its own). The page is read live by guests, so saving needs no publish.
 */
export function AboutForm({ menuId, view }: { menuId: string; view: AboutStudioView }) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const [titles, setTitles] = useState<LocaleTexts>(view.about.titles);
  const [cover, setCover] = useState<{ assetId: string; thumb: string | undefined } | null>(view.about.coverAssetId ? { assetId: view.about.coverAssetId, thumb: view.thumbs[view.about.coverAssetId] } : null);
  const [gallery, setGallery] = useState(view.about.galleryAssetIds.map((assetId) => ({ assetId, thumb: view.thumbs[assetId] })));
  const [showHours, setShowHours] = useState(view.about.showHours);
  const [showContact, setShowContact] = useState(view.about.showContact);
  const [stories, setStories] = useState<Partial<Record<Locale, DraftBlock[]>>>(() => Object.fromEntries(view.locales.map((code) => [code, toDrafts(view.about.story[code])])));
  const [picking, setPicking] = useState<'cover' | 'gallery' | null>(null);
  const [failure, setFailure] = useState<{ message: string; fields: Record<string, string> } | null>(null);
  const [switchProblem, setSwitchProblem] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const [switching, startSwitching] = useTransition();
  const errors = failure?.fields ?? {};

  const toggle = (enabled: boolean) =>
    startSwitching(async () => {
      const result = await setMenuAboutEnabled({ menuId, enabled });
      if (!result.ok) {
        const described = describeFailure(t, locale, result.error);
        return setSwitchProblem(Object.values(described.fields)[0] ?? described.message);
      }
      setSwitchProblem(null);
      router.refresh();
    });

  const save = () =>
    startSaving(async () => {
      const result = await saveAbout({
        menuId,
        titles,
        coverAssetId: cover?.assetId ?? null,
        story: Object.fromEntries(view.locales.map((code) => [code, fromDrafts(stories[code] ?? [])])),
        galleryAssetIds: gallery.map((entry) => entry.assetId),
        showHours,
        showContact,
      });
      if (!result.ok) {
        const described = describeFailure(t, locale, result.error);
        return setFailure({ message: described.message, fields: described.fields });
      }
      setFailure(null);
      toast.success(t('aboutPage.saved'));
      router.refresh();
    });

  return (
    <div className="flex max-w-6xl flex-col px-8 pb-10 pt-6">
      <p className="max-w-[65ch] pb-4 text-sm text-muted">{t('aboutPage.intro')}</p>
      <Section id="about-switch" title={t('workspace.tab.about')} intro={t('aboutPage.showHelp')}>
        <div className="flex flex-wrap items-center gap-4">
          <Checkbox label={t('aboutPage.show')} checked={view.enabled} disabled={switching} onChange={(event) => toggle(event.target.checked)} />
          {view.enabled && (
            <a href={`/${view.slug}/${view.defaultLocale}/about`} target="_blank" rel="noopener noreferrer" className={buttonClasses('secondary', 'sm')}>
              <ExternalLink aria-hidden />
              {t('aboutPage.open')}
            </a>
          )}
        </div>
        {switchProblem && <Alert tone="danger">{switchProblem}</Alert>}
      </Section>

      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
        className="flex flex-col"
      >
        {failure && Object.keys(errors).length === 0 && <Alert tone="danger">{failure.message}</Alert>}
        <Section id="about-page" title={t('aboutPage.pageTitle')} intro={t('aboutPage.pageIntro')}>
          {view.locales.map((code) => {
            const language = t(`menus.language.${code}`);
            return (
              <Field key={code} label={t('aboutPage.titleField', { language })} hint={t('aboutPage.titleHelp')} error={errors.titles}>
                <Input value={titles[code] ?? ''} maxLength={60} lang={code} dir={isRtl(code) ? 'rtl' : 'ltr'} onChange={(event) => setTitles((current) => ({ ...current, [code]: event.target.value }))} />
              </Field>
            );
          })}
          <div className="flex items-center gap-3">
            <Picture thumb={cover?.thumb} label={t('aboutPage.noPicture')} />
            <div className="flex flex-col gap-1">
              <span className="text-sm text-text">{t('aboutPage.cover')}</span>
              <div className="flex gap-1">
                <Button size="sm" icon={<ImagePlus aria-hidden />} onClick={() => setPicking('cover')}>
                  {t('aboutPage.choose')}
                </Button>
                {cover && <IconButton size="sm" icon={<Trash2 aria-hidden />} label={t('aboutPage.remove')} onClick={() => setCover(null)} />}
              </div>
              {errors.coverAssetId && <span className="text-sm text-danger">{errors.coverAssetId}</span>}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-text">{t('aboutPage.gallery')}</span>
            <ul className="flex flex-wrap gap-2">
              {gallery.map((entry, index) => (
                <li key={entry.assetId} className="relative">
                  <Picture thumb={entry.thumb} label={t('aboutPage.noPicture')} />
                  <IconButton
                    size="sm"
                    variant="secondary"
                    icon={<Trash2 aria-hidden />}
                    label={t('aboutPage.galleryRemove', { number: index + 1 })}
                    className="absolute end-1 top-1"
                    onClick={() => setGallery((current) => current.filter((one) => one.assetId !== entry.assetId))}
                  />
                </li>
              ))}
            </ul>
            <div>
              <Button size="sm" icon={<ImagePlus aria-hidden />} onClick={() => setPicking('gallery')} disabled={gallery.length >= 24}>
                {t('aboutPage.galleryAdd')}
              </Button>
            </div>
            {errors.galleryAssetIds && <span className="text-sm text-danger">{errors.galleryAssetIds}</span>}
          </div>
          <MediaPicker
            open={picking !== null}
            onOpenChange={(open) => !open && setPicking(null)}
            restaurantId={view.restaurantId}
            onPick={(items) => {
              if (picking === 'cover') {
                const first = items[0];
                if (first) setCover({ assetId: first.assetId, thumb: first.thumbUrl });
              } else {
                setGallery((current) => [...current, ...items.filter((item) => !current.some((one) => one.assetId === item.assetId)).map((item) => ({ assetId: item.assetId, thumb: item.thumbUrl }))].slice(0, 24));
              }
            }}
          />
          <Checkbox label={t('aboutPage.showHours')} checked={showHours} onChange={(event) => setShowHours(event.target.checked)} />
          <Checkbox label={t('aboutPage.showContact')} checked={showContact} onChange={(event) => setShowContact(event.target.checked)} />
          <p className="-mt-2 text-sm text-muted">{t('aboutPage.fromProfile')}</p>
        </Section>

        <Section id="about-story" title={t('aboutPage.storyTitle')} intro={t('aboutPage.storyIntro')}>
          {view.locales.map((code) => {
            const language = t(`menus.language.${code}`);
            return (
              <fieldset key={code} className="flex flex-col gap-3 rounded-md border border-line p-4">
                <legend className="px-1 text-sm font-medium text-text">{language}</legend>
                <StoryEditor
                  drafts={stories[code] ?? []}
                  onChange={(next) => setStories((current) => ({ ...current, [code]: next }))}
                  language={language}
                  lang={code}
                  rtl={isRtl(code)}
                  error={errors.story}
                />
              </fieldset>
            );
          })}
        </Section>

        <div className="border-t border-line pt-6">
          <Button type="submit" variant="primary" disabled={saving}>
            {t('aboutPage.save')}
          </Button>
        </div>
      </form>

      <Section id="about-offers" title={t('aboutPage.offersTitle')} intro={t('aboutPage.offersIntro')}>
        <OfferList menuId={menuId} view={view} />
      </Section>
    </div>
  );
}
