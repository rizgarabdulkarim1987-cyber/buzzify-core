'use client';

import { Search, X } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useT } from '@/studio/i18n';
import { Button } from './Button';
import { CONTROL_CLASSES } from './Field';
import { cx } from './cx';

/** The address with `changes` applied to its query: an empty value removes the parameter, and any change goes back to page 1. */
function withParams(pathname: string, current: URLSearchParams, changes: Record<string, string | null>): string {
  const next = new URLSearchParams(current);
  for (const [name, value] of Object.entries(changes)) {
    if (value === null || value === '') next.delete(name);
    else next.set(name, value);
  }
  next.delete('page');
  const query = next.toString();
  return query ? `${pathname}?${query}` : pathname;
}

/** Changes a list's filters in the address, which the page reads: filters survive reloads and can be shared. */
export function useFilterParams() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return {
    params,
    set: (changes: Record<string, string | null>) => router.replace(withParams(pathname, params, changes), { scroll: false }),
  };
}

export interface FilterBarProps {
  /** The filters: a search field, selects. */
  children: ReactNode;
  /** The parameters the bar owns; "Clear filters" appears while any of them is set and removes them all. */
  params: readonly string[];
}

/** A list's filters in one row above it. */
export function FilterBar({ children, params: names }: FilterBarProps) {
  const t = useT();
  const { params, set } = useFilterParams();
  const active = names.some((name) => params.get(name));
  return (
    <div className="flex flex-wrap items-center gap-2">
      {children}
      {active && (
        <Button variant="ghost" size="md" icon={<X aria-hidden />} onClick={() => set(Object.fromEntries(names.map((name) => [name, null])))}>
          {t('common.clearFilters')}
        </Button>
      )}
    </div>
  );
}

/** The search field of a filter bar: it updates the address 250 ms after the last keystroke. */
export function SearchFilter({ param = 'q', placeholder, label, className }: { param?: string; placeholder: string; label: string; className?: string }) {
  const { params, set } = useFilterParams();
  const [value, setValue] = useState(params.get(param) ?? '');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const outside = params.get(param) ?? '';

  // Follow the address when it changes from elsewhere (Back, "Clear filters").
  const [seen, setSeen] = useState(outside);
  if (outside !== seen) {
    setSeen(outside);
    setValue(outside);
  }

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <div className={cx('relative w-72', className)}>
      <Search aria-hidden className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
      <input
        type="search"
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(event) => {
          const next = event.target.value;
          setValue(next);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => set({ [param]: next.trim() }), 250);
        }}
        className={cx(CONTROL_CLASSES, 'h-8 ps-8 pe-2.5 text-base')}
      />
    </div>
  );
}
