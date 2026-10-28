import { describe, expect, it } from 'vitest';
import { introLiveFor, safeHref, validOverlay } from '@/server/domain/intro';

const at = (iso: string) => new Date(iso);
const advert = (over: Partial<{ id: string; active: boolean; startsAt: Date | null; endsAt: Date | null; sortOrder: number }> = {}) => ({
  id: 'a', active: true, startsAt: null, endsAt: null, sortOrder: 0, ...over,
});

describe('introLiveFor', () => {
  const now = at('2026-10-29T12:00:00Z');

  it('keeps active adverts inside their window, in sort order', () => {
    const live = introLiveFor(
      [advert({ id: 'b', sortOrder: 2 }), advert({ id: 'a', sortOrder: 1, startsAt: at('2026-10-29T00:00:00Z'), endsAt: at('2026-10-30T00:00:00Z') })],
      now,
    );
    expect(live.map((a) => a.id)).toEqual(['a', 'b']);
  });

  it('drops ended, not yet started and inactive adverts, and treats a missing bound as open', () => {
    const live = introLiveFor(
      [
        advert({ id: 'ended', endsAt: at('2026-10-29T11:59:59Z') }),
        advert({ id: 'later', startsAt: at('2026-10-29T12:00:01Z') }),
        advert({ id: 'off', active: false }),
        advert({ id: 'open-start', endsAt: at('2026-10-29T12:00:00Z') }),
        advert({ id: 'open-end', startsAt: at('2026-10-29T12:00:00Z') }),
      ],
      now,
    );
    expect(live.map((a) => a.id).sort()).toEqual(['open-end', 'open-start']);
  });
});

describe('safeHref', () => {
  it('allows https addresses and paths on the menu and nothing else', () => {
    expect(safeHref('https://example.com/x')).toBe('https://example.com/x');
    expect(safeHref('/menu/ar')).toBe('/menu/ar');
    expect(safeHref('  https://example.com  ')).toBe('https://example.com');
    for (const bad of ['javascript:alert(1)', 'http://example.com', '//evil.example', 'data:text/html,x', 'mailto:a@b.c', '']) expect(safeHref(bad), bad).toBe('');
  });
});

describe('validOverlay', () => {
  it('is a whole number from 0 to 100', () => {
    expect([0, 50, 100].every(validOverlay)).toBe(true);
    expect([-1, 101, 50.5, Number.NaN].some(validOverlay)).toBe(false);
  });
});
