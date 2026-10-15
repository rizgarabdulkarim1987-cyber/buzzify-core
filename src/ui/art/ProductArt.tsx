import type { ReactNode } from 'react';
import type { ArtKind } from '@/lib/media';

interface Ids {
  metal: string;
  glass: string;
  shade: string;
}

const SHAPES: Record<ArtKind, (tone: string, ids: Ids) => ReactNode> = {
  cup: (tone, ids) => (
    <>
      <ellipse cx="100" cy="150" rx="62" ry="11" fill={`url(#${ids.metal})`} />
      <ellipse cx="100" cy="147" rx="46" ry="7" fill="#1B1A19" opacity=".35" />
      <path d="M58 92h84c0 36-14 58-42 58S58 128 58 92z" fill="#F4EFE6" />
      <path d="M58 92h84c0 36-14 58-42 58S58 128 58 92z" fill={`url(#${ids.shade})`} />
      <ellipse cx="100" cy="92" rx="42" ry="9" fill="#E9E1D3" />
      <ellipse cx="100" cy="93" rx="36" ry="6.5" fill={tone} />
      <path d="M141 100c18-2 22 16 8 24-5 3-10 4-15 4" fill="none" stroke="#F4EFE6" strokeWidth="6" strokeLinecap="round" />
      <path d="M70 100c2 20 10 34 22 40" stroke="#fff" strokeOpacity=".5" strokeWidth="3" fill="none" strokeLinecap="round" />
    </>
  ),
  glass: (tone, ids) => (
    <>
      <path d="M68 52h64l-8 100a8 8 0 0 1-8 7H84a8 8 0 0 1-8-7z" fill={`url(#${ids.glass})`} stroke="#fff" strokeOpacity=".35" />
      <path d="M73 88h54l-5 64a6 6 0 0 1-6 5H84a6 6 0 0 1-6-5z" fill={tone} opacity=".92" />
      <rect x="86" y="96" width="12" height="12" rx="3" fill="#fff" opacity=".35" transform="rotate(-12 92 102)" />
      <rect x="106" y="116" width="10" height="10" rx="3" fill="#fff" opacity=".3" transform="rotate(10 111 121)" />
      <path d="M116 40l12 52" stroke="#D6BC8A" strokeWidth="3" strokeLinecap="round" />
    </>
  ),
  plate: (tone, ids) => (
    <>
      <ellipse cx="100" cy="132" rx="78" ry="26" fill={`url(#${ids.metal})`} opacity=".9" />
      <ellipse cx="100" cy="128" rx="64" ry="20" fill="#F4EFE6" />
      <ellipse cx="100" cy="126" rx="46" ry="13" fill="#E9E1D3" />
      <ellipse cx="92" cy="116" rx="26" ry="14" fill={tone} />
      <ellipse cx="116" cy="122" rx="18" ry="10" fill={tone} opacity=".75" />
      <circle cx="80" cy="106" r="5" fill="#7C9B5A" />
      <circle cx="124" cy="112" r="4" fill="#7C9B5A" />
      <ellipse cx="88" cy="110" rx="12" ry="5" fill="#fff" opacity=".18" />
    </>
  ),
  pastry: (tone, ids) => (
    <>
      <ellipse cx="100" cy="150" rx="60" ry="10" fill={`url(#${ids.metal})`} />
      <rect x="58" y="112" width="84" height="30" rx="8" fill="#E6C98F" />
      <rect x="58" y="92" width="84" height="22" rx="8" fill={tone} />
      <rect x="58" y="76" width="84" height="18" rx="8" fill="#F4EFE6" />
      <rect x="58" y="62" width="84" height="16" rx="8" fill={tone} opacity=".9" />
      <path d="M70 66c14-8 46-8 60 0" stroke="#fff" strokeOpacity=".4" strokeWidth="3" fill="none" strokeLinecap="round" />
      <path d="M96 56l8-8 8 8-8 6z" fill="#D6BC8A" />
    </>
  ),
  bowl: (tone, ids) => (
    <>
      <path d="M46 98h108c0 38-22 58-54 58S46 136 46 98z" fill="#F4EFE6" />
      <path d="M46 98h108c0 38-22 58-54 58S46 136 46 98z" fill={`url(#${ids.shade})`} />
      <ellipse cx="100" cy="98" rx="54" ry="10" fill="#E9E1D3" />
      <path d="M52 98c10-26 30-34 48-34s38 8 48 34z" fill={tone} />
      <circle cx="82" cy="84" r="5" fill="#fff" opacity=".35" />
      <circle cx="116" cy="78" r="6" fill="#7C9B5A" />
      <circle cx="102" cy="90" r="4" fill="#D6BC8A" />
    </>
  ),
  burger: (tone, ids) => (
    <>
      <ellipse cx="100" cy="152" rx="60" ry="9" fill={`url(#${ids.metal})`} />
      <path d="M50 118h100a8 8 0 0 1 0 22H50a8 8 0 0 1 0-22z" fill="#C98F4A" />
      <rect x="48" y="104" width="104" height="16" rx="8" fill="#4A2C21" />
      <path d="M46 104h108l-8 10h-22l-10 8-10-8H62z" fill="#E5C14B" />
      <path d="M46 98c4-8 12-8 18-4 6-6 14-6 20 0 6-6 14-6 20 0 6-6 14-6 20 0 6-4 14-4 20 4z" fill="#7C9B5A" />
      <path d="M48 90c0-30 24-46 52-46s52 16 52 46z" fill={tone} />
      <path d="M70 62c8-8 22-10 34-8" stroke="#fff" strokeOpacity=".4" strokeWidth="4" fill="none" strokeLinecap="round" />
      <circle cx="86" cy="70" r="2.5" fill="#F4EFE6" />
      <circle cx="112" cy="64" r="2.5" fill="#F4EFE6" />
      <circle cx="128" cy="76" r="2.5" fill="#F4EFE6" />
    </>
  ),
};

/** Art-directed placeholder still life. Real photography replaces it through the product's media list. */
export function ProductArt({
  kind,
  tone,
  uid,
  className,
}: {
  kind: ArtKind;
  tone: string;
  uid: string;
  className?: string;
}) {
  const ids: Ids = { metal: `${uid}-metal`, glass: `${uid}-glass`, shade: `${uid}-shade` };
  return (
    <svg viewBox="0 0 200 200" aria-hidden="true" className={className} preserveAspectRatio="xMidYMid slice">
      <defs>
        <radialGradient id={`${uid}-bg`} cx="50%" cy="38%" r="75%">
          <stop offset="0" stopColor="#3A3633" />
          <stop offset="1" stopColor="#1B1A19" />
        </radialGradient>
        <linearGradient id={ids.metal} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#F2E4C4" />
          <stop offset=".5" stopColor="#D6BC8A" />
          <stop offset="1" stopColor="#8F7648" />
        </linearGradient>
        <linearGradient id={ids.glass} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity=".28" />
          <stop offset=".5" stopColor="#fff" stopOpacity=".06" />
          <stop offset="1" stopColor="#fff" stopOpacity=".2" />
        </linearGradient>
        <linearGradient id={ids.shade} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity=".35" />
        </linearGradient>
      </defs>
      <rect width="200" height="200" fill={`url(#${uid}-bg)`} />
      <ellipse cx="100" cy="162" rx="64" ry="9" fill="#000" opacity=".4" />
      {SHAPES[kind](tone, ids)}
    </svg>
  );
}
