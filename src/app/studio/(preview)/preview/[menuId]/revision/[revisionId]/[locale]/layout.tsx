import { salesSettings } from '@/server/domain/config';
import '@/app/globals.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { fontVariablesFor } from '@/app/fonts';
import { guestFontPair, guestTheme } from '@/lib/guest-brand';
import { direction } from '@/lib/locale';
import { AppProviders } from '@/ui/AppProviders';
import { brandCss, themeLogo } from '@/ui/brand';
import { loadRevisionPreview } from './load';

type Params = { menuId: string; revisionId: string; locale: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { menuId, revisionId, locale } = await params;
  const { tenant, number } = await loadRevisionPreview(menuId, revisionId, locale);
  return { title: `${tenant.name} · ${number}`, robots: { index: false, follow: false } };
}

/**
 * A past revision's own document (spec 10.6, Revisions): the menu as it was published in that revision, with its own
 * brand and fonts, drawn by the public menu's code like the draft preview.
 */
export default async function RevisionPreviewLayout({ children, params }: { children: ReactNode; params: Promise<Params> }) {
  const { menuId, revisionId, locale: raw } = await params;
  const { locale, tenant, number } = await loadRevisionPreview(menuId, revisionId, raw);
  return (
    <html lang={locale} dir={direction(locale)} data-theme={guestTheme(tenant.brand)} className={fontVariablesFor(locale, guestFontPair(tenant.brand))}>
      <head>
        <style dangerouslySetInnerHTML={{ __html: brandCss(tenant.brand) }} />
      </head>
      <body className="bg-bg font-sans text-text antialiased">
        <AppProviders
          preview
          previewRevision={number}
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
            features: { explore: tenant.features.explore, stage: tenant.features.stage, rails: tenant.features.rails },
            priceStyle: salesSettings(tenant.engineConfig).priceStyle,
            feedback: false,
          }}
        >
          {children}
        </AppProviders>
      </body>
    </html>
  );
}
