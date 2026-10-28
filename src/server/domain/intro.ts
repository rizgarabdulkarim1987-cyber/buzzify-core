/** The intro page's pure rules (docs/superpowers/specs/2026-10-29-menu-intro-design.md): which adverts are live, which links are safe. */

export interface AdvertWindow {
  id: string;
  active: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  sortOrder: number;
}

/** The adverts showing at `now`, in the order the restaurant set. A missing bound is open; the end is inclusive. */
export function introLiveFor<T extends AdvertWindow>(adverts: readonly T[], now: Date): T[] {
  const time = now.getTime();
  return adverts
    .filter((advert) => advert.active && (advert.startsAt === null || advert.startsAt.getTime() <= time) && (advert.endsAt === null || advert.endsAt.getTime() >= time))
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/** An advert may link to an https address or to a path on the menu. Anything else (script, data, http, protocol-relative) is dropped. */
export function safeHref(value: string): string {
  const href = value.trim();
  if (/^https:\/\/[^\s]+$/i.test(href)) return href;
  if (/^\/(?!\/)[^\s]*$/.test(href)) return href;
  return '';
}

/** How dark the gradient over the background is: a whole number from 0 to 100. */
export function validOverlay(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 100;
}
