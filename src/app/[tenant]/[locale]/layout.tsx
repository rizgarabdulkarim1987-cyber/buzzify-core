import '@/app/globals.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { fontVariablesFor } from '@/app/fonts';
import { direction, isLocale } from '@/lib/locale';
import { hostEnv } from '@/server/env';
import { resolvePublicRoute } from '@/server/public-page';
import { menuCanonical, menuOpenGraph } from '@/server/seo';
import { AppProviders } from '@/ui/AppProviders';
import { brandCss } from '@/ui/brand';

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
  const openGraph = menuOpenGraph(hostEnv().publicOrigin, seo);
  return {
    title: { default: seo?.title || tenant.name, template: `%s | ${tenant.name}` },
    ...(seo?.description ? { description: seo.description } : {}),
    icons: { icon: iconFor(tenant.brand) },
    // Every page canonicalizes to the menu's home; the home and product pages add their translations themselves.
    alternates: menuCanonical(hostEnv().publicOrigin, tenant, locale),
    // The search image of the page's language, for link previews; a generated one comes with the brand kit.
    ...(openGraph ? { openGraph } : {}),
  };
}

/**
 * A small accent-coloured mark in the restaurant's own colour, as a data URI. Without any icon link a browser
 * asks the server for /favicon.ico, which is a 404 and a wasted connection while the page is loading.
 */
function iconFor(brand: { theme: 'dark' | 'light'; tokens: Record<'dark' | 'light', { accent: string }> }): string {
  const accent = brand.tokens[brand.theme].accent;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="12" fill="${accent}"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
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
    <html lang={locale} dir={direction(locale)} data-theme={tenant.brand.theme} className={fontVariablesFor(locale)}>
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
