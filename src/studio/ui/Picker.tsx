'use client';

import { Command } from 'cmdk';
import { Check, ChevronDown, LoaderCircle, X } from 'lucide-react';
import { Popover } from 'radix-ui';
import { useEffect, useRef, useState } from 'react';
import { useT } from '@/studio/i18n';
import { cx } from './cx';
import { CONTROL_CLASSES, CONTROL_HEIGHTS, useFieldProps, type ControlSize } from './Field';

export interface PickerOption {
  value: string;
  label: string;
  /** A second line: the client ID, the email. */
  detail?: string;
}

export interface PickerProps {
  /** What is chosen now; null for nothing. The picker shows `label`, so a chosen option stays readable once the list moves on. */
  value: PickerOption | null;
  onChange: (option: PickerOption | null) => void;
  /** Finds the options for the typed text (the empty text gives the first few). Called 200 ms after the last keystroke; the latest answer wins. */
  search: (query: string) => Promise<PickerOption[]>;
  /** What the button says while nothing is chosen. */
  placeholder: string;
  /** Adds a button that empties the choice. */
  clearable?: boolean;
  /** A form field of this name carries the chosen value (empty when nothing is chosen). */
  name?: string;
  size?: ControlSize;
  className?: string;
}

/**
 * Chooses one thing out of too many to list: a restaurant, a menu or a person found by typing part of the name. It never
 * loads them all: the server answers each search with a few. A button shows the choice and opens a list with a search
 * field; the arrow keys move, Enter chooses and Escape closes, as in Jump to.
 */
export function Picker({ value, onChange, search, placeholder, clearable = false, name, size = 'md', className }: PickerProps) {
  const t = useT();
  const field = useFieldProps();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<PickerOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  // The dialog the picker sits in, when it does: its list opens inside it, so the dialog's focus trap does not pull focus out of the list.
  const [dialog, setDialog] = useState<HTMLElement | null>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const latest = useRef(0);

  useEffect(() => {
    if (!open) return;
    const ticket = ++latest.current;
    const timer = setTimeout(
      async () => {
        setLoading(true);
        try {
          const found = await search(query.trim());
          if (ticket !== latest.current) return;
          setFailed(false);
          setOptions(found);
        } catch {
          if (ticket !== latest.current) return;
          setFailed(true);
          setOptions([]);
        } finally {
          if (ticket === latest.current) setLoading(false);
        }
      },
      // The first rows appear at once; typing waits for a pause.
      query.trim() === '' ? 0 : 200,
    );
    return () => clearTimeout(timer);
  }, [open, query, search]);

  const choose = (option: PickerOption | null) => {
    onChange(option);
    setOpen(false);
  };

  return (
    <div ref={wrapper} className={cx('relative', className)}>
      <Popover.Root
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) {
            setDialog(wrapper.current?.closest<HTMLElement>('[role="dialog"]') ?? null);
            setQuery('');
            setOptions([]);
            setFailed(false);
          }
        }}
      >
        <Popover.Trigger asChild>
          <button
            type="button"
            // A form looks for the refused field by name to move focus to it; a hidden input cannot take focus, this can.
            name={name}
            {...field}
            aria-haspopup="listbox"
            className={cx(
              CONTROL_CLASSES,
              CONTROL_HEIGHTS[size],
              'flex cursor-pointer items-center gap-2 text-start',
              clearable && value ? 'pe-14' : 'pe-8',
            )}
          >
            <span dir="auto" className={cx('min-w-0 flex-1 truncate', !value && 'text-muted')}>
              {value ? value.label : placeholder}
            </span>
          </button>
        </Popover.Trigger>
        {name !== undefined && <input type="hidden" name={name} value={value?.value ?? ''} />}
        <ChevronDown aria-hidden className="pointer-events-none absolute end-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
        {clearable && value && (
          <button
            type="button"
            aria-label={t('picker.clear')}
            title={t('picker.clear')}
            onClick={() => onChange(null)}
            className="absolute end-8 top-1/2 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-sm text-muted transition-colors hover:bg-hover hover:text-text"
          >
            <X aria-hidden className="size-3.5" />
          </button>
        )}
        <Popover.Portal container={dialog}>
          <Popover.Content
            align="start"
            sideOffset={6}
            collisionPadding={8}
            className="z-50 w-[max(var(--radix-popover-trigger-width),18rem)] overflow-hidden rounded-md border border-line-strong bg-raised text-base text-text outline-none"
          >
            <Command shouldFilter={false} label={placeholder} loop>
              <div className="flex items-center gap-2 border-b border-line px-3">
                <Command.Input
                  value={query}
                  onValueChange={setQuery}
                  placeholder={t('common.search')}
                  maxLength={80}
                  className="h-9 w-full bg-transparent text-base text-text outline-none placeholder:text-muted"
                />
                {loading && <LoaderCircle aria-hidden className="size-4 shrink-0 animate-spin text-muted" />}
              </div>
              <Command.List className="max-h-64 overflow-y-auto p-1">
                {!loading && failed && (
                  <p role="status" className="px-3 py-4 text-center text-sm text-danger">
                    {t('common.searchFailed')}
                  </p>
                )}
                {!loading && !failed && (
                  <Command.Empty role="status" className="px-3 py-4 text-center text-sm text-muted">
                    {t('picker.empty')}
                  </Command.Empty>
                )}
                {options.map((option) => (
                  <Command.Item
                    key={option.value}
                    value={option.value}
                    onSelect={() => choose(option)}
                    className="flex min-h-8 cursor-pointer items-center gap-2 rounded-sm px-2 py-1 data-[selected=true]:bg-accent-wash"
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span dir="auto" className="truncate text-base text-text">
                        {option.label}
                      </span>
                      {option.detail && (
                        <span dir="auto" className="truncate text-xs text-muted">
                          {option.detail}
                        </span>
                      )}
                    </span>
                    {value?.value === option.value && <Check aria-hidden className="size-4 shrink-0 text-text" />}
                  </Command.Item>
                ))}
              </Command.List>
            </Command>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
