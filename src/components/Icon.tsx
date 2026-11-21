import type { ReactNode } from 'react';

export type IconName =
  | 'home'
  | 'parcels'
  | 'analysis'
  | 'bell'
  | 'user'
  | 'drop'
  | 'chevron-right'
  | 'plus'
  | 'check'
  | 'alert'
  | 'cloud'
  | 'file'
  | 'info'
  | 'leaf'
  | 'calendar'
  | 'arrow-right'
  | 'settings'
  | 'pin'
  | 'printer'
  | 'x';

/** Proste ikony liniowe 24×24 (własne, bez zewnętrznej biblioteki). */
const PATHS: Record<IconName, ReactNode> = {
  home: (
    <>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h5v-6h4v6h5V9.5" />
    </>
  ),
  parcels: (
    <>
      <path d="M9 4 3 6.5v13.5L9 17.5l6 2.5 6-2.5V4l-6 2.5L9 4z" />
      <path d="M9 4v13.5M15 6.5V20" />
    </>
  ),
  analysis: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.5 15.5 5 5" />
      <path d="M10.5 7c1.8 2.3 3 3.9 3 5.4a3 3 0 0 1-6 0c0-1.5 1.2-3.1 3-5.4z" />
    </>
  ),
  bell: (
    <>
      <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16z" />
      <path d="M10 20.5a2 2 0 0 0 4 0" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1.2-4 4.2-6 8-6s6.8 2 8 6" />
    </>
  ),
  drop: <path d="M12 3c4 5.3 6.5 8.8 6.5 12a6.5 6.5 0 0 1-13 0C5.5 11.8 8 8.3 12 3z" />,
  'chevron-right': <path d="m9 5 7 7-7 7" />,
  plus: <path d="M12 5v14M5 12h14" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  alert: (
    <>
      <path d="M12 3.5 2.5 20h19L12 3.5z" />
      <path d="M12 10v4.5M12 17.5v.01" />
    </>
  ),
  cloud: <path d="M7 18.5h10.5a4 4 0 0 0 .4-8A6 6 0 0 0 6.3 9.3 4.6 4.6 0 0 0 7 18.5z" />,
  file: (
    <>
      <path d="M14 3H6.5v18h11V6.5L14 3z" />
      <path d="M14 3v3.5h3.5M9 12h6M9 15.5h6" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5M12 7.5v.01" />
    </>
  ),
  leaf: (
    <>
      <path d="M5 19c0-8 5-13 15-14-1 10-6 15-14 15" />
      <path d="M5 19c3-4 6-7 10-9" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="1.5" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4" />
    </>
  ),
  'arrow-right': <path d="M4 12h15M13 6l6 6-6 6" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z" />
      <circle cx="12" cy="10" r="2.3" />
    </>
  ),
  printer: (
    <>
      <path d="M7 8V3.5h10V8" />
      <rect x="3.5" y="8" width="17" height="8.5" rx="1.5" />
      <path d="M7 14h10v6.5H7z" />
    </>
  ),
  x: <path d="M6 6l12 12M18 6 6 18" />,
};

export function Icon({ name, size = 20, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
