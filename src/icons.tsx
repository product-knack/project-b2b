import React from 'react';
import Svg, { Path, Circle, Rect } from 'react-native-svg';

// All icon path data, lifted verbatim from the prototype's `ic` map.
export const ic = {
  calPlus: 'M4 6h16v15H4zM4 10h16M8 3v4M16 3v4M12 14v4M10 16h4',
  gift: 'M3 9h18v4H3zM5 13v8h14v-8M12 9v12M9 9C6 9 6 4 9 4s3 5 3 5M15 9c3 0 3-5 0-5s-3 5-3 5',
  checks: 'M2 13l4 4 8-9M11 16l1 1 9-10',
  alert: 'M12 4 2 20h20zM12 10v5M12 18h.01',
  bell: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0',
  msgAlert: 'M4 5h16v11H8l-4 4zM12 8v3M12 13h.01',
  clipboard: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M9 13h6M9 17h4',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  chat: 'M4 5h16v11H8l-4 4z',
  userCircle: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6.5 18a6 6 0 0 1 11 0',
  users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM2 20c0-3.5 3-5 7-5s7 1.5 7 5M16 4a3 3 0 0 1 0 6M18 15c3 0 4 1.5 4 5',
  dumbbell: 'M6 7v10M9 5v14M15 5v14M18 7v10M9 12h6',
  calendar: 'M4 6h16v15H4zM4 10h16M8 3v4M16 3v4',
  layers: 'M12 3 2 8l10 5 10-5zM2 14l10 5 10-5',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  chart: 'M4 20V4M4 20h16M8 16v-5M12 16V8M16 16v-8',
  heart: 'M12 20S4 14 4 8.5A3.5 3.5 0 0 1 12 6a3.5 3.5 0 0 1 8 2.5C20 14 12 20 12 20Z',
  activity: 'M3 12h4l3 8 4-16 3 8h4',
  shield: 'M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6z',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM12 12h.01',
  trend: 'M3 17 9 11l4 4 8-8M21 7v5M21 7h-5',
  map: 'M9 4 3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14',
  ruler: 'M4 16 16 4l4 4L8 20zM8 10l2 2M12 6l2 2M6 14l2 2',
  scale: 'M12 3v18M5 7h14M6 7 3 14h6zM18 7l-3 7h6z',
  pin: 'M12 21s7-6 7-11a7 7 0 1 0-14 0c0 5 7 11 7 11ZM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
  swap: 'M4 7h13l-3-3M20 17H7l3 3',
  crown: 'M5 18h14l1-9-5 4-3-7-3 7-5-4z',
  award: 'M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM9 12l-2 8 5-3 5 3-2-8',
  phone: 'M5 4h4l2 5-3 2a11 11 0 0 0 5 5l2-3 5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  userPlus: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM2 20c0-3.5 3-5 7-5M17 8v6M14 11h6',
  rupee: 'M7 4h10M7 8h10M15 4c0 5-3.5 6.5-8 6.5l8.5 8.5',
  route: 'M9 6a3 3 0 1 0 0-2M6 18a3 3 0 1 0 0 2M6 8v6a4 4 0 0 0 4 4h4a3 3 0 0 1 0-2',
  inbox: 'M4 13h4l2 3h4l2-3h4M4 13 6 5h12l2 8v6H4z',
  // extras used inline in the prototype
  chevDown: 'M6 9l6 6 6-6',
  chevRight: 'M9 6l6 6-6 6',
  chevLeft: 'M15 6l-6 6 6 6',
  chevUp: 'M18 15l-6-6-6 6',
  arrowLeft: 'M19 12H5M11 6l-6 6 6 6',
  arrowRight: 'M5 12h14M13 6l6 6-6 6',
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6 6 18',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z',
  search: 'M11 11m-7 0a7 7 0 1 0 14 0a7 7 0 1 0-14 0M20 20l-3.5-3.5',
  sparkle: 'M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z',
  clock: 'M12 13m-8 0a8 8 0 1 0 16 0a8 8 0 1 0-16 0M12 9v4l2 2M5 4 3 6M19 4l2 2',
  user: 'M12 8m-3.5 0a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0M5 20c0-3.5 3-5 7-5s7 1.5 7 5',
  file: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6',
  bars: 'M6 7v10M9 5v14M15 5v14M18 7v10M9 12h6',
  send: 'M22 2 11 13M22 2l-7 20-4-9-9-4z',
  bubble: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  atSign: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8',
  home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
} as const;

export type IconName = keyof typeof ic;

export function Icon({
  name,
  path,
  size = 20,
  color = '#fff',
  strokeWidth = 1.9,
  fill = 'none',
}: {
  name?: IconName;
  path?: string;
  size?: number;
  color?: string;
  strokeWidth?: number;
  fill?: string;
}) {
  const d = path ?? (name ? ic[name] : '');
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d={d}
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill={fill}
      />
    </Svg>
  );
}

// The hamburger / "more" glyph — two-tone, as in the header.
export function MenuIcon() {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Path d="M4 6.5h16" stroke="#F2F0EC" strokeWidth={2.4} strokeLinecap="round" />
      <Path d="M4 12h9" stroke="#F47A2A" strokeWidth={2.4} strokeLinecap="round" />
      <Path d="M4 17.5h16" stroke="#F2F0EC" strokeWidth={2.4} strokeLinecap="round" />
      <Circle cx={18} cy={12} r={1.5} fill="#F47A2A" />
    </Svg>
  );
}

// Trophy/leaderboard icon (multi-segment) used across leaderboard cards.
export function TrophyIcon({ size = 22, color = '#B49BFF' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M7 4h10v4a5 5 0 0 1-10 0ZM5 5H3v2a4 4 0 0 0 4 4M19 5h2v2a4 4 0 0 1-4 4M9 18h6M10 21h4M12 13v5"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export { Svg, Path, Circle, Rect };
