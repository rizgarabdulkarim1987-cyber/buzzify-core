import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureTracking, flushTracking, resetTrackingForTests, track } from '@/ui/analytics/track';

describe('analytics tracking', () => {
  const fetchMock = vi.fn((url: string, init?: { body?: string }) => {
    void url;
    void init;
    return Promise.resolve(new Response(null, { status: 204 }));
  });

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock.mockClear();
    vi.stubGlobal('fetch', fetchMock);
    resetTrackingForTests();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const lastBody = () => JSON.parse((fetchMock.mock.calls.at(-1)?.[1] as { body: string }).body);

  it('sends nothing before it is configured, then sends what was recorded in the meantime', () => {
    // A child component's mount effect runs before the provider that configures tracking, so early
    // events must be kept rather than dropped.
    track('MENU_VIEW');
    vi.advanceTimersByTime(5000);
    expect(fetchMock).not.toHaveBeenCalled();
    configureTracking({ slug: 'atelier', table: 4 });
    vi.advanceTimersByTime(2000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(lastBody().events.map((e: { type: string }) => e.type)).toEqual(['MENU_VIEW']);
    expect(lastBody().tableNumber).toBe(4);
  });

  it('bounds the number of events held before configuration', () => {
    for (let i = 0; i < 500; i += 1) track('PRODUCT_VIEW', { productId: `p${i}` });
    configureTracking({ slug: 'atelier', table: null });
    flushTracking();
    const sent = fetchMock.mock.calls.reduce(
      (total, call) => total + JSON.parse((call[1] as { body: string }).body).events.length,
      0,
    );
    expect(sent).toBeLessThanOrEqual(50);
  });

  it('batches events and sends them after two seconds', () => {
    configureTracking({ slug: 'atelier', table: 4 });
    track('MENU_VIEW');
    track('PRODUCT_VIEW', { productId: 'p1' });
    expect(fetchMock).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/atelier/events');
    const body = lastBody();
    expect(body.tableNumber).toBe(4);
    expect(body.anonymousSessionId.length).toBeGreaterThanOrEqual(8);
    expect(body.events.map((e: { type: string }) => e.type)).toEqual(['MENU_VIEW', 'PRODUCT_VIEW']);
  });

  it('flushes immediately at ten queued events', () => {
    configureTracking({ slug: 'atelier', table: null });
    for (let i = 0; i < 10; i += 1) track('PRODUCT_VIEW', { productId: `p${i}` });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(lastBody().events).toHaveLength(10);
  });

  it('records a once-only event a single time', () => {
    configureTracking({ slug: 'atelier', table: null });
    track('UPSELL_IMPRESSION', { suggestionId: 'up:1' }, { once: true });
    track('UPSELL_IMPRESSION', { suggestionId: 'up:1' }, { once: true });
    track('UPSELL_IMPRESSION', { suggestionId: 'up:2' }, { once: true });
    flushTracking();
    expect(lastBody().events).toHaveLength(2);
  });

  it('sends the QR code the menu was opened from with the first menu view, then takes it out of the address', () => {
    const replaceState = vi.fn();
    vi.stubGlobal('location', { href: 'https://menu.example.test/atelier/en/t/4?qr=cmvcode0001&utm_source=print#top' });
    vi.stubGlobal('history', { state: { key: 1 }, replaceState });
    configureTracking({ slug: 'atelier', table: 4 });
    track('MENU_VIEW', {}, { once: true });
    track('PRODUCT_VIEW', { productId: 'p1' });
    flushTracking();
    const [view, product] = lastBody().events;
    expect(view).toMatchObject({ type: 'MENU_VIEW', qrCodeId: 'cmvcode0001' });
    expect(product.qrCodeId).toBeUndefined();
    expect(replaceState).toHaveBeenCalledWith({ key: 1 }, '', '/atelier/en/t/4?utm_source=print#top');
  });

  it('ignores a qr parameter that is not a code id, so the batch is not refused', () => {
    vi.stubGlobal('location', { href: `https://menu.example.test/atelier/en?qr=${'x'.repeat(65)}` });
    vi.stubGlobal('history', { state: null, replaceState: vi.fn() });
    configureTracking({ slug: 'atelier', table: null });
    track('MENU_VIEW', {}, { once: true });
    flushTracking();
    expect(lastBody().events[0].qrCodeId).toBeUndefined();
  });

  it('never throws when the network fails', async () => {
    fetchMock.mockImplementationOnce(() => Promise.reject(new Error('offline')));
    configureTracking({ slug: 'atelier', table: null });
    track('MENU_VIEW');
    expect(() => flushTracking()).not.toThrow();
    await vi.runAllTimersAsync();
  });
});
