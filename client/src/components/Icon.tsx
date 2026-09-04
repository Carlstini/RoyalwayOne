interface Props { name: string; size?: number; className?: string }

/** Single-stroke icon set, kept minimal and consistent. */
const PATHS: Record<string, string> = {
  document: 'M6 2h7l5 5v15H6z M13 2v5h5',
  compress: 'M4 9h6V3 M20 15h-6v6 M10 9L3 2 M14 15l7 7',
  merge: 'M4 4h7v7H4z M13 13h7v7h-7z M11 8h5v5',
  split: 'M12 3v6 M12 15v6 M5 12h14 M9 8l3-3 3 3',
  pages: 'M8 3h9v14H8z M5 7v14h9',
  trash: 'M4 6h16 M9 6V4h6v2 M6 6l1 15h10l1-15',
  grid: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  rotate: 'M20 12a8 8 0 1 1-3-6.2 M20 4v5h-5',
  lock: 'M6 11h12v10H6z M9 11V7a3 3 0 0 1 6 0v4',
  unlock: 'M6 11h12v10H6z M9 11V7a3 3 0 0 1 5.6-1.5',
  hash: 'M5 9h14 M5 15h14 M10 3L8 21 M16 3l-2 18',
  stamp: 'M5 20h14 M8 16h8l-1-5a3 3 0 0 0-6 0z M12 11V6',
  crop: 'M6 2v16h16 M2 6h16v16',
  wrench: 'M14 6a4 4 0 1 0 4 4l3.5 3.5-3 3L15 13a4 4 0 0 1-1-7z M9 9L3 15l3 3 6-6',
  scan: 'M3 7V4h4 M17 4h4v3 M21 17v3h-4 M7 20H3v-3 M3 12h18',
  pen: 'M4 20l4-1 11-11-3-3L5 16z M15 5l3 3',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  word: 'M6 2h7l5 5v15H6z M9 11l2 7 1-5 1 5 2-7',
  excel: 'M6 2h7l5 5v15H6z M9 11l6 7 M15 11l-6 7',
  slides: 'M3 4h18v12H3z M12 16v4 M8 20h8',
  image: 'M3 4h18v16H3z M8 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4 M3 17l6-5 5 4 3-2 4 4',
  pdf: 'M6 2h7l5 5v15H6z M9 12h2a1.5 1.5 0 0 1 0 3H9v3 M14 12h3',
  code: 'M8 6l-5 6 5 6 M16 6l5 6-5 6',
  swap: 'M4 8h13l-3-3 M20 16H7l3 3',
  resize: 'M4 4h7v7H4z M14 14h6v6h-6z M11 11l3 3',
  music: 'M9 18V5l11-2v13 M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0 M20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  scissors: 'M6 6l12 12 M18 6L6 18 M8 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0 M8 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0',
  volume: 'M4 9h4l5-4v14l-5-4H4z M17 8a5 5 0 0 1 0 8',
  speed: 'M12 20a8 8 0 1 1 8-8 M12 12l5-3',
  reverse: 'M20 12a8 8 0 1 1-2.3-5.6 M20 3v5h-5',
  mic: 'M12 4a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V7a3 3 0 0 1 3-3z M5 11a7 7 0 0 0 14 0 M12 18v3',
  video: 'M3 6h13v12H3z M16 10l5-3v10l-5-3',
  record: 'M3 6h13v12H3z M16 10l5-3v10l-5-3 M9 12a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3',
  text: 'M4 6h16 M9 6v14 M15 6v14',
  waveform: 'M3 12h2 M7 7v10 M11 4v16 M15 8v8 M19 11v2 M21 12h1',
  link: 'M10 14a4 4 0 0 0 6 .5l2-2a4 4 0 0 0-5.5-5.5L11 8.5 M14 10a4 4 0 0 0-6-.5l-2 2A4 4 0 0 0 11.5 17l1.5-1.5',
  sparkle: 'M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z',
  briefcase: 'M3 8h18v12H3z M8 8V5h8v3 M3 13h18',
  list: 'M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01',
  check: 'M4 12l5 5L20 6',
  gavel: 'M6 18h9 M13 4l6 6 M16 3l5 5-3 3-5-5z M11 8l-6 6 3 3 6-6',
  lightbulb: 'M9 18h6 M10 21h4 M12 3a6 6 0 0 1 3.5 10.9V16h-7v-2.1A6 6 0 0 1 12 3z',
  notes: 'M6 2h12v20H6z M9 7h6 M9 11h6 M9 15h4',
  mail: 'M3 5h18v14H3z M3 6l9 7 9-7',
  clipboard: 'M8 4h8v3H8z M6 5H4v17h16V5h-2',
  table: 'M3 4h18v16H3z M3 10h18 M9 10v10',
  search: 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14z M16 16l5 5',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M4 21a8 8 0 0 1 16 0',
  chart: 'M4 20V10 M10 20V4 M16 20v-7 M22 20H2',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18 M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18 M3 12h18 M12 3a15 15 0 0 1 0 18 M12 3a15 15 0 0 0 0 18',
  compare: 'M12 3v18 M7 8L3 12l4 4 M17 8l4 4-4 4',
  chat: 'M4 5h16v11H9l-5 4z',
  workflow: 'M4 5h6v5H4z M14 14h6v5h-6z M7 10v4h7',
  send: 'M3 12l18-8-7 18-3-7z',
  download: 'M12 4v11 M8 12l4 4 4-4 M4 20h16',
  copy: 'M9 9h11v11H9z M5 15H4V4h11v1',
  close: 'M6 6l12 12 M18 6L6 18',
  menu: 'M4 7h16 M4 12h16 M4 17h16',
  plus: 'M12 5v14 M5 12h14',
  arrow: 'M5 12h14 M13 6l6 6-6 6',
  upload: 'M12 16V5 M8 9l4-4 4 4 M4 20h16',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18 M12 11v6 M12 8h.01',
  play: 'M7 4l12 8-12 8z',
  refresh: 'M20 12a8 8 0 1 1-2.3-5.6 M20 3v5h-5',
};

export function Icon({ name, size = 20, className }: Props) {
  const d = PATHS[name] ?? PATHS.document;
  return (
    <svg
      className={className} width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false"
    >
      {d.split(' M').map((segment, i) => (
        <path key={i} d={i === 0 ? segment : `M${segment}`} />
      ))}
    </svg>
  );
}
