import { LOCALES, type Locale } from '@/lib/locale';

export const TITLE_MAX = 120;
export const BODY_MAX = 2000;

export type Localised = Partial<Record<Locale, string>>;

const clean = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** The text for a viewer: their language, else the first language (in the platform's order) that has any. */
export function pickLocalised(map: unknown, locale: Locale): string {
  const source = (map && typeof map === 'object' ? map : {}) as Record<string, unknown>;
  const own = clean(source[locale]);
  if (own) return own;
  for (const other of LOCALES) {
    const text = clean(source[other]);
    if (text) return text;
  }
  return '';
}

/**
 * One announcement for a viewer, in a single language so a title is never in one and its body in another: the viewer's
 * language if it has both, else the first language that has both. Null when no language has both.
 */
export function pickAnnouncement(titles: unknown, bodies: unknown, locale: Locale): { title: string; body: string } | null {
  const t = (titles && typeof titles === 'object' ? titles : {}) as Record<string, unknown>;
  const b = (bodies && typeof bodies === 'object' ? bodies : {}) as Record<string, unknown>;
  for (const candidate of [locale, ...LOCALES]) {
    const title = clean(t[candidate]);
    const body = clean(b[candidate]);
    if (title && body) return { title, body };
  }
  return null;
}

export interface ActiveAnnouncement {
  id: string;
  title: string;
  body: string;
  /** ISO time after which it is no longer shown; null while open-ended. */
  endsAt: string | null;
}

export interface AnnouncementRow {
  id: string;
  titles: Record<string, string>;
  bodies: Record<string, string>;
  startsAt: string;
  endsAt: string | null;
  status: 'scheduled' | 'live' | 'ended';
}
