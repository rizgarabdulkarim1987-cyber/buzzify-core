import { salesSettings } from '@/server/domain/config';
import '@/app/globals.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { fontVariablesFor } from '@/app/fonts';
import { guestFontPair, guestTheme } from '@/lib/guest-brand';
import { direction } from '@/lib/locale';
import { AppProviders } from '@/ui/AppProviders';
import { brandCss, themeLogo } from '@/ui/brand';
import { loadPreview } from './load';

export async function generateMetadata({ params }: { params: Promise<{ menuId: string; locale: string }> }): Promise<Metadata> {
  const { menuId, locale } = await params;
  const { tenant } = await loadPreview(menuId, locale);
  return { title: tenant.name, robots: { index: false, follow: false } };
}

/**
 * The draft preview's own document (spec 10.4): a root layout of its own, so the menu is drawn with the public menu's
 * stylesheet, fonts and brand colours exactly as guests would get them, and none of the Studio's. The Studio shows it in
 * frames on the menu's Preview tab.
 */
export default async function PreviewRootLayout({ children, params }: { children: ReactNode; params: Promise<{ menuId: string; locale: string }> }) {
  const { menuId, locale: raw } = await params;
  const { locale, tenant } = await loadPreview(menuId, raw);
  return (
    <html lang={locale} dir={direction(locale)} data-theme={guestTheme(tenant.brand)} className={fontVariablesFor(locale, guestFontPair(tenant.brand))}>
      <head>
        <style dangerouslySetInnerHTML={{ __html: brandCss(tenant.brand) }} />
      </head>
      <body className="bg-bg font-sans text-text antialiased">
        <AppProviders
          preview
          locale={locale}
          tenant={{
            slug: tenant.slug,
            name: tenant.name,
            logoText: tenant.brand.logoText,
            logo: themeLogo(tenant.brand),
            railStyle: tenant.brand.railStyle,
            currency: tenant.currency,
            numeralSystem: tenant.numeralSystem,
            locales: tenant.locales,
            defaultLocale: tenant.defaultLocale,
            features: { explore: tenant.features.explore, stage: tenant.features.stage, rails: tenant.features.rails, livingPhotos: tenant.features.livingPhotos === true },
            priceStyle: salesSettings(tenant.engineConfig).priceStyle,
            feedback: false,
            extras: { about: false, wheel: false, aboutTitle: { en: '', ar: '', ckb: '' } },
          }}
        >
          {children}
        </AppProviders>
      </body>
    </html>
  );
}
