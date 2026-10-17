'use client';

import { useApp } from '@/ui/AppProviders';
import { LanguageSwitch } from '@/ui/LanguageSwitch';
import { ModeSwitch } from './ModeSwitch';

export function Header({ current = 'menu', overlay = false }: { current?: 'menu' | 'explore'; overlay?: boolean }) {
  const { tenant, table, t, href } = useApp();
  return (
    <header
      className={`flex flex-col px-5 pt-5 pb-1 ${
        overlay ? 'bg-gradient-to-b from-bg via-bg/70 to-transparent pb-6' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-[1.65rem] tracking-[0.16em] text-text">
            <a href={href()} data-testid="brand" className="flex min-h-11 items-center">
              {tenant.logo ? (
                // The brand's own logo, named by its text; a library file already sized for the screen.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={tenant.logo.url}
                  alt={tenant.logoText}
                  width={tenant.logo.width}
                  height={tenant.logo.height}
                  className="h-10 w-auto max-w-[14rem] object-contain object-left rtl:object-right"
                />
              ) : (
                tenant.logoText
              )}
            </a>
          </h1>
          {table !== null && (
            <p className="mt-0.5 text-sm text-accent">{t('menu.table', { number: String(table).padStart(2, '0') })}</p>
          )}
        </div>
        <LanguageSwitch />
      </div>
      <ModeSwitch current={current} />
    </header>
  );
}
