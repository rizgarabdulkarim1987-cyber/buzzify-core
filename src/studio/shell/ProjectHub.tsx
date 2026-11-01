import { Layers, Pill, ShoppingBag, UtensilsCrossed, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import type { Translate } from '@/lib/i18n';
import { SPACES, type Space } from '@/studio/spaces';

const ICONS: Record<Space['icon'], LucideIcon> = { food: UtensilsCrossed, pharmacy: Pill, retail: ShoppingBag, platform: Layers };

/**
 * A Super Admin's first screen: one large icon per project, in the middle of the screen, each leading into that project's
 * own closed space. The platform (the team and settings that belong to no project) is a small entry in the corner. A
 * project added to the registry appears here with no other change.
 */
export function ProjectHub({ t, spaces = SPACES }: { t: Translate; spaces?: readonly Space[] }) {
  const large = spaces.filter((space) => space.big);
  const small = spaces.filter((space) => !space.big);
  return (
    <div className="relative flex min-h-dvh items-center justify-center px-4 py-20">
      <h1 className="sr-only">{t('hub.title')}</h1>
      <nav aria-label={t('hub.title')} className="flex flex-wrap items-center justify-center gap-6">
        {large.map((space) => {
          const Icon = ICONS[space.icon];
          return (
            <Link
              key={space.id}
              href={space.home}
              data-project="large"
              className="flex w-56 flex-col items-center gap-5 rounded-2xl border border-line bg-surface px-8 py-10 text-center transition-colors hover:bg-hover"
            >
              <span aria-hidden className="inline-flex size-24 items-center justify-center rounded-2xl bg-raised">
                <Icon className="size-12 text-text" />
              </span>
              <span className="text-lg font-semibold text-text">{t(space.nameKey)}</span>
            </Link>
          );
        })}
      </nav>
      {small.length > 0 && (
        <nav aria-label={t('hub.platform')} className="absolute bottom-6 end-6 flex flex-col gap-1">
          {small.map((space) => {
            const Icon = ICONS[space.icon];
            return (
              <Link
                key={space.id}
                href={space.home}
                data-project="small"
                className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm text-muted transition-colors hover:bg-hover hover:text-text"
              >
                <Icon aria-hidden className="size-4 shrink-0" />
                {t(space.nameKey)}
              </Link>
            );
          })}
        </nav>
      )}
    </div>
  );
}
