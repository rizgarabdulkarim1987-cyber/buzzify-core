import { Bot, Calculator, CalendarX, CircleAlert, CircleCheck, CircleDashed, CircleHelp, Copy, Pencil, ScanBarcode, Shuffle, UserCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Translate } from '@/lib/i18n';
import type { FlagCode, HeaderSource, MatchChip, ValueSource } from './intake-review-logic';

const CHIP = 'inline-flex min-h-6 items-center gap-1.5 rounded-sm border px-1.5 py-0.5 text-xs font-medium [&_svg]:size-3.5 [&_svg]:shrink-0';
const NEUTRAL = 'border-line-strong bg-surface text-text';
const GOOD = 'border-transparent bg-success-wash text-success';
const BAD = 'border-transparent bg-danger-wash text-danger';

const MATCH_ICONS: Record<MatchChip, ReactNode> = {
  matched: <CircleCheck aria-hidden />,
  unmatched: <CircleHelp aria-hidden />,
  ambiguous: <Shuffle aria-hidden />,
  chosen: <UserCheck aria-hidden />,
};

/** A line's product match: icon and word together. */
export function MatchState({ kind, t }: { kind: MatchChip; t: Translate }) {
  return (
    <span data-testid="match-chip" data-match={kind} className={`${CHIP} ${kind === 'matched' || kind === 'chosen' ? GOOD : kind === 'ambiguous' ? BAD : NEUTRAL}`}>
      {MATCH_ICONS[kind]}
      {t(`pharmacy.intake.rv.match.${kind}`)}
    </span>
  );
}

const FLAG_ICONS: Record<FlagCode, ReactNode> = {
  MISSING: <CircleDashed aria-hidden />,
  AMBIGUOUS_MATCH: <Shuffle aria-hidden />,
  MATH_MISMATCH: <Calculator aria-hidden />,
  MODEL_UNCLEAR: <Bot aria-hidden />,
  EXPIRED: <CalendarX aria-hidden />,
  DUPLICATE_LINE: <Copy aria-hidden />,
};

/** A flag a line raises: icon and name. A flag already accepted by a person says so in words. */
export function FlagChip({ flag, checked, t }: { flag: FlagCode; checked: boolean; t: Translate }) {
  return (
    <span data-testid="flag-chip" data-flag={flag} data-open={checked ? 'false' : 'true'} className={`${CHIP} ${checked ? GOOD : BAD}`}>
      {checked ? <CircleCheck aria-hidden /> : FLAG_ICONS[flag]}
      {t(`pharmacy.intake.rv.flagChip.${flag}`)}
      {checked && <span className="font-normal">· {t('pharmacy.intake.rv.flagChecked')}</span>}
    </span>
  );
}

const SOURCE_ICONS: Record<ValueSource | HeaderSource, ReactNode> = { read: null, edited: <Pencil aria-hidden />, barcode: <ScanBarcode aria-hidden />, manual: <Pencil aria-hidden />, conflict: <CircleAlert aria-hidden />, notRead: <CircleDashed aria-hidden /> } as const;

/** Where a value came from, in words ("read from invoice", "edited by you", "filled from barcode", "conflict between files: choose"). */
export function SourceTag({ source, t }: { source: ValueSource | HeaderSource; t: Translate }) {
  return (
    <span data-testid="source-tag" data-source={source} className={`inline-flex items-center gap-1 text-xs [&_svg]:size-3 [&_svg]:shrink-0 ${source === 'conflict' ? 'font-medium text-danger' : 'text-muted'}`}>
      {SOURCE_ICONS[source]}
      {t(`pharmacy.intake.rv.src.${source}`)}
    </span>
  );
}

/** A value that was not read: said in words, never a blank or a zero. */
export function NotRead({ t }: { t: Translate }) {
  return (
    <span data-testid="not-read" className="inline-flex items-center gap-1 text-sm italic text-muted [&_svg]:size-3.5 [&_svg]:shrink-0">
      <CircleDashed aria-hidden />
      {t('pharmacy.intake.rv.notRead')}
    </span>
  );
}

const NOTE = 'flex items-start gap-2.5 text-sm [&_svg]:mt-px [&_svg]:size-4 [&_svg]:shrink-0';

/** A refusal or a result in a sentence with its icon; an error is announced. */
export function Message({ tone, children, testId }: { tone: 'error' | 'ok' | 'info'; children: ReactNode; testId?: string }) {
  return (
    <p role={tone === 'error' ? 'alert' : 'status'} data-testid={testId} className={`${NOTE} ${tone === 'error' ? 'text-danger' : 'text-text'}`}>
      {tone === 'error' ? <CircleAlert aria-hidden /> : tone === 'ok' ? <CircleCheck aria-hidden className="text-success" /> : <CircleHelp aria-hidden className="text-muted" />}
      <span className="min-w-0">{children}</span>
    </p>
  );
}

