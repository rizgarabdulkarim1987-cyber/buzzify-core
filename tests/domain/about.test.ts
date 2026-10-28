import { describe, expect, it } from 'vitest';
import { aboutIsEmpty, cleanStory, hoursView, offersLiveFor } from '@/server/domain/about';

const at = (iso: string) => new Date(iso);
const offer = (over: Partial<{ id: string; active: boolean; startsAt: Date | null; endsAt: Date | null; sortOrder: number }> = {}) => ({
  id: 'o', active: true, startsAt: null, endsAt: null, sortOrder: 0, ...over,
});

describe('cleanStory', () => {
  it('accepts headings, paragraphs and lists and rejects html-looking block types, 41 blocks and 2001 characters', () => {
    expect(
      cleanStory([
        { type: 'heading', text: 'Our story' },
        { type: 'paragraph', text: 'Since 1990.' },
        { type: 'list', text: ['Fresh', 'Local'] },
      ]),
    ).toHaveLength(3);
    expect(() => cleanStory([{ type: 'script', text: 'x' }])).toThrow();
    expect(() => cleanStory([{ type: 'paragraph', text: '<b>x</b>', html: true }])).toThrow();
    expect(() => cleanStory(Array.from({ length: 41 }, () => ({ type: 'paragraph', text: 'a' })))).toThrow();
    expect(() => cleanStory([{ type: 'paragraph', text: 'a'.repeat(2001) }])).toThrow();
    expect(cleanStory(Array.from({ length: 40 }, () => ({ type: 'paragraph', text: 'a'.repeat(2000) })))).toHaveLength(40);
    expect(() => cleanStory('nope')).toThrow();
    expect(() => cleanStory([{ type: 'list', text: 'not an array' }])).toThrow();
    expect(() => cleanStory([{ type: 'paragraph', text: ['array'] }])).toThrow();
  });

  it('refuses a link that is not https or a path', () => {
    const ok = cleanStory([{ type: 'paragraph', text: 'Visit us', links: [{ text: 'us', href: 'https://example.com/a' }, { text: 'menu', href: '/hall' }] }]);
    expect(ok[0]).toMatchObject({ links: [{ text: 'us', href: 'https://example.com/a' }, { text: 'menu', href: '/hall' }] });
    for (const href of ['javascript:alert(1)', 'http://example.com', '//evil.com', 'data:text/html,x']) {
      expect(() => cleanStory([{ type: 'paragraph', text: 'x', links: [{ text: 'x', href }] }])).toThrow();
    }
  });
});

describe('offersLiveFor', () => {
  const now = at('2026-10-29T12:00:00Z');

  it("respects start and end and the active flag, in the order the restaurant set", () => {
    const live = offersLiveFor(
      [
        offer({ id: 'late', sortOrder: 3, startsAt: at('2026-10-30T00:00:00Z') }),
        offer({ id: 'old', sortOrder: 0, endsAt: at('2026-10-29T11:59:59Z') }),
        offer({ id: 'off', sortOrder: 1, active: false }),
        offer({ id: 'b', sortOrder: 2 }),
        offer({ id: 'a', sortOrder: 1, startsAt: at('2026-10-29T12:00:00Z'), endsAt: at('2026-10-29T12:00:00Z') }),
      ],
      now,
    );
    expect(live.map((o) => o.id)).toEqual(['a', 'b']);
  });
});

describe('aboutIsEmpty', () => {
  const blank = { story: {}, coverAssetId: null, galleryAssetIds: [] as string[] };

  it('is true with no story, offers or gallery', () => {
    expect(aboutIsEmpty(blank, [])).toBe(true);
    expect(aboutIsEmpty(null, [])).toBe(true);
    expect(aboutIsEmpty({ ...blank, story: { en: [], ar: [] } }, [])).toBe(true);
  });

  it('is false once anything is filled in', () => {
    expect(aboutIsEmpty({ ...blank, story: { ar: [{ type: 'paragraph', text: 'x' }] } }, [])).toBe(false);
    expect(aboutIsEmpty({ ...blank, galleryAssetIds: ['a'] }, [])).toBe(false);
    expect(aboutIsEmpty({ ...blank, coverAssetId: 'a' }, [])).toBe(false);
    expect(aboutIsEmpty(blank, [offer()])).toBe(false);
  });
});

describe('hoursView', () => {
  it('formats overnight ranges and returns null for an empty week', () => {
    expect(hoursView({})).toBeNull();
    expect(hoursView(null)).toBeNull();
    const view = hoursView({ mon: [['09:00', '12:00'], ['18:00', '02:00']], fri: [['10:00', '23:00']] });
    expect(view).toHaveLength(7);
    expect(view?.[0]).toEqual({ day: 'mon', ranges: [{ open: '09:00', close: '12:00', overnight: false }, { open: '18:00', close: '02:00', overnight: true }] });
    expect(view?.[1]).toEqual({ day: 'tue', ranges: [] });
    expect(JSON.stringify(view)).not.toContain('NaN');
  });

  it('drops malformed ranges instead of printing NaN', () => {
    const view = hoursView({ mon: [['9', 'x'], ['10:00', '11:00']] });
    expect(view?.[0]?.ranges).toEqual([{ open: '10:00', close: '11:00', overnight: false }]);
  });
});
