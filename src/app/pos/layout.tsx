import '@/studio/studio.css';
import './till.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { direction } from '@/lib/locale';
import { studioFontVariables } from '@/studio/fonts';
import { StudioI18nProvider } from '@/studio/i18n';
import { clientMessages } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { Toaster } from '@/studio/ui/Toaster';
import { SyncProvider } from './_ui/sync/SyncProvider';

export const metadata: Metadata = {
  title: { default: 'Buzzify Cashier', template: '%s · Buzzify Cashier' },
  robots: { index: false, follow: false },
};

/**
 * The till's root layout. It is the Studio's document (same stylesheet, fonts, language and direction from the person's
 * setting) because one account and one sign-in serve both areas; only the shell inside it differs.
 */
export default async function PosRootLayout({ children }: { children: ReactNode }) {
  const locale = await requestStudioLocale();
  return (
    <html lang={locale} dir={direction(locale)} className={studioFontVariables(locale)}>
      <body>
        <StudioI18nProvider locale={locale} messages={clientMessages(locale)}>
          <SyncProvider>{children}</SyncProvider>
          <Toaster />
        </StudioI18nProvider>
      </body>
    </html>
  );
}
