import '@/studio/studio.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { direction } from '@/lib/locale';
import { studioFontVariables } from '@/studio/fonts';
import { StudioI18nProvider } from '@/studio/i18n';
import { clientMessages } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { Toaster } from '@/studio/ui/Toaster';

/** A black tile with the product's initial: drawn here, so a browser never asks the server for /favicon.ico. */
const ICON = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#000"/>' +
    '<path d="M11 8h6.2c3.1 0 5 1.5 5 4 0 1.6-.9 2.8-2.3 3.3 1.8.4 3 1.8 3 3.7 0 2.8-2.1 4.5-5.5 4.5H11V8Zm3.2 6.1h2.6c1.5 0 2.3-.6 2.3-1.8s-.8-1.7-2.3-1.7h-2.6v3.5Zm0 6.8h3c1.6 0 2.5-.7 2.5-2s-.9-2-2.5-2h-3v4Z" fill="#fff"/></svg>',
)}`;

export const metadata: Metadata = {
  title: { default: 'Buzzify Core', template: '%s · Buzzify Core' },
  robots: { index: false, follow: false },
  icons: { icon: ICON },
};

/**
 * The Studio's root layout, separate from the public menu's: its own stylesheet and fonts, and the document's language
 * and direction from the person's setting (or, signed out, the language switch's cookie and the browser's languages).
 */
export default async function StudioRootLayout({ children }: { children: ReactNode }) {
  const locale = await requestStudioLocale();
  return (
    <html lang={locale} dir={direction(locale)} className={studioFontVariables(locale)}>
      <body>
        <StudioI18nProvider locale={locale} messages={clientMessages(locale)}>
          {children}
          <Toaster />
        </StudioI18nProvider>
      </body>
    </html>
  );
}
