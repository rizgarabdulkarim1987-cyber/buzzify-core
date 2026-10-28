import type { WheelSliceView } from '@/server/data/wheel';
import { SPIN_MS } from './useWheel';

const R = 100;

/** One wedge, drawn pointing up from the centre and clipped to its own shape. Rotated into place by the caller. */
function wedge(count: number): { path: string; width: number } {
  const half = Math.PI / count;
  const x = R * Math.sin(half);
  const y = R * Math.cos(half);
  return { path: `M0 0 L${-x.toFixed(3)} ${-y.toFixed(3)} A${R} ${R} 0 0 1 ${x.toFixed(3)} ${-y.toFixed(3)} Z`, width: 2 * x };
}

/**
 * The disc: each slice is its dish's photo, upright and pointing outward, with the pointer fixed at the top. No text on the disc, so a
 * long name cannot break it and the Arabic and Kurdish pages need no mirrored labels; names come with the result. The disc is turned with CSS.
 */
export function WheelDisc({ slices, rotation, spinning, reduced }: { slices: WheelSliceView[]; rotation: number; spinning: boolean; reduced: boolean }) {
  const count = slices.length;
  const { path, width } = wedge(count);
  const step = 360 / count;
  const style = {
    transform: `rotate(${rotation}deg)`,
    ...(reduced ? {} : { transition: spinning ? `transform ${SPIN_MS}ms cubic-bezier(0.12, 0.7, 0.1, 1)` : 'none' }),
  };
  return (
    <div dir="ltr" className="relative mx-auto aspect-square w-full max-w-[22rem]">
      <div style={style} className="size-full">
        <svg viewBox={`${-R - 2} ${-R - 2} ${2 * R + 4} ${2 * R + 4}`} role="img" aria-label={slices.map((slice) => slice.name).join(', ')} className="size-full overflow-visible drop-shadow-sm">
          <defs>
            {slices.map((slice, index) => (
              <clipPath key={slice.productId} id={`wheel-clip-${index}`}>
                <path d={path} />
              </clipPath>
            ))}
          </defs>
          <circle r={R + 2} className="fill-raised stroke-line" strokeWidth={1} />
          {slices.map((slice, index) => (
            <g key={slice.productId} transform={`rotate(${((index + 0.5) * step).toFixed(3)})`}>
              <image
                href={slice.photo.url}
                x={-width / 2}
                y={-R}
                width={width}
                height={R}
                preserveAspectRatio="xMidYMid slice"
                clipPath={`url(#wheel-clip-${index})`}
              />
              <path d={path} className="fill-none stroke-bg" strokeWidth={1.5} />
            </g>
          ))}
          <circle r={9} className="fill-bg stroke-line" strokeWidth={1} />
        </svg>
      </div>
      <svg viewBox="-12 -2 24 22" aria-hidden className="pointer-events-none absolute start-1/2 top-0 w-7 -translate-x-1/2 -translate-y-1/3 rtl:translate-x-1/2">
        <path d="M-10 0 L10 0 L0 18 Z" className="fill-accent stroke-bg" strokeWidth={1.5} strokeLinejoin="round" />
      </svg>
    </div>
  );
}
