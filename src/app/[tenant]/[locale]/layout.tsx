import '@/app/globals.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { fontVariablesFor } from '@/app/fonts';
import { direction, isLocale } from '@/lib/locale';
import { resolveRoute } from '@/server/route-context';
import { AppProviders } from '@/ui/AppProviders';
import { brandCss } from '@/ui/brand';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ tenant: string; locale: string }>;
}): Promise<Metadata> {
  const route = await resolveRoute(await params);
  if (!route) return { title: 'Not found' };
  const name = route.tenant.name;
  return { title: { default: name, template: `%s | ${name}` }, icons: { icon: iconFor(route.tenant.brand) } };
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
  const route = await resolveRoute(raw);

  // Unknown tenant or locale: render a bare shell so the page can call notFound() with a real 404.
  if (!route) {
    return (
      <html lang={isLocale(raw.locale) ? raw.locale : 'en'} className={fontVariablesFor(null)}>
        <body>{children}</body>
      </html>
    );
  }

  const { tenant, locale } = route;
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
