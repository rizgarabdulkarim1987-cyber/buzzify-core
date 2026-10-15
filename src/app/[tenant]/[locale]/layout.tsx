import '@/app/globals.css';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { direction, isLocale } from '@/lib/locale';

export default async function RootLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ tenant: string; locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return (
    <html lang={locale} dir={direction(locale)}>
      <body>{children}</body>
    </html>
  );
}
