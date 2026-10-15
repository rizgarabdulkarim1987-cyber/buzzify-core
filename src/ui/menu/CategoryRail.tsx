'use client';

import { motion } from 'motion/react';
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
      className="scroll-hidden sticky top-0 z-10 flex gap-1 overflow-x-auto border-b border-line bg-bg/90 px-3 backdrop-blur-md"
    >
      {categories.map((category) => {
        const active = category.id === activeId;
        return (
          <a
            key={category.id}
            href={`#cat-${category.slug}`}
            aria-current={active ? 'true' : undefined}
            className={`relative grid min-h-12 shrink-0 place-items-center px-3.5 text-[0.9375rem] transition-colors duration-150 ${
              active ? 'text-text' : 'text-muted [@media(hover:hover)]:hover:text-text'
            }`}
          >
            {category.name}
            {active && (
              <motion.span
                layoutId="rail-indicator"
                data-rail-indicator
                aria-hidden="true"
                className="absolute inset-x-3.5 bottom-0 h-0.5 rounded-full bg-accent"
                transition={{ type: 'spring', duration: 0.35, bounce: 0.08 }}
              />
            )}
          </a>
        );
      })}
    </nav>
  );
}
