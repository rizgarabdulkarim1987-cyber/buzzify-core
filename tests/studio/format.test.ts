import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { describeUserAgent, formatBytes, formatDate, formatDateTime, numberFormat } from '@/studio/format';
import { isolated } from '@/studio/ui/isolate';

describe('describeUserAgent', () => {
  it('names the browser and system a person would recognise', () => {
    const chrome = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
    const edge = `${chrome} Edg/141.0.0.0`;
    const iphone =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
    const firefox = 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0';
    expect(describeUserAgent(chrome)).toEqual({ browser: 'Chrome', system: 'Windows' });
    expect(describeUserAgent(edge)).toEqual({ browser: 'Edge', system: 'Windows' });
    expect(describeUserAgent(iphone)).toEqual({ browser: 'Safari', system: 'iOS' });
    expect(describeUserAgent(firefox)).toEqual({ browser: 'Firefox', system: 'Linux' });
    expect(describeUserAgent('')).toEqual({ browser: null, system: null });
  });
});

describe('formatDateTime', () => {
  it('states the time in Baghdad whatever the server’s own zone, in the interface language', () => {
    const at = '2026-10-16T16:05:00.000Z';
    expect(formatDateTime(at, 'en')).toBe('Oct 16, 2026, 7:05 PM');
    expect(formatDateTime(at, 'ar')).not.toBe(formatDateTime(at, 'en'));
  });

  // Browsers have no Sorani formatting data (Chrome formats `ckb` as American English), so Sorani is written by the
  // Studio itself and does not depend on the runtime: the server's page and the browser's render agree.
  it('writes Sorani dates and times itself, in CLDR’s pattern with Arabic-script digits', () => {
    expect(formatDateTime('2026-10-16T16:05:00.000Z', 'ckb')).toBe('٢٠٢٦ تشرینی یەکەم ١٦ ٧:٠٥ د.ن');
    expect(formatDateTime('2026-10-16T05:05:00.000Z', 'ckb')).toBe('٢٠٢٦ تشرینی یەکەم ١٦ ٨:٠٥ ب.ن');
    // Midnight and noon in Baghdad are 12 before and after noon; the day is Baghdad's.
    expect(formatDateTime('2026-10-15T21:00:00.000Z', 'ckb')).toBe('٢٠٢٦ تشرینی یەکەم ١٦ ١٢:٠٠ ب.ن');
    expect(formatDateTime('2026-10-16T09:00:00.000Z', 'ckb')).toBe('٢٠٢٦ تشرینی یەکەم ١٦ ١٢:٠٠ د.ن');
    expect(formatDate('2026-01-01T12:00:00.000Z', 'ckb')).toBe('٢٠٢٦ کانوونی دووەم ١');
    expect(formatDate('2026-12-31T20:59:00.000Z', 'ckb')).toBe('٢٠٢٦ کانوونی یەکەم ٣١');
    expect(formatDate('2026-12-31T21:00:00.000Z', 'ckb')).toBe('٢٠٢٧ کانوونی دووەم ١');
  });

  it('prints what Node’s own Sorani data prints, so pages rendered on the server keep their dates', () => {
    const at = '2026-10-16T16:05:00.000Z';
    const node = new Intl.DateTimeFormat('ckb', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Baghdad' }).format(new Date(at));
    expect(formatDateTime(at, 'ckb')).toBe(node);
  });

  it('states the time on another clock when given one, such as a menu’s own', () => {
    expect(formatDateTime('2026-11-01T06:00:00.000Z', 'en', 'UTC')).toBe('Nov 1, 2026, 6:00 AM');
    expect(formatDateTime('2026-11-01T06:00:00.000Z', 'en', 'Asia/Baghdad')).toBe('Nov 1, 2026, 9:00 AM');
    // Late on the 17th in UTC is already the 18th in Baghdad.
    expect(formatDateTime('2026-10-17T22:30:00.000Z', 'ckb', 'UTC')).toBe('٢٠٢٦ تشرینی یەکەم ١٧ ١٠:٣٠ د.ن');
    expect(formatDateTime('2026-10-17T22:30:00.000Z', 'ckb', 'Asia/Baghdad')).toBe('٢٠٢٦ تشرینی یەکەم ١٨ ١:٣٠ ب.ن');
  });

  // The Revisions tab printed "Oct ١٨, ٢٠٢٦, ٦:٢٥ AM" in the browser where the server had printed Sorani, and React threw
  // the server's page away.
  it('prints the same Sorani in a browser, whose Intl has no Sorani data', () => {
    const at = '2026-10-18T03:25:00.000Z';
    const runtimeSorani = () =>
      new Intl.DateTimeFormat('ckb', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Baghdad', numberingSystem: 'arab' }).format(new Date(at));
    expect(inABrowser(runtimeSorani)).toBe('Oct ١٨, ٢٠٢٦, ٦:٢٥ AM');
    expect(inABrowser(() => formatDateTime(at, 'ckb', 'Asia/Baghdad'))).toBe('٢٠٢٦ تشرینی یەکەم ١٨ ٦:٢٥ ب.ن');
    expect(inABrowser(() => formatDateTime(at, 'ckb', 'UTC'))).toBe('٢٠٢٦ تشرینی یەکەم ١٨ ٣:٢٥ ب.ن');
    expect(inABrowser(() => formatDate(at, 'ckb'))).toBe('٢٠٢٦ تشرینی یەکەم ١٨');
  });
});

/** Runs `read` with Intl as Chrome has it: no Sorani data, so `ckb` falls back to American English. */
function inABrowser<T>(read: () => T): T {
  const { DateTimeFormat, NumberFormat } = Intl;
  const fallback = (locales?: Intl.LocalesArgument) => ([locales].flat().includes('ckb') ? 'en-US' : locales);
  class BrowserDateTimeFormat extends DateTimeFormat {
    constructor(locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) {
      super(fallback(locales), options);
    }
  }
  class BrowserNumberFormat extends NumberFormat {
    constructor(locales?: Intl.LocalesArgument, options?: Intl.NumberFormatOptions) {
      super(fallback(locales), options);
    }
  }
  Object.assign(Intl, { DateTimeFormat: BrowserDateTimeFormat, NumberFormat: BrowserNumberFormat });
  try {
    return read();
  } finally {
    Object.assign(Intl, { DateTimeFormat, NumberFormat });
  }
}

describe('numberFormat', () => {
  it('gives Sorani Arabic-script digits without the runtime’s Sorani data, and leaves the other languages to Intl', () => {
    expect(numberFormat('ckb').format(1234.5)).toBe('١٬٢٣٤٫٥');
    // A browser formats `ckb` with English data; with the numbering system it still prints the same.
    expect(new Intl.NumberFormat('en-US', { numberingSystem: numberFormat('ckb').resolvedOptions().numberingSystem }).format(1234.5)).toBe(
      '١٬٢٣٤٫٥',
    );
    expect(numberFormat('en').format(1234.5)).toBe('1,234.5');
    expect(numberFormat('ar').format(3)).toBe(new Intl.NumberFormat('ar').format(3));
  });
});

describe('isolated', () => {
  it('fills placeholders with text set apart from the sentence, and leaves the rest as it is', () => {
    const html = renderToStaticMarkup(isolated('Signed in as {email} at {place}.', { email: 'a@b.test' }));
    expect(html).toBe('Signed in as <bdi>a@b.test</bdi> at {place}.');
  });
});

describe('formatBytes', () => {
  it('writes a size in the unit people read, in the interface’s digits', () => {
    expect(formatBytes(820, 'en')).toBe('820 B');
    expect(formatBytes(12_700, 'en')).toBe('12.4 KB');
    expect(formatBytes(3_250_000, 'en')).toBe('3.1 MB');
    expect(formatBytes(3_250_000, 'ckb')).toBe('٣٫١ MB');
  });
});
