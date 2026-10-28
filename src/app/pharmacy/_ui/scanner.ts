import { normalizeScan } from '@/server/domain/pharmacy/barcode';

/**
 * Keyboard-wedge barcode capture, as a pure state machine (no DOM, no timers, no clock of its own).
 *
 * A USB scanner "types" the code: characters a few milliseconds apart, then Enter or Tab. A person types slower.
 * A scan is therefore a run of at least `minLength` printable characters, each at most `maxGapMs` after the one
 * before, closed by a terminator. Anything else that ends in a terminator is `typing`. The code is kept as text
 * (leading zeros survive) and goes through `normalizeScan`, the same rule the server uses (Arabic-Indic and Persian
 * digits become Latin, surrounding whitespace goes).
 *
 * The caller passes the time of every key (`KeyboardEvent.timeStamp`, or a number in a test), so the machine is
 * deterministic.
 */

export type ScanEvent =
  | { kind: 'scan'; code: string }
  /** A scan identical to the one just accepted (a double trigger): not delivered, but its terminator is still a scanner's. */
  | { kind: 'duplicate'; code: string }
  | { kind: 'typing'; text: string }
  | { kind: 'ignored' };

export type ScannerOptions = {
  /** Fewest characters in a fast run for it to be a scan. Default 4. */
  minLength?: number;
  /** Longest pause between two characters of the same scan. Default 50 ms. */
  maxGapMs?: number;
  /** An identical code this soon after the last accepted scan is dropped (a double trigger). 0 turns it off. Default 300 ms. */
  duplicateWindowMs?: number;
  /** Buffered text older than this when the next key arrives is thrown away. Default 2000 ms. */
  idleResetMs?: number;
  /** Most characters held; a longer run is dropped whole until the next terminator. Default 128. */
  maxLength?: number;
  /** Text some scanners send before / after the code, removed before the code is normalised. */
  prefix?: string;
  suffix?: string;
};

export type ScannerCapture = {
  /** One key press with its time in ms. Only a terminator returns anything but `ignored`. */
  feed(key: string, timeMs: number): ScanEvent;
  /** Whether a printable key at `timeMs` would continue the run already buffered (false when it would start a new one). */
  continuesBurst(timeMs: number): boolean;
  /** Drops the buffer and the duplicate memory. */
  reset(): void;
};

export const SCAN_DEFAULTS = {
  minLength: 4,
  maxGapMs: 50,
  duplicateWindowMs: 300,
  idleResetMs: 2000,
  maxLength: 128,
} as const;

/** Whether the terminator that produced `event` belongs to a scanner run (so the page must not act on it). */
export function swallowsTerminator(event: ScanEvent): boolean {
  return event.kind === 'scan' || event.kind === 'duplicate';
}

export function isTerminator(key: string): boolean {
  return key === 'Enter' || key === 'Tab';
}

/** A key that carries one visible character (`'a'`, `'7'`, `'٣'`); named keys such as `'Shift'` do not. */
export function isPrintable(key: string): boolean {
  return Array.from(key).length === 1;
}

const DISCARD_KEYS = new Set(['Escape', 'Backspace', 'Delete']);

export function createScannerCapture(options: ScannerOptions = {}): ScannerCapture {
  const minLength = options.minLength ?? SCAN_DEFAULTS.minLength;
  const maxGapMs = options.maxGapMs ?? SCAN_DEFAULTS.maxGapMs;
  const duplicateWindowMs = options.duplicateWindowMs ?? SCAN_DEFAULTS.duplicateWindowMs;
  const idleResetMs = options.idleResetMs ?? SCAN_DEFAULTS.idleResetMs;
  const maxLength = options.maxLength ?? SCAN_DEFAULTS.maxLength;
  const { prefix, suffix } = options;

  let buffer: string[] = [];
  /** Index in `buffer` where the current fast run starts: a pause longer than `maxGapMs` moves it forward. */
  let runStart = 0;
  let lastKeyMs = Number.NEGATIVE_INFINITY;
  let overflowed = false;
  let lastScan: { code: string; timeMs: number } | null = null;

  const clearBuffer = () => {
    buffer = [];
    runStart = 0;
    overflowed = false;
  };
  const stale = (timeMs: number) => timeMs - lastKeyMs > idleResetMs;

  return {
    continuesBurst(timeMs) {
      return buffer.length > 0 && !overflowed && !stale(timeMs) && timeMs - lastKeyMs <= maxGapMs;
    },

    reset() {
      clearBuffer();
      lastKeyMs = Number.NEGATIVE_INFINITY;
      lastScan = null;
    },

    feed(key, timeMs) {
      if (DISCARD_KEYS.has(key)) {
        clearBuffer();
        return { kind: 'ignored' };
      }

      if (isTerminator(key)) {
        const wasOverflowed = overflowed;
        const wasStale = stale(timeMs);
        const chars = buffer;
        const start = runStart;
        clearBuffer();
        if (wasOverflowed || wasStale || chars.length === 0) return { kind: 'ignored' };

        const run = chars.slice(start);
        if (run.length < minLength) return { kind: 'typing', text: chars.join('') };

        let raw = run.join('');
        if (prefix && raw.startsWith(prefix)) raw = raw.slice(prefix.length);
        if (suffix && raw.endsWith(suffix)) raw = raw.slice(0, raw.length - suffix.length);
        const code = normalizeScan(raw);
        if (code === '') return { kind: 'ignored' };

        if (lastScan && lastScan.code === code && timeMs - lastScan.timeMs < duplicateWindowMs) return { kind: 'duplicate', code };
        lastScan = { code, timeMs };
        return { kind: 'scan', code };
      }

      if (!isPrintable(key)) return { kind: 'ignored' };

      if (stale(timeMs)) clearBuffer();
      else if (buffer.length > 0 && timeMs - lastKeyMs > maxGapMs) runStart = buffer.length;
      lastKeyMs = timeMs;
      if (overflowed) return { kind: 'ignored' };

      buffer.push(key);
      if (buffer.length > maxLength) {
        buffer = [];
        runStart = 0;
        overflowed = true;
      }
      return { kind: 'ignored' };
    },
  };
}
