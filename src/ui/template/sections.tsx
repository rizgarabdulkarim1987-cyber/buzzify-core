'use client';

import type { HeadingStyle } from '@/lib/templates/types';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';

/** The first letter of a name, as one user-perceived character (a seal shows it). */
function firstLetter(name: string): string {
  const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
  const first = segmenter ? segmenter.segment(name)[Symbol.iterator]().next().value?.segment : Array.from(name)[0];
  return first ?? '';
}

/** A category's heading in the template's style. `index` counts from 0. */
export function SectionHeading({ id, name, index, style }: { id: string; name: string; index: number; style: HeadingStyle }) {
  const { locale, tenant, t } = useApp();
  switch (style) {
    case 'rule':
      return (
        <h2 id={id} className="tpl-h2 tpl-display flex items-center gap-4">
          <span className="min-w-0">{name}</span>
          <span aria-hidden className="h-px min-w-8 flex-1 bg-(--line)" />
        </h2>
      );
    case 'numbered':
      return (
        <h2 id={id} className="tpl-h2 tpl-display flex items-baseline gap-4">
          <span aria-hidden className="tpl-numeral">{formatCount(index + 1, locale, tenant.numeralSystem).padStart(2, tenant.numeralSystem === 'arab' ? '٠' : '0')}</span>
          <span className="sr-only">{t('tpl.chapter', { number: formatCount(index + 1, locale, tenant.numeralSystem) })}: </span>
          <span className="min-w-0">{name}</span>
        </h2>
      );
    case 'arch':
      return (
        <h2 id={id} className="tpl-h2 tpl-display tpl-heading-arch">
          {name}
        </h2>
      );
    case 'seal':
      return (
        <h2 id={id} className="tpl-h2 tpl-display flex items-center gap-3">
          <span aria-hidden className="tpl-seal">
            {firstLetter(name)}
          </span>
          <span className="min-w-0">{name}</span>
        </h2>
      );
    case 'script':
      return (
        <h2 id={id} className="tpl-h2 tpl-display tpl-heading-script">
          <span>{name}</span>
          <svg aria-hidden viewBox="0 0 120 12" preserveAspectRatio="none" className="mt-1 h-2.5 w-24 text-(--accent)">
            <path d="M2 8c18-6 30-6 44-2s28 6 44 1 20-5 28-3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </h2>
      );
    case 'band':
      return (
        <h2 id={id} className="tpl-h2 tpl-display tpl-heading-band">
          {name}
        </h2>
      );
    case 'ornament':
      return (
        <h2 id={id} className="tpl-h2 tpl-display flex flex-col items-center text-center">
          <svg aria-hidden viewBox="0 0 48 16" className="mb-2 h-3.5 w-12 text-(--accent)">
            <path d="M24 2l3 6-3 6-3-6zM2 8h16M30 8h16" fill="none" stroke="currentColor" strokeWidth="1.2" />
          </svg>
          {name}
        </h2>
      );
    case 'outline':
      return (
        <h2 id={id} className="tpl-heading-outline">
          <span aria-hidden className="tpl-outline-text tpl-display">
            {name}
          </span>
          <span className="tpl-h2 tpl-display relative">{name}</span>
        </h2>
      );
    default:
      return (
        <h2 id={id} className="tpl-h2 tpl-display">
          {name}
        </h2>
      );
  }
}
