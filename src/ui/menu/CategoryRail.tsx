'use client';

import { useApp } from '@/ui/AppProviders';

export function CategoryRail({
  categories,
  activeId,
}: {
  categories: Array<{ id: string; slug: string; name: string }>;
  activeId: string | null;
}) {
  const { t } = useApp();
  return (
    <nav
      aria-label={t('menu.categories')}
      className="scroll-hidden sticky top-0 z-10 flex gap-1 overflow-x-auto border-b border-line bg-bg px-3"
    >
      {categories.map((category) => (
        <a
          key={category.id}
          href={`#cat-${category.slug}`}
          aria-current={category.id === activeId ? 'true' : undefined}
          className={`grid min-h-12 shrink-0 place-items-center border-b-2 px-3 text-sm transition-colors ${
            category.id === activeId ? 'border-accent text-text' : 'border-transparent text-muted hover:text-text'
          }`}
        >
          {category.name}
        </a>
      ))}
    </nav>
  );
}
