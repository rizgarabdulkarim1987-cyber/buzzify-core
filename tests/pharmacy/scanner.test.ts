import { describe, expect, it } from 'vitest';
import { normalizeScan } from '@/server/domain/pharmacy/barcode';
import { createScannerCapture, swallowsTerminator, type ScanEvent, type ScannerOptions } from '@/app/pharmacy/_ui/scanner';

/** Types `text` with `gap` ms between keys starting at `start`, then `terminator`; returns every event. */
function stream(options: ScannerOptions | undefined, text: string, gap: number, terminator: string | null = 'Enter', start = 1000) {
  const scanner = createScannerCapture(options);
  const events: ScanEvent[] = [];
  let t = start;
  for (const ch of Array.from(text)) {
    events.push(scanner.feed(ch, t));
    t += gap;
  }
  if (terminator) events.push(scanner.feed(terminator, t));
  return { scanner, events, last: events[events.length - 1]! };
}

/** Feeds `code` (5 ms apart from `start`) and Enter, returning the Enter's event. */
function scanOn(scanner: ReturnType<typeof createScannerCapture>, code: string, start: number): ScanEvent {
  let t = start;
  for (const ch of Array.from(code)) scanner.feed(ch, (t += 5));
  return scanner.feed('Enter', (t += 5));
}

