import React from 'react';
import Svg, { Circle, Line, Path, Polyline, Rect } from 'react-native-svg';

interface AppLogoProps {
  size?: number;
}

export function AppLogo({ size = 32 }: AppLogoProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" accessibilityRole="image">
      <Rect x="4" y="4" width="56" height="56" rx="14" fill="#0D1117" />
      <Rect x="6" y="6" width="52" height="52" rx="12" fill="#111827" />
      <Path
        d="M18 35.5L21.6 26C22.3 24.2 24 23 25.9 23H38.1C40 23 41.7 24.2 42.4 26L46 35.5"
        fill="none"
        stroke="#E6EDF3"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M16 36H48V43C48 45.2 46.2 47 44 47H20C17.8 47 16 45.2 16 43V36Z"
        fill="#2BB673"
      />
      <Path d="M23 36L26 30H38L41 36" fill="#193C32" />
      <Circle cx="24" cy="44" r="3.5" fill="#0D1117" />
      <Circle cx="40" cy="44" r="3.5" fill="#0D1117" />
      <Polyline
        points="14 22 21 22 25 15 31 29 36 18 40 22 50 22"
        fill="none"
        stroke="#2BB673"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Line
        x1="32"
        y1="50"
        x2="32"
        y2="55"
        stroke="#2BB673"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <Line
        x1="24"
        y1="53"
        x2="40"
        y2="53"
        stroke="#2BB673"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </Svg>
  );
}
