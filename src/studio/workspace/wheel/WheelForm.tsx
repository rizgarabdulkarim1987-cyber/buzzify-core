'use client';

import { ExternalLink } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type ReactNode } from 'react';
import { toast } from 'sonner';
import { saveWheel, setMenuWheelEnabled } from '@/app/studio/_actions/wheel';
import { utcToZonedLocal, zonedLocalToUtc } from '@/server/domain/schedule-time';
import type { LocaleTexts } from '@/server/studio/services/about';
import type { WheelStudioView } from '@/server/studio/services/wheel';
import type { WheelSliceView } from '@/server/data/wheel';
import { describeFailure } from '@/studio/errors';
import { useLocale, useT } from '@/studio/i18n';
import { Alert } from '@/studio/ui/Alert';
import { Button, buttonClasses } from '@/studio/ui/Button';
import { Checkbox } from '@/studio/ui/Checkbox';
import { Field } from '@/studio/ui/Field';
import { Input } from '@/studio/ui/Input';
import { WheelDisc } from '@/ui/wheel/WheelDisc';
import { isRtl } from '../content/shared';
import { SlicePicker, type SliceDraft } from './SlicePicker';

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

const dayOf = (iso: string | null, zone: string) => (iso ? utcToZonedLocal(new Date(iso), zone).slice(0, 10) : '');

/**
 * The Wheel tab: whether guests see the wheel on the Explore page, its title in each language, spins a day and dates, and the dishes on it
 * with their weights. The wheel is read live by guests, so saving needs no publish (a dish's photo still comes with the menu's publish).
 */
export function WheelForm({ menuId, view }: { menuId: string; view: WheelStudioView }) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const [titles, setTitles] = useState<LocaleTexts>(view.title);
  const [spins, setSpins] = useState(String(view.spinsPerDay));
  const [starts, setStarts] = useState(dayOf(view.startsAt, view.timezone));
  const [ends, setEnds] = useState(dayOf(view.endsAt, view.timezone));
  const [slices, setSlices] = useState<SliceDraft[]>(view.slices.map((slice) => ({ productId: slice.productId, label: slice.label, weight: String(slice.weight) })));
  const [failure, setFailure] = useState<{ message: string; fields: Record<string, string> } | null>(null);
  const [switchProblem, setSwitchProblem] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const [switching, startSwitching] = useTransition();
  const errors = failure?.fields ?? {};

  const toggle = (enabled: boolean) =>
    startSwitching(async () => {
      const result = await setMenuWheelEnabled({ menuId, enabled });
      if (!result.ok) {
        const described = describeFailure(t, locale, result.error);
        return setSwitchProblem(Object.values(described.fields)[0] ?? described.message);
      }
      setSwitchProblem(null);
      router.refresh();
    });

  const save = () =>
    startSaving(async () => {
      // The dates are days in the menu's own time zone: the first minute of the first day and the last of the last.
      const result = await saveWheel({
        menuId,
        spinsPerDay: Number(spins),
        startsAt: starts ? zonedLocalToUtc(`${starts}T00:00`, view.timezone).toISOString() : null,
        endsAt: ends ? zonedLocalToUtc(`${ends}T23:59`, view.timezone).toISOString() : null,
        title: titles,
        slices: slices.map((slice) => ({ productId: slice.productId, label: slice.label, weight: Number(slice.weight) })),
      });
      if (!result.ok) {
        const described = describeFailure(t, locale, result.error);
        return setFailure({ message: described.message, fields: described.fields });
      }
      setFailure(null);
      toast.success(t('wheelPage.saved'));
      router.refresh();
    });

  const byId = new Map(view.candidates.map((candidate) => [candidate.id, candidate]));
  const preview: WheelSliceView[] = slices.flatMap((slice) => {
    const candidate = byId.get(slice.productId);
    return candidate?.thumb ? [{ productId: slice.productId, slug: '', price: 0, name: candidate.name, photo: { url: candidate.thumb, width: 320, height: 320 }, label: '' }] : [];
  });

  return (
    <div className="flex max-w-6xl flex-col px-8 pb-10 pt-6">
      <p className="max-w-[65ch] pb-4 text-sm text-muted">{t('wheelPage.intro')}</p>
      <Section id="wheel-switch" title={t('workspace.tab.wheel')} intro={t('wheelPage.showHelp')}>
        <div className="flex flex-wrap items-center gap-4">
          <Checkbox label={t('wheelPage.show')} checked={view.enabled} disabled={switching || !view.saved} onChange={(event) => toggle(event.target.checked)} />
          {view.enabled && (
            <a href={`/${view.slug}/${view.defaultLocale}/about`} target="_blank" rel="noopener noreferrer" className={buttonClasses('secondary', 'sm')}>
              <ExternalLink aria-hidden />
              {t('wheelPage.open')}
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
        <Section id="wheel-settings" title={t('wheelPage.settingsTitle')} intro={t('wheelPage.settingsIntro')}>
          {view.locales.map((code) => (
            <Field key={code} label={t('wheelPage.titleField', { language: t(`menus.language.${code}`) })} hint={t('wheelPage.titleHelp')}>
              <Input value={titles[code] ?? ''} maxLength={60} lang={code} dir={isRtl(code) ? 'rtl' : 'ltr'} onChange={(event) => setTitles((current) => ({ ...current, [code]: event.target.value }))} />
            </Field>
          ))}
          <Field label={t('wheelPage.spins')} hint={t('wheelPage.spinsHelp')} error={errors.spinsPerDay}>
            <Input type="number" inputMode="numeric" min={1} max={10} step={1} value={spins} onChange={(event) => setSpins(event.target.value)} className="w-28" />
          </Field>
          <div className="flex flex-wrap gap-4">
            <Field label={t('wheelPage.starts')}>
              <Input type="date" value={starts} onChange={(event) => setStarts(event.target.value)} />
            </Field>
            <Field label={t('wheelPage.ends')} error={errors.endsAt}>
              <Input type="date" value={ends} onChange={(event) => setEnds(event.target.value)} />
            </Field>
          </div>
          <p className="-mt-2 text-sm text-muted">{t('wheelPage.datesHelp', { zone: view.timezone })}</p>
        </Section>

        <Section id="wheel-slices" title={t('wheelPage.slicesTitle')} intro={t('wheelPage.slicesIntro')}>
          <SlicePicker slices={slices} candidates={view.candidates} locales={view.locales} onChange={setSlices} error={errors.slices} />
          {preview.length >= 4 && (
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-text">{t('wheelPage.preview')}</span>
              <div className="max-w-64">
                <WheelDisc slices={preview} rotation={0} spinning={false} reduced />
              </div>
            </div>
          )}
        </Section>

        <div className="border-t border-line pt-6">
          <Button type="submit" variant="primary" disabled={saving}>
            {t('wheelPage.save')}
          </Button>
        </div>
      </form>
    </div>
  );
}
