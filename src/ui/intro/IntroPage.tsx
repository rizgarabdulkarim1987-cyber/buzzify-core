import { direction, type Locale } from '@/lib/locale';
import { getTranslator } from '@/lib/messages';
import type { IntroView } from '@/server/data/intro';
import { AdvertSlider } from './AdvertSlider';
import { ContactIcons } from './ContactIcons';
import { IntroBackground } from './IntroBackground';
import { LanguageButtons } from './LanguageButtons';

/**
 * The page a guest sees before the menu: the restaurant's background, its name or logo, a language choice that leads straight to the menu,
 * the platform's adverts and the restaurant's contacts. Plain markup apart from the parts that need the browser (the video, the language
 * memory, the advert views), so the language links work without JavaScript. `search` is the visitor's query (a QR scan, a campaign): it goes on to the menu, and `table` is the table a table code was scanned at.
 */
export function IntroPage({ view, slug, name, locale, search = '', table = null }: { view: IntroView; slug: string; name: string; locale: Locale; search?: string; table?: string | null }) {
  const t = getTranslator(locale);
  const shade = view.overlay / 100;
  const top = (shade * 0.55).toFixed(2);
  return (
    <main dir={direction(locale)} className="relative isolate flex min-h-dvh flex-col overflow-hidden bg-black text-white">
      <IntroBackground background={view.background} />
      <div
        aria-hidden
        className="absolute inset-0 -z-10"
        style={{ background: `linear-gradient(to bottom, rgba(0,0,0,${top}) 0%, rgba(0,0,0,${shade}) 100%)` }}
      />
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center gap-8 px-6 pb-10 pt-14">
        <h1 className="flex min-h-16 items-center justify-center text-center text-4xl font-semibold [text-shadow:0_1px_12px_rgba(0,0,0,0.45)]">
          {view.logo ? (
            // eslint-disable-next-line @next/next/no-img-element -- the brand logo from the media library
            <img src={view.logo.url} width={view.logo.width} height={view.logo.height} alt={name} className="max-h-24 w-auto max-w-[70vw] object-contain" />
          ) : (
            <span className="break-words">{name}</span>
          )}
        </h1>

        <LanguageButtons slug={slug} search={search} table={table} locales={view.locales} enter={t('intro.enter')} label={t('intro.language')} />

        {view.adverts.length > 0 && <AdvertSlider slug={slug} adverts={view.adverts} label={t('intro.advert')} />}

        {view.contacts.length > 0 && (
          <ContactIcons
            contacts={view.contacts}
            labels={{
              instagram: t('intro.contact.instagram'),
              facebook: t('intro.contact.facebook'),
              tiktok: t('intro.contact.tiktok'),
              website: t('intro.contact.website'),
              map: t('intro.contact.map'),
              phone: t('intro.contact.phone'),
              whatsapp: t('intro.contact.whatsapp'),
            }}
          />
        )}
      </div>
    </main>
  );
}
