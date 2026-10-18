import type { MotionCategory, MotionMeta } from '@/motion/types';

export interface MotionFilter {
  q: string;
  category: MotionCategory | 'all';
}

/** Arabic-Indic (٠–٩) and Persian (۰–۹) digits as Latin ones: a number typed on an Arabic keyboard finds its motion. */
function latinDigits(text: string): string {
  return text.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/**
 * The motions a search shows, in the list's order: those of the chosen group whose name (in the Studio's language, from
 * `nameOf`) or id holds every word typed. A number, with or without `#`, finds the motion with that number.
 */
export function filterMotions(motions: readonly MotionMeta[], filter: MotionFilter, nameOf: (id: string) => string): MotionMeta[] {
  const inGroup = filter.category === 'all' ? [...motions] : motions.filter((motion) => motion.category === filter.category);
  const query = latinDigits(filter.q).trim().toLocaleLowerCase();
  if (query === '') return inGroup;

  const number = query.replace(/^#/, '');
  if (/^\d+$/.test(number)) return inGroup.filter((motion) => motion.number === Number(number));

  const words = query.split(/\s+/).filter(Boolean);
  return inGroup.filter((motion) => {
    const haystack = `${nameOf(motion.id)} ${motion.id.replace(/-/g, ' ')}`.toLocaleLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}
