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

  it('does nothing before it is configured', () => {
    track('MENU_VIEW');
    vi.advanceTimersByTime(5000);
    expect(fetchMock).not.toHaveBeenCalled();
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

  it('never throws when the network fails', async () => {
    fetchMock.mockImplementationOnce(() => Promise.reject(new Error('offline')));
    configureTracking({ slug: 'atelier', table: null });
    track('MENU_VIEW');
    expect(() => flushTracking()).not.toThrow();
    await vi.runAllTimersAsync();
  });
});
