import '@/app/globals.css';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import { fontVariablesFor } from '@/app/fonts';
import { guestFontPair, guestTheme } from '@/lib/guest-brand';
import { direction } from '@/lib/locale';
import { resolvePublicIntro } from '@/server/public-page';
import { brandCss } from '@/ui/brand';

export async function generateMetadata({ params }: { params: Promise<{ tenant: string }> }): Promise<Metadata> {
  const resolved = await resolvePublicIntro((await params).tenant, (await headers()).get('accept-language'));
  if (resolved.kind === 'live') return { title: resolved.route.tenant.name, robots: { index: false } };
  if (resolved.kind === 'unavailable') return { title: resolved.name, robots: { index: false } };
  return { title: 'Not found', robots: { index: false } };
}

/** The intro sits outside `[locale]`, so it has its own document: the restaurant's colours and fonts, in the language the browser asks for. */
export default async function IntroLayout({ children, params }: { children: ReactNode; params: Promise<{ tenant: string }> }) {
  const resolved = await resolvePublicIntro((await params).tenant, (await headers()).get('accept-language'));

  if (resolved.kind === 'live') {
    const { tenant, locale } = resolved.route;
    return (
      <html lang={locale} dir={direction(locale)} data-theme={guestTheme(tenant.brand)} className={fontVariablesFor(locale, guestFontPair(tenant.brand))}>
        <head>
          <style dangerouslySetInnerHTML={{ __html: brandCss(tenant.brand) }} />
        </head>
        <body className="bg-bg font-sans text-text antialiased">{children}</body>
      </html>
    );
  }
  if (resolved.kind === 'unavailable') {
    return (
      <html lang={resolved.locale} dir={direction(resolved.locale)} className={fontVariablesFor(resolved.locale)}>
        <body className="bg-bg font-sans text-text antialiased">{children}</body>
      </html>
    );
  }
  return (
    <html lang="en" className={fontVariablesFor(null)}>
      <body>{children}</body>
    </html>
  );
}
