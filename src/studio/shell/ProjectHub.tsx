import Link from 'next/link';
import type { Translate } from '@/lib/i18n';
import { SPACE_ICONS } from '@/studio/space-icons';
import { SPACES, type Space } from '@/studio/spaces';

/**
 * A Super Admin's first screen: one large tile per product, in the middle of the screen, each leading into that product's
 * own closed space. Menu and Cashier, the Pharmacy and the three Retail products (Supermarket, Electronics, Clothing) stand
 * side by side as equals, each with its own drawing (`SPACE_ICONS`) and name. The platform (the team and settings that
 * belong to no product) is a small entry in the corner. A product added to the registry appears here with no other change.
 *
 * On a phone the tiles sit two to a row (an odd last one centred), large enough for a thumb; from a tablet up they keep one
 * width and wrap centred, so five fit one row on a desktop.
 */
export function ProjectHub({ t, spaces = SPACES }: { t: Translate; spaces?: readonly Space[] }) {
  const large = spaces.filter((space) => space.big);
  const small = spaces.filter((space) => !space.big);
  return (
    <div className="relative flex min-h-dvh items-center justify-center px-4 pb-24 pt-16 sm:py-20">
      <h1 className="sr-only">{t('hub.title')}</h1>
      <nav aria-label={t('hub.title')} className="flex w-full max-w-6xl flex-wrap items-stretch justify-center gap-3 sm:gap-5">
        {large.map((space) => {
          const Icon = SPACE_ICONS[space.icon];
          return (
            <Link
              key={space.id}
              href={space.home}
              data-project="large"
              className="flex w-[calc(50%-0.375rem)] flex-col items-center justify-center gap-3 rounded-2xl border border-line bg-surface px-3 py-5 text-center transition-[background-color,border-color,transform] duration-150 ease-out hover:border-muted hover:bg-hover active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100 sm:w-44 sm:gap-5 sm:px-5 sm:py-8 lg:w-48"
            >
              <span aria-hidden className="inline-flex size-14 items-center justify-center rounded-2xl bg-raised sm:size-20">
                <Icon className="size-7 text-text sm:size-10" strokeWidth={1.75} />
              </span>
              <span className="text-balance text-base font-semibold leading-snug text-text sm:text-lg">{t(space.nameKey)}</span>
            </Link>
          );
        })}
      </nav>
      {small.length > 0 && (
        <nav aria-label={t('hub.platform')} className="absolute bottom-6 end-6 flex flex-col gap-1">
          {small.map((space) => {
            const Icon = SPACE_ICONS[space.icon];
            return (
              <Link
                key={space.id}
                href={space.home}
                data-project="small"
                className="inline-flex h-11 items-center gap-2 rounded-md px-3 text-sm text-muted transition-colors hover:bg-hover hover:text-text sm:h-9"
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