describe('scanner capture', () => {
  it('a fast burst then Enter is a scan', () => {
    expect(stream(undefined, '5901234123457', 10).last).toEqual({ kind: 'scan', code: '5901234123457' });
  });

  it('Tab terminates a scan too', () => {
    expect(stream(undefined, '12345678', 20, 'Tab').last).toEqual({ kind: 'scan', code: '12345678' });
  });

  it('a gap of exactly 50 ms still counts as fast; 51 ms does not', () => {
    expect(stream(undefined, '123456', 50).last.kind).toBe('scan');
    expect(stream(undefined, '123456', 51).last).toEqual({ kind: 'typing', text: '123456' });
  });

  it('a slow typed burst is typing, not a scan', () => {
    expect(stream(undefined, 'paracetamol', 200).last).toEqual({ kind: 'typing', text: 'paracetamol' });
  });

  it('characters before the terminator report ignored', () => {
    const { events } = stream(undefined, '123456', 10);
    expect(events.slice(0, 6).every((e) => e.kind === 'ignored')).toBe(true);
  });

  it('keeps leading zeros as text', () => {
    expect(stream(undefined, '0001234567', 5).last).toEqual({ kind: 'scan', code: '0001234567' });
  });

  it('maps Arabic-Indic and Persian digits to Latin, equal to normalizeScan', () => {
    const arabic = '٠١٢٣٤٥٦٧٨٩';
    const persian = '۰۱۲۳۴۵۶۷۸۹';
    expect(stream(undefined, arabic, 10).last).toEqual({ kind: 'scan', code: '0123456789' });
    expect(stream(undefined, persian, 10).last).toEqual({ kind: 'scan', code: '0123456789' });
    expect(stream(undefined, arabic + persian, 10).last).toEqual({ kind: 'scan', code: normalizeScan(arabic + persian) });
  });

  it('ignores stray non-printable keys without breaking the burst', () => {
    const scanner = createScannerCapture();
    let t = 0;
    const out: ScanEvent[] = [];
    for (const key of ['Shift', '1', '2', 'Control', '3', 'Alt', '4', 'CapsLock', '5', 'F5', '6']) {
      out.push(scanner.feed(key, (t += 5)));
    }
    out.push(scanner.feed('Enter', (t += 5)));
    expect(out[out.length - 1]).toEqual({ kind: 'scan', code: '123456' });
    expect(out[0]).toEqual({ kind: 'ignored' });
  });

  it('the gap is measured between printable characters, so a stray key neither extends nor breaks it', () => {
    const scanner = createScannerCapture();
    scanner.feed('1', 0);
    scanner.feed('2', 10);
    scanner.feed('3', 20);
    scanner.feed('Shift', 60);
    scanner.feed('4', 65);
    expect(scanner.feed('Enter', 70)).toEqual({ kind: 'scan', code: '1234' });
  });

  it('respects min length (default 4, configurable)', () => {
    expect(stream(undefined, '123', 5).last).toEqual({ kind: 'typing', text: '123' });
    expect(stream(undefined, '1234', 5).last).toEqual({ kind: 'scan', code: '1234' });
    expect(stream({ minLength: 8 }, '1234567', 5).last).toEqual({ kind: 'typing', text: '1234567' });
  });

  it('a terminator with nothing buffered is ignored', () => {
    expect(createScannerCapture().feed('Enter', 5)).toEqual({ kind: 'ignored' });
  });

  it('ignores an identical scan within 300 ms, accepts it later, accepts a different one at once', () => {
    const scanner = createScannerCapture();
    expect(scanOn(scanner, '123456', 0).kind).toBe('scan');
    expect(scanOn(scanner, '123456', 100)).toEqual({ kind: 'duplicate', code: '123456' });
    expect(scanOn(scanner, '654321', 200)).toEqual({ kind: 'scan', code: '654321' });
    expect(scanOn(scanner, '654321', 1000).kind).toBe('scan');
  });

  it('the duplicate window is configurable and can be turned off', () => {
    const run = (opts: ScannerOptions) => {
      const scanner = createScannerCapture(opts);
      scanOn(scanner, '123456', 0);
      return scanOn(scanner, '123456', 600).kind;
    };
    expect(run({ duplicateWindowMs: 1000 })).toBe('duplicate');
    expect(run({ duplicateWindowMs: 0 })).toBe('scan');
  });

  it('strips configured prefix and suffix, then normalises', () => {
    expect(stream({ prefix: '~', suffix: '#' }, '~٠٠١٢٣٤٥#', 5).last).toEqual({ kind: 'scan', code: '0012345' });
    expect(stream({ prefix: '~' }, '12345678', 5).last).toEqual({ kind: 'scan', code: '12345678' });
  });

  it('a code that is empty after stripping is ignored', () => {
    expect(stream({ prefix: '~~~~' }, '~~~~', 5).last).toEqual({ kind: 'ignored' });
  });

  it('bounds a huge input: no scan, no growth, recovers after the terminator', () => {
    const scanner = createScannerCapture({ maxLength: 64 });
    let t = 0;
    for (let i = 0; i < 100_000; i++) scanner.feed('9', (t += 1));
    expect(scanner.feed('Enter', (t += 1))).toEqual({ kind: 'ignored' });
    expect(scanOn(scanner, '4006381333931', t)).toEqual({ kind: 'scan', code: '4006381333931' });
  });

  it('a slow huge typed text is bounded too', () => {
    const scanner = createScannerCapture({ maxLength: 20 });
    let t = 0;
    for (let i = 0; i < 500; i++) scanner.feed('a', (t += 500));
    expect(scanner.feed('Enter', (t += 500))).toEqual({ kind: 'ignored' });
  });

  it('uses only the injected times, never the real clock', () => {
    const base = 1e12;
    const scanner = createScannerCapture();
    for (const [i, ch] of Array.from('1234').entries()) scanner.feed(ch, base + i * 10);
    expect(scanner.feed('Enter', base + 40)).toEqual({ kind: 'scan', code: '1234' });
  });

  it('a stale buffer is discarded after the idle timeout', () => {
    const scanner = createScannerCapture({ idleResetMs: 1000 });
    for (const [i, ch] of Array.from('999').entries()) scanner.feed(ch, i);
    expect(scanOn(scanner, '12345', 5000)).toEqual({ kind: 'scan', code: '12345' });
  });

  it('a slow prefix of typing then a fast burst: the scan is the burst only', () => {
    const scanner = createScannerCapture();
    scanner.feed('x', 0);
    scanner.feed('y', 400);
    expect(scanOn(scanner, '1234567', 800)).toEqual({ kind: 'scan', code: '1234567' });
  });

  it('reset clears the buffer and the duplicate memory', () => {
    const scanner = createScannerCapture();
    for (const [i, ch] of Array.from('123456').entries()) scanner.feed(ch, i);
    scanner.reset();
    expect(scanner.feed('Enter', 10)).toEqual({ kind: 'ignored' });
    expect(scanOn(scanner, '123456', 20).kind).toBe('scan');
    scanner.reset();
    expect(scanOn(scanner, '123456', 100).kind).toBe('scan');
  });

  it('Escape and Backspace discard the buffer', () => {
    const scanner = createScannerCapture();
    for (const [i, ch] of Array.from('12345').entries()) scanner.feed(ch, i);
    expect(scanner.feed('Escape', 6)).toEqual({ kind: 'ignored' });
    expect(scanner.feed('Enter', 7)).toEqual({ kind: 'ignored' });
  });
});

describe('which terminators the hook swallows', () => {
  it('a scan and a dropped duplicate are swallowed (no Enter reaches a search box); typing and ignored are not', () => {
    expect(swallowsTerminator({ kind: 'scan', code: '123456' })).toBe(true);
    expect(swallowsTerminator({ kind: 'duplicate', code: '123456' })).toBe(true);
    expect(swallowsTerminator({ kind: 'typing', text: 'ab' })).toBe(false);
    expect(swallowsTerminator({ kind: 'ignored' })).toBe(false);
  });
});
