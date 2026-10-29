'use client';

import { ExternalLink } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type ReactNode } from 'react';
import { toast } from 'sonner';
import { saveMenuIntro, setMenuIntroEnabled } from '@/app/studio/_actions/intro';
import { describeFailure } from '@/studio/errors';
import { useLocale, useT } from '@/studio/i18n';
import { MediaPicker } from '@/studio/media/MediaPicker';
import { PICTURE_ACCEPT } from '@/studio/media/upload';
import { UploadAsset } from './UploadAsset';
import { Alert } from '@/studio/ui/Alert';
import { Button, buttonClasses } from '@/studio/ui/Button';
import { UpgradeHint } from '@/studio/plans/UpgradeHint';
import type { UpgradeInfo } from '@/server/studio/services/plans';
import { Checkbox } from '@/studio/ui/Checkbox';

export interface MenuIntroView {
  thumbs: Record<string, string>;
  plan: { allowed: boolean; upgrade: UpgradeInfo };
  enabled: boolean;
  locales: string[];
  defaultLocale: string;
  intro: { backgroundAssetId: string | null; overlay: number; showLogo: boolean; showContact: boolean };
  platformAdverts: Array<{ id: string; imageAssetId: string; alts: unknown; href: string; active: boolean }>;
}

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

const altOf = (alts: unknown, locale: string) => {
  const map = typeof alts === 'object' && alts !== null ? (alts as Record<string, unknown>) : {};
  for (const code of [locale, 'en', 'ar', 'ckb']) if (typeof map[code] === 'string' && map[code]) return map[code] as string;
  return '';
};

/**
 * The Intro tab: the page guests see before the menu. The owner turns it on, picks a background (a picture or a video), how dark it is, and
 * whether the logo and contacts show. The adverts on it belong to Buzzify and are shown here for information only.
 */
export function IntroForm({ menuId, restaurantId, view, slug }: { menuId: string; restaurantId: string; view: MenuIntroView; slug: string }) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const [picking, setPicking] = useState(false);
  const [background, setBackground] = useState<{ assetId: string | null; thumb: string }>({
    assetId: view.intro.backgroundAssetId,
    thumb: view.intro.backgroundAssetId ? (view.thumbs[view.intro.backgroundAssetId] ?? '') : '',
  });
  const [overlay, setOverlay] = useState(view.intro.overlay);
  const [showLogo, setShowLogo] = useState(view.intro.showLogo);
  const [showContact, setShowContact] = useState(view.intro.showContact);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const [switching, startSwitching] = useTransition();

  const toggle = (enabled: boolean) =>
    startSwitching(async () => {
      const result = await setMenuIntroEnabled({ menuId, enabled });
      if (!result.ok) return setProblem(describeFailure(t, locale, result.error).message);
      setProblem(null);
      router.refresh();
    });

  const save = () =>
    startSaving(async () => {
      const result = await saveMenuIntro({ menuId, backgroundAssetId: background.assetId, overlay, showLogo, showContact });
      if (!result.ok) return setProblem(describeFailure(t, locale, result.error).message);
      setProblem(null);
      toast.success(t('introPage.saved'));
      router.refresh();
    });

  return (
    <div className="flex max-w-6xl flex-col px-8 pb-10 pt-6">
      <p className="max-w-[65ch] pb-4 text-sm text-muted">{t('introPage.intro')}</p>
      {problem && <Alert tone="danger">{problem}</Alert>}
      <Section id="intro-switch" title={t('workspace.tab.intro')} intro={t('introPage.showHelp')}>
        {!view.plan.allowed && <UpgradeHint feature="menu.intro" info={view.plan.upgrade} />}
        <Alert tone={view.enabled && view.plan.allowed ? 'success' : 'neutral'}>
          {view.enabled && view.plan.allowed ? t('introPage.statusOn') : t('introPage.statusOff')}
        </Alert>
        <div className="flex flex-wrap items-center gap-4">
          <Checkbox label={t('introPage.show')} checked={view.enabled} disabled={switching || !view.plan.allowed} onChange={(event) => toggle(event.target.checked)} />
          {view.enabled && (
            <a href={`/${slug}/intro`} target="_blank" rel="noopener noreferrer" className={buttonClasses('secondary', 'sm')}>
              <ExternalLink aria-hidden />
              {t('introPage.open')}
            </a>
          )}
        </div>
      </Section>

      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
        className="flex flex-col"
      >
        <Section id="intro-look" title={t('introPage.lookTitle')} intro={t('introPage.lookIntro')}>
          <div className="flex flex-wrap items-center gap-4">
            {background.thumb ? (
              // eslint-disable-next-line @next/next/no-img-element -- a small library picture
              <img src={background.thumb} alt={t('introPage.background')} className="h-16 w-24 rounded-md border border-line object-cover" />
            ) : (
              <span aria-hidden className="block h-16 w-24 rounded-md border border-dashed border-line" />
            )}
            <Button onClick={() => setPicking(true)}>{t('introPage.pick')}</Button>
            <UploadAsset target={{ restaurantId }} accept={PICTURE_ACCEPT + ',video/mp4,.mp4'} folder="intro" label={t('introPage.upload')} onUploaded={(picked) => setBackground({ assetId: picked.assetId, thumb: picked.thumbUrl })} />
            {background.assetId && !background.thumb && <span className="text-sm text-muted">{t('introPage.fileChosen')}</span>}
            {background.assetId && (
              <Button variant="ghost" onClick={() => setBackground({ assetId: null, thumb: '' })}>
                {t('introPage.clear')}
              </Button>
            )}
          </div>
          <MediaPicker open={picking} onOpenChange={setPicking} restaurantId={restaurantId} kinds="all" onPick={([first]) => first && setBackground({ assetId: first.assetId, thumb: first.thumbUrl })} />
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-text">{t('introPage.overlay', { value: overlay })}</span>
            <input type="range" min={0} max={100} step={5} value={overlay} onChange={(event) => setOverlay(Number(event.target.value))} className="w-full max-w-sm" />
            <span className="text-sm text-muted">{t('introPage.overlayHelp')}</span>
          </label>
          <Checkbox label={t('introPage.showLogo')} checked={showLogo} onChange={(event) => setShowLogo(event.target.checked)} />
          <Checkbox label={t('introPage.showContact')} checked={showContact} onChange={(event) => setShowContact(event.target.checked)} />
        </Section>

        <Section id="intro-adverts" title={t('introPage.advertsTitle')} intro={t('introPage.advertsHelp')}>
          {view.platformAdverts.length === 0 ? (
            <p className="text-sm text-muted">{t('introPage.noAdverts')}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {view.platformAdverts.map((advert) => (
                <li key={advert.id} className="flex items-center gap-3 rounded-md border border-line p-2">
                  {view.thumbs[advert.imageAssetId] ? (
                    // eslint-disable-next-line @next/next/no-img-element -- a small library picture
                    <img src={view.thumbs[advert.imageAssetId]} alt="" className="h-12 w-20 rounded-sm object-cover" />
                  ) : (
                    <span aria-hidden className="block h-12 w-20 rounded-sm border border-dashed border-line" />
                  )}
                  <span className="truncate text-sm text-text">{altOf(advert.alts, locale) || advert.href || t('platformIntro.untitled')}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <div className="border-t border-line pt-6">
          <Button type="submit" variant="primary" disabled={saving}>
            {t('introPage.save')}
          </Button>
        </div>
      </form>
    </div>
  );
}
