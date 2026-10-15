'use client';

import { useApp } from '@/ui/AppProviders';

/** Two ways to browse the same menu. The cart is shared, so switching never loses an order. */
export function ModeSwitch({ current }: { current: 'menu' | 'explore' }) {
  const { t, href } = useApp();
  const item = (mode: 'menu' | 'explore', path: string, label: string) => (
    <a
      href={href(path)}
      aria-current={current === mode ? 'page' : undefined}
      className={`grid min-h-11 place-items-center px-0.5 pe-4 transition-colors duration-150 ${
        current === mode
          ? 'text-text underline decoration-accent decoration-2 underline-offset-[10px]'
          : 'text-muted [@media(hover:hover)]:hover:text-text'
      }`}
    >
      {label}
    </a>
  );
  return (
    <nav aria-label={t('mode.label')} className="flex items-center text-sm">
      {item('explore', '/explore', t('mode.explore'))}
      {item('menu', '', t('mode.menu'))}
    </nav>
  );
}
