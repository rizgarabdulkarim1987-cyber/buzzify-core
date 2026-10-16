'use client';

import { Command } from 'cmdk';
import { CornerDownLeft, LoaderCircle, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useT } from '@/studio/i18n';

export interface CommandResult {
  id: string;
  label: string;
  /** A second line: the client ID, the slug, the restaurant. */
  detail?: string;
  href: string;
}

export interface CommandGroup {
  heading: string;
  results: CommandResult[];
}

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Finds what matches the typed text. Called 200 ms after the last keystroke; the latest answer wins. A rejection is shown as "not available". */
  search: (query: string) => Promise<CommandGroup[]>;
}

/**
 * The shell of Jump to (Ctrl+K): a dialog with a search field and grouped results that the keyboard moves through (the
 * arrow keys; the first result is highlighted whenever new ones arrive), Enter opening the highlighted one and Escape
 * closing the dialog. What it searches is the caller's (`search`); the Studio's layout mounts it and binds the shortcut.
 */
export function CommandPalette({ open, onOpenChange, search }: CommandPaletteProps) {
  const t = useT();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [groups, setGroups] = useState<CommandGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [highlighted, setHighlighted] = useState('');
  const latest = useRef(0);

  useEffect(() => {
    const text = query.trim();
    if (text === '') return;
    const ticket = ++latest.current;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const found = await search(text);
        if (ticket !== latest.current) return;
        setFailed(false);
        setGroups(found);
        // New results start at their first: cmdk keeps the old highlight, which may no longer be there.
        setHighlighted(found[0]?.results[0]?.id ?? '');
      } catch {
        if (ticket !== latest.current) return;
        setFailed(true);
        setGroups([]);
        setHighlighted('');
      } finally {
        if (ticket === latest.current) setLoading(false);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [query, search]);

  const typed = query.trim() !== '';
  const shown = typed ? groups : [];

  const close = () => {
    onOpenChange(false);
    setQuery('');
    setGroups([]);
    setFailed(false);
    setHighlighted('');
  };

  return (
    <Command.Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) onOpenChange(true);
        else close();
      }}
      label={t('common.jumpTo')}
      shouldFilter={false}
      loop
      value={highlighted}
      onValueChange={setHighlighted}
      overlayClassName="fixed inset-0 z-40 bg-overlay"
      contentClassName="fixed inset-x-0 top-[12vh] z-50 mx-auto w-[calc(100vw-32px)] max-w-[600px] overflow-hidden rounded-lg bg-raised shadow-dialog"
    >
      <div className="flex items-center gap-2 border-b border-line px-4">
        <Search aria-hidden className="size-4 shrink-0 text-muted" />
        <Command.Input
          value={query}
          onValueChange={(next) => {
            setQuery(next);
            // A new text has no answer yet: the old results are not shown against it.
            if (next.trim() === '') setGroups([]);
          }}
          placeholder={t('common.jumpToPlaceholder')}
          maxLength={80}
          className="h-12 w-full bg-transparent text-md text-text outline-none placeholder:text-muted"
        />
        {loading && <LoaderCircle aria-hidden className="size-4 shrink-0 animate-spin text-muted" />}
      </div>
      <Command.List className="max-h-[min(420px,60vh)] overflow-y-auto p-2">
        {typed && !loading && failed && (
          <p role="status" className="px-3 py-6 text-center text-base text-danger">
            {t('common.searchFailed')}
          </p>
        )}
        {typed && !loading && !failed && (
          <Command.Empty role="status" className="px-3 py-6 text-center text-base text-muted">
            {t('common.jumpToEmpty')}
          </Command.Empty>
        )}
        {shown.map((group) => (
          <Command.Group
            key={group.heading}
            heading={group.heading}
            className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-muted"
          >
            {group.results.map((result) => (
              <Command.Item
                key={result.id}
                value={result.id}
                onSelect={() => {
                  close();
                  router.push(result.href);
                }}
                className="group flex min-h-10 cursor-pointer items-center gap-3 rounded-md px-3 py-1.5 data-[selected=true]:bg-accent-wash"
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span dir="auto" className="truncate text-base text-text">
                    {result.label}
                  </span>
                  {result.detail && (
                    <span dir="auto" className="truncate text-xs text-muted">
                      {result.detail}
                    </span>
                  )}
                </span>
                <CornerDownLeft aria-hidden className="hidden size-3.5 text-muted group-data-[selected=true]:block rtl:-scale-x-100" />
              </Command.Item>
            ))}
          </Command.Group>
        ))}
      </Command.List>
    </Command.Dialog>
  );
}
