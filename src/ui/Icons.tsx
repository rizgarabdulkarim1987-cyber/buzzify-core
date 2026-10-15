import type { SVGProps } from 'react';

function base(props: SVGProps<SVGSVGElement>) {
  return {
    width: 20,
    height: 20,
    viewBox: '0 0 20 20',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    ...props,
  };
}

export const PlusIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base(props)}>
    <path d="M10 4v12M4 10h12" />
  </svg>
);

export const MinusIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base(props)}>
    <path d="M4 10h12" />
  </svg>
);

export const CloseIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base(props)}>
    <path d="M5 5l10 10M15 5L5 15" />
  </svg>
);

export const SearchIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base(props)}>
    <circle cx="9" cy="9" r="5" />
    <path d="M13 13l3.5 3.5" />
  </svg>
);

/** Points toward the start of the line and mirrors automatically in right-to-left layouts. */
export const BackIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base(props)} className={`rtl:rotate-180 ${props.className ?? ''}`}>
    <path d="M12 4l-6 6 6 6" />
  </svg>
);
