'use client';

import {
  Activity,
  ChevronsUpDown,
  CreditCard,
  Images,
  LayoutDashboard,
  LayoutTemplate,
  LogOut,
  Megaphone,
  Settings,
  Sparkles,
  Store,
  UserRound,
  Users,
  UtensilsCrossed,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { signOut } from '@/app/studio/_actions/session';
import { ACCOUNT_PATH } from '@/server/studio/framework/paths';
import { describeFailure } from '@/studio/errors';
import { useLocale, useT } from '@/studio/i18n';
import { isNavItemActive, type NavIcon, type NavItem } from '@/studio/nav';
import { navigateAway } from '@/studio/navigate';
import { cx } from '@/studio/ui/cx';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/studio/ui/DropdownMenu';
import { JumpTo } from './JumpTo';
import { LanguageSwitch } from './LanguageSwitch';
import { Wordmark } from './Wordmark';

const ICONS: Record<NavIcon, LucideIcon> = {
  overview: LayoutDashboard,
  restaurants: Store,
  billing: CreditCard,
  menus: UtensilsCrossed,
  media: Images,
  motion: Sparkles,
  styles: LayoutTemplate,
  people: Users,
  announcements: Megaphone,
  activity: Activity,
  settings: Settings,
  store: Store,
};

/** A navigation item as the layout hands it over: its label already in the person's language. */
export type SidebarItem = Omit<NavItem, 'labelKey' | 'label'> & { label: string };

export interface SidebarUser {
  name: string;
  email: string;
  role: string;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? [parts[0]!, parts[parts.length - 1]!] : parts.slice(0, 1);
  return letters.map((part) => [...part][0]!.toLocaleUpperCase()).join('') || '?';
}

/**
 * The Studio's frame on the reading direction's start side: the product's name, Jump to (the button and Ctrl+K), the areas
 * the person may use (the current one marked with the amber edge), the language switch, and the person's own menu.
 */
export function Sidebar({ items, user }: { items: readonly SidebarItem[]; user: SidebarUser }) {
  const t = useT();
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 flex h-dvh w-60 shrink-0 flex-col border-e border-line bg-surface">
      <div className="flex h-14 items-center px-5">
        <Link href="/studio" className="rounded-sm">
          <Wordmark />
        </Link>
      </div>

      <div className="px-3 pb-2">
        <JumpTo />
      </div>

      <nav aria-label={t('nav.label')} className="flex-1 overflow-y-auto px-3 py-2">
        <ul className="flex flex-col gap-0.5">
          {items.map((item) => {
            const Icon = ICONS[item.icon];
            const current = isNavItemActive(item, pathname);
            return (
              <li key={`${item.key}:${item.href}`}>
                <Link
                  href={item.href}
                  aria-current={current ? 'page' : undefined}
                  className={cx(
                    'relative flex h-8 items-center gap-2.5 rounded-md px-2.5 text-base transition-colors duration-150',
                    current
                      ? 'bg-raised font-medium text-text before:absolute before:inset-y-1.5 before:start-0 before:w-0.5 before:rounded-full before:bg-accent'
                      : 'text-muted hover:bg-hover hover:text-text',
                  )}
                >
                  <Icon aria-hidden className={cx('size-4 shrink-0', current ? 'text-text' : 'text-muted')} />
                  <span className="truncate">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="flex flex-col gap-3 border-t border-line px-3 py-3">
        <LanguageSwitch signedIn className="self-start" />
        <UserMenu user={user} />
      </div>
    </aside>
  );
}

function UserMenu({ user }: { user: SidebarUser }) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const leave = () =>
    startTransition(async () => {
      const result = await signOut({});
      if (result.ok) return navigateAway(result.data.next);
      toast.error(describeFailure(t, locale, result.error).message);
    });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t('nav.accountMenu')}
        className="flex w-full items-center gap-2.5 rounded-md px-1.5 py-1.5 text-start transition-colors hover:bg-hover data-[state=open]:bg-hover"
      >
        <span aria-hidden className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-medium text-on-ink">
          {initials(user.name)}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium text-text">{user.name}</span>
          <span className="truncate text-xs text-muted">{user.role}</span>
        </span>
        <ChevronsUpDown aria-hidden className="size-4 shrink-0 text-muted" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-[var(--radix-dropdown-menu-trigger-width)]">
        <DropdownMenuLabel>
          <span dir="ltr" className="block truncate">
            {user.email}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem icon={<UserRound aria-hidden />} onSelect={() => router.push(ACCOUNT_PATH)}>
          {t('nav.account')}
        </DropdownMenuItem>
        <DropdownMenuItem icon={<LogOut aria-hidden className="rtl:-scale-x-100" />} disabled={pending} onSelect={leave}>
          {t('nav.signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
