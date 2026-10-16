import type { StaticImageData } from 'next/image';
import type { SVGProps } from 'react';
import type { RailDish } from '@/lib/rail';
import dishes from './dishes.svg';

// The drawings live in one cached file rather than in every menu page: drawn inline, the deck's icons pushed the
// page's compressed HTML past the first TCP window, which cost a whole round trip before the menu could paint.
const sprite = (dishes as StaticImageData).src;

/** A small line drawing of a category's dish, in the same hand as the other icons. */
export function DishIcon({ dish, ...props }: { dish: RailDish } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={22}
      height={22}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <use href={`${sprite}#${dish}`} />
    </svg>
  );
}
