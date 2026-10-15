import '@/app/globals.css';
import type { ReactNode } from 'react';
import { fontVariables } from '@/app/fonts';
import { direction, isLocale } from '@/lib/locale';
import { resolveRoute } from '@/server/route-context';
import { AppProviders } from '@/ui/AppProviders';
import { brandCss } from '@/ui/brand';

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
      <html lang={isLocale(raw.locale) ? raw.locale : 'en'} className={fontVariables}>
        <body>{children}</body>
      </html>
    );
  }

  const { tenant, locale } = route;
  return (
    <html lang={locale} dir={direction(locale)} data-theme={tenant.brand.theme} className={fontVariables}>
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
