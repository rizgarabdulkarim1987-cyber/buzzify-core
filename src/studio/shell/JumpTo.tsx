'use client';

import { Search } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { jump } from '@/app/studio/_actions/search';
import { useT } from '@/studio/i18n';
import { CommandPalette, type CommandGroup } from '@/studio/ui/CommandPalette';

/** The most Jump to asks the server to match (the server refuses more). */
const MAX_TYPED = 80;

/**
 * Jump to: a button in the sidebar and Ctrl+K (Cmd+K on a Mac) anywhere in the Studio open the palette, which searches
 * restaurants (by name, city or client ID) and menus (by name, address or restaurant) within what the person may see. A
 * result opens the restaurant's profile or the menu's page. When it closes, focus goes back where it was (the button, when
 * the shortcut was pressed with nothing focused).
 */
export function JumpTo() {
  const t = useT();
  const [open, setOpen] = useState(false);
  // The shortcut's name depends on the platform, which only the browser knows: the server (and hydration) says Ctrl.
  const mac = useSyncExternalStore(
    () => () => undefined,
    () => /Mac|iPhone|iPad/i.test(navigator.platform),
    () => false,
  );
  const trigger = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);

  const show = useCallback(() => {
    // Where focus was, to put it back there afterwards.
    if (document.activeElement instanceof HTMLElement) opener.current = document.activeElement;
    setOpen(true);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k') {
        // The browser's own Ctrl+K focuses its search field.
        event.preventDefault();
        if (open) setOpen(false);
        else show();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, show]);

  // Closing hands focus back after the dialog has let go of it (it returns it to the page's body when nothing had it).
  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      return;
    }
    if (!wasOpen.current) return;
    wasOpen.current = false;
    const timer = setTimeout(() => {
      const from = opener.current;
      const target = from && from.isConnected && from !== document.body ? from : trigger.current;
      target?.focus();
    }, 0);
    return () => clearTimeout(timer);
  }, [open]);

  const search = useCallback(
    async (typed: string): Promise<CommandGroup[]> => {
      const result = await jump({ q: typed.slice(0, MAX_TYPED) });
      if (!result.ok) throw new Error(result.error.code);
      const { restaurants, menus } = result.data;
      const groups: CommandGroup[] = [];
      if (restaurants.length > 0) {
        groups.push({
          heading: t('jump.restaurants'),
          results: restaurants.map((restaurant) => ({
            id: `restaurant:${restaurant.id}`,
            label: restaurant.name,
            detail: [restaurant.clientId, restaurant.city].filter(Boolean).join(' · '),
            href: `/studio/restaurants/${restaurant.id}`,
          })),
        });
      }
      if (menus.length > 0) {
        groups.push({
          heading: t('jump.menus'),
          results: menus.map((menu) => ({
            id: `menu:${menu.id}`,
            label: menu.name,
            detail: [menu.slug, menu.restaurantName, t(`status.${menu.status.toLowerCase()}`)].join(' · '),
            href: `/studio/menus/${menu.id}`,
          })),
        });
      }
      return groups;
    },
    [t],
  );

  const keys = mac ? '⌘K' : 'Ctrl K';
  return (
    <>
      <button
        ref={trigger}
        type="button"
        onClick={show}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-keyshortcuts="Control+K Meta+K"
        title={t('jump.shortcut', { keys })}
        className="flex h-8 w-full items-center gap-2 rounded-md border border-line-strong bg-raised px-2.5 text-base text-muted transition-colors duration-150 hover:border-muted/60 hover:text-text"
      >
        <Search aria-hidden className="size-4 shrink-0" />
        <span className="flex-1 truncate text-start">{t('common.jumpTo')}</span>
        <kbd dir="ltr" className="shrink-0 rounded-sm border border-line px-1 font-sans text-xs text-muted">
          {keys}
        </kbd>
      </button>
      <CommandPalette open={open} onOpenChange={setOpen} search={search} />
    </>
  );
}
