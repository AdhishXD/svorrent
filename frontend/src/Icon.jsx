// Minimal 16px stroke icons. Kept inline so there are no icon-font or emoji dependencies.
const paths = {
  download: <><path d="M8 2.5v8" /><path d="M4.5 7.5 8 11l3.5-3.5" /><path d="M2.5 13.5h11" /></>,
  magnet: <><path d="M3.5 2.5v5a4.5 4.5 0 0 0 9 0v-5" /><path d="M3.5 5h3M9.5 5h3" /><path d="M6.5 2.5v5a1.5 1.5 0 0 0 3 0v-5" /></>,
  copy: <><rect x="5.5" y="5.5" width="8" height="8" rx="1" /><path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" /></>,
  file: <><path d="M9.5 1.5h-5a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-9z" /><path d="M9.5 1.5v3h3" /></>,
  pause: <><path d="M5.5 3v10M10.5 3v10" /></>,
  play: <path d="M4.5 2.75v10.5L13 8z" />,
  folder: <path d="M1.5 4a1 1 0 0 1 1-1h3.6l1.4 1.5h6a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z" />,
  info: <><circle cx="8" cy="8" r="6.5" /><path d="M8 7.25V11.5M8 4.75v.5" /></>,
  trash: <><path d="M2.5 4h11" /><path d="M6 4V2.5h4V4" /><path d="M3.75 4l.7 9.5h7.1l.7-9.5" /></>,
  x: <path d="M4 4l8 8M12 4l-8 8" />,
  search: <><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5 14 14" /></>,
  check: <path d="M3 8.5 6.5 12 13 4.5" />,
  external: <><path d="M9 2.5h4.5V7" /><path d="M13.5 2.5 7.5 8.5" /><path d="M11.5 9.5v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3" /></>,
  arrowDown: <path d="M8 3v10M4 9l4 4 4-4" />,
  arrowUp: <path d="M8 13V3M4 7l4-4 4 4" />,
  network: <><rect x="2" y="2" width="4" height="4" rx="0.5" /><rect x="10" y="2" width="4" height="4" rx="0.5" /><rect x="6" y="10" width="4" height="4" rx="0.5" /><path d="M4 6v2.5h8V6M8 8.5V10" /></>,
  wifi: <><path d="M2.5 5.5a8 8 0 0 1 11 0" /><path d="M5 8a4.5 4.5 0 0 1 6 0" /><circle cx="8" cy="11.5" r="0.75" fill="currentColor" /></>,
  activity: <path d="M2 8.5h2.5l2-5 3 9 2-5.5h2.5" />,
  refresh: <><path d="M2.5 8a5.5 5.5 0 0 1 9.3-3.9L13.5 6" /><path d="M13.5 2.5V6H10" /><path d="M13.5 8a5.5 5.5 0 0 1-9.3 3.9L2.5 10" /><path d="M2.5 13.5V10H6" /></>,
  globe: <><circle cx="8" cy="8" r="6" /><path d="M2 8h12M8 2a9 9 0 0 1 0 12M8 2a9 9 0 0 0 0 12" /></>,
  map: <><polygon points="1 3.5 5.5 1.5 10.5 3.5 15 1.5 15 12.5 10.5 14.5 5.5 12.5 1 14.5" /><line x1="5.5" y1="1.5" x2="5.5" y2="12.5" /><line x1="10.5" y1="3.5" x2="10.5" y2="14.5" /></>,
};

export function Icon({ name, size = 16, className = '' }) {
  return (
    <svg
      className={`icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
