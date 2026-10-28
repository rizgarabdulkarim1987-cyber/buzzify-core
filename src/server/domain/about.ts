/** The About (guest-titled "Explore") page's pure rules (docs/superpowers/specs/2026-10-29-menu-about-tab-design.md). */
import { DAYS, readWorkingHours, type Day } from './restaurant-profile';
import { safeHref } from './intro';

export const MAX_STORY_BLOCKS = 40;
export const MAX_BLOCK_CHARS = 2000;
export const MAX_LIST_ITEMS = 40;
export const MAX_BLOCK_LINKS = 10;

export interface StoryLink {
  text: string;
  href: string;
}

/** A heading or paragraph holds one string, a list holds its items. Links are listed apart and shown by the page, never parsed from the text. */
export type StoryBlock =
  | { type: 'heading' | 'paragraph'; text: string; links?: StoryLink[] }
  | { type: 'list'; text: string[]; links?: StoryLink[] };

export type StoryByLocale = Partial<Record<'en' | 'ar' | 'ckb', StoryBlock[]>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function line(value: unknown): string {
  if (typeof value !== 'string' || value.length > MAX_BLOCK_CHARS) throw new Error('A story line is too long or not text.');
  return value;
}

function linksOf(value: unknown): StoryLink[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > MAX_BLOCK_LINKS) throw new Error('A story block has too many links.');
  return value.map((entry) => {
    if (!isRecord(entry) || Object.keys(entry).some((key) => key !== 'text' && key !== 'href')) throw new Error('Invalid story link.');
    const text = line(entry.text).trim();
    const href = typeof entry.href === 'string' ? safeHref(entry.href) : '';
    if (!text || !href) throw new Error('A story link needs text and an https address or a path on the menu.');
    return { text, href };
  });
}

/** Validates the story the restaurant sent and returns it in its stored shape. Throws on anything else: there is no best-effort repair. */
export function cleanStory(blocks: unknown): StoryBlock[] {
  if (!Array.isArray(blocks) || blocks.length > MAX_STORY_BLOCKS) throw new Error(`A story has at most ${MAX_STORY_BLOCKS} blocks.`);
  return blocks.map((block): StoryBlock => {
    if (!isRecord(block) || Object.keys(block).some((key) => key !== 'type' && key !== 'text' && key !== 'links')) throw new Error('Invalid story block.');
    const links = linksOf(block.links);
    const extra = links && links.length > 0 ? { links } : {};
    if (block.type === 'heading' || block.type === 'paragraph') return { type: block.type, text: line(block.text), ...extra };
    if (block.type === 'list') {
      if (!Array.isArray(block.text) || block.text.length > MAX_LIST_ITEMS) throw new Error('A list has too many items.');
      return { type: 'list', text: block.text.map(line), ...extra };
    }
    throw new Error('Unknown story block type.');
  });
}

export interface OfferWindow {
  id: string;
  active: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  sortOrder: number;
}

/**
 * The offers showing at `now`, in the order the restaurant set. A missing bound is open, the end is inclusive.
 * Bounds are instants: Studio turns the dates the restaurant types into instants in the menu's own time zone before saving.
 */
export function offersLiveFor<T extends OfferWindow>(offers: readonly T[], now: Date): T[] {
  const time = now.getTime();
  return offers
    .filter((offer) => offer.active && (offer.startsAt === null || offer.startsAt.getTime() <= time) && (offer.endsAt === null || offer.endsAt.getTime() >= time))
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/** True when the page has nothing to show: no cover, no story in any language, no gallery photo and no live offer. */
export function aboutIsEmpty(
  about: { story: unknown; coverAssetId: string | null; galleryAssetIds: readonly string[] } | null,
  liveOffers: readonly unknown[],
): boolean {
  if (liveOffers.length > 0) return false;
  if (!about) return true;
  if (about.coverAssetId || about.galleryAssetIds.length > 0) return false;
  if (!isRecord(about.story)) return true;
  return !Object.values(about.story).some((blocks) => Array.isArray(blocks) && blocks.length > 0);
}

export interface HoursRow {
  day: Day;
  ranges: { open: string; close: string; overnight: boolean }[];
}

/** The week as rows, Monday first; null when no day has a range. A range that closes before it opens runs past midnight. */
export function hoursView(workingHours: unknown): HoursRow[] | null {
  const hours = readWorkingHours(workingHours);
  const rows = DAYS.map((day): HoursRow => ({
    day,
    ranges: hours[day].map(([open, close]) => ({ open, close, overnight: close < open })),
  }));
  return rows.some((row) => row.ranges.length > 0) ? rows : null;
}
