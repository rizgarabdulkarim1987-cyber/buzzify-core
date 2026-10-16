import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { describeUserAgent, formatDateTime } from '@/studio/format';
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
});

describe('isolated', () => {
  it('fills placeholders with text set apart from the sentence, and leaves the rest as it is', () => {
    const html = renderToStaticMarkup(isolated('Signed in as {email} at {place}.', { email: 'a@b.test' }));
    expect(html).toBe('Signed in as <bdi>a@b.test</bdi> at {place}.');
  });
});
