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

export const HeartIcon = ({ filled = false, ...props }: SVGProps<SVGSVGElement> & { filled?: boolean }) => (
  <svg {...base(props)} fill={filled ? 'currentColor' : 'none'}>
    <path d="M10 16.5s-6-3.6-6-8.1A3.4 3.4 0 0 1 10 6a3.4 3.4 0 0 1 6 2.4c0 4.5-6 8.1-6 8.1z" />
  </svg>
);

export const ChevronDownIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base(props)}>
    <path d="M5 8l5 5 5-5" />
  </svg>
);

/** Points toward the end of the line and mirrors automatically in right-to-left layouts. */
export const ForwardIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base(props)} className={`rtl:rotate-180 ${props.className ?? ''}`}>
    <path d="M8 4l6 6-6 6" />
  </svg>
);

export const ListIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base(props)}>
    <path d="M4 6h12M4 10h12M4 14h8" />
  </svg>
);

export const ClockIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base(props)}>
    <circle cx="10" cy="10" r="6.5" />
    <path d="M10 6.5V10l2.5 1.5" />
  </svg>
);

export const PinIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base(props)}>
    <path d="M10 17s-5-4.6-5-8.5a5 5 0 0 1 10 0C15 12.4 10 17 10 17z" />
    <circle cx="10" cy="8.5" r="1.8" />
  </svg>
);

export const PhoneIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base(props)}>
    <path d="M6.6 3.5H4.8A1.3 1.3 0 0 0 3.5 5c.4 6.1 5.4 11.1 11.5 11.5a1.3 1.3 0 0 0 1.5-1.3v-1.8l-3-1.3-1.5 1.5a8 8 0 0 1-4.1-4.1l1.5-1.5z" />
  </svg>
);

export const ChatIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base(props)}>
    <path d="M10 3.5a6.5 6.5 0 0 0-5.7 9.6L3.5 16.5l3.5-.8A6.5 6.5 0 1 0 10 3.5z" />
    <path d="M7.6 8.2c.3 1.6 2.6 3.9 4.2 4.2" />
  </svg>
);

export const GlobeIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base(props)}>
    <circle cx="10" cy="10" r="6.5" />
    <path d="M3.5 10h13M10 3.5c1.8 2 2.6 4.1 2.6 6.5s-.8 4.5-2.6 6.5c-1.8-2-2.6-4.1-2.6-6.5S8.2 5.5 10 3.5z" />
  </svg>
);

export const CameraIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base(props)}>
    <rect x="3.5" y="3.5" width="13" height="13" rx="3.5" />
    <circle cx="10" cy="10" r="3" />
    <path d="M13.6 6.4h.01" />
  </svg>
);

export const PauseIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base(props)}>
    <path d="M7.5 5v10M12.5 5v10" />
  </svg>
);

export const PlayIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base(props)}>
    <path d="M7 5l8 5-8 5z" />
  </svg>
);
