import '@/app/globals.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { fontVariablesFor } from '@/app/fonts';
import { guestFontPair, guestPalette, guestTheme } from '@/lib/guest-brand';
import { direction, isLocale } from '@/lib/locale';
import type { BrandView } from '@/server/data/tenant';
import { hostEnv } from '@/server/env';
import { resolvePublicRoute } from '@/server/public-page';
import { menuCanonical, menuSocialImage } from '@/server/seo';
import { AppProviders } from '@/ui/AppProviders';
import { brandCss, themeLogo } from '@/ui/brand';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ tenant: string; locale: string }>;
}): Promise<Metadata> {
  const resolved = await resolvePublicRoute(await params);
  // A menu that is paused or missing (or has moved, and is about to redirect) stays out of search results.
  if (resolved.kind === 'unavailable') return { title: resolved.name, robots: { index: false } };
  if (resolved.kind !== 'live') return { title: 'Not found', robots: { index: false } };

  const { tenant, locale } = resolved.route;
  const seo = tenant.seo[locale];
  const openGraph = menuSocialImage(hostEnv().publicOrigin, tenant, locale);
  return {
    title: { default: seo?.title || tenant.name, template: `%s | ${tenant.name}` },
    ...(seo?.description ? { description: seo.description } : {}),
    icons: iconsFor(tenant.brand),
    // Every page canonicalizes to the menu's home; the home and product pages add their translations themselves.
    alternates: menuCanonical(hostEnv().publicOrigin, tenant, locale),
    // The search image of the page's language, or the logo drawn for link previews.
    ...(openGraph ? { openGraph } : {}),
  };
}

/**
 * A small accent-coloured mark in the restaurant's own colour, as a data URI. Without any icon link a browser
 * asks the server for /favicon.ico, which is a 404 and a wasted connection while the page is loading.
 */
function iconFor(brand: BrandView): string {
  const accent = guestPalette(brand).accent;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="12" fill="${accent}"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** The brand's favicon (a 32 px icon, and the 180 px one an iPhone keeps on its home screen), else the accent mark. */
function iconsFor(brand: BrandView): NonNullable<Metadata['icons']> {
  if (!brand.favicon) return { icon: iconFor(brand) };
  return {
    icon: [{ url: brand.favicon.png32, sizes: '32x32', type: 'image/png' }],
    apple: [{ url: brand.favicon.png180, sizes: '180x180', type: 'image/png' }],
  };
}

export default async function RootLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ tenant: string; locale: string }>;
}) {
  const raw = await params;
  const resolved = await resolvePublicRoute(raw);

  // A paused menu: the neutral page, in the visitor's language and the platform's own colours.
  if (resolved.kind === 'unavailable') {
    return (
      <html lang={resolved.locale} dir={direction(resolved.locale)} className={fontVariablesFor(resolved.locale)}>
        <body className="bg-bg font-sans text-text antialiased">{children}</body>
      </html>
    );
  }

  // Unknown menu or language, or a former slug: render a bare shell so the page can answer with a real 404 or redirect.
  if (resolved.kind !== 'live') {
    return (
      <html lang={isLocale(raw.locale) ? raw.locale : 'en'} className={fontVariablesFor(null)}>
        <body>{children}</body>
      </html>
    );
  }

  const { tenant, locale } = resolved.route;
  return (
    <html lang={locale} dir={direction(locale)} data-theme={guestTheme(tenant.brand)} className={fontVariablesFor(locale, guestFontPair(tenant.brand))}>
      <head>
        <style dangerouslySetInnerHTML={{ __html: brandCss(tenant.brand) }} />
      </head>
      <body className="bg-bg font-sans text-text antialiased">
        <AppProviders
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
          }}
        >
          {children}
        </AppProviders>
      </body>
    </html>
  );
}
