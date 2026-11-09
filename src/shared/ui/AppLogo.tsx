import React from 'react';
import Svg, { Circle, Line, Path, Polyline, Rect } from 'react-native-svg';
import palette from './palette.json';

const { green, ink, logoPanel, logoLine, logoShade } = palette.brand;

interface AppLogoProps {
  size?: number;
}

/** The brand mark. Decorative everywhere (plan 20): the header title and the splash text next to it
 *  carry the name, so screen readers skip the drawing. Fixed brand colours from palette.json. */
export function AppLogo({ size = 32 }: AppLogoProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Rect x="4" y="4" width="56" height="56" rx="14" fill={ink} />
      <Rect x="6" y="6" width="52" height="52" rx="12" fill={logoPanel} />
      <Path
        d="M18 35.5L21.6 26C22.3 24.2 24 23 25.9 23H38.1C40 23 41.7 24.2 42.4 26L46 35.5"
        fill="none"
        stroke={logoLine}
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path d="M16 36H48V43C48 45.2 46.2 47 44 47H20C17.8 47 16 45.2 16 43V36Z" fill={green} />
      <Path d="M23 36L26 30H38L41 36" fill={logoShade} />
      <Circle cx="24" cy="44" r="3.5" fill={ink} />
      <Circle cx="40" cy="44" r="3.5" fill={ink} />
      <Polyline
        points="14 22 21 22 25 15 31 29 36 18 40 22 50 22"
        fill="none"
        stroke={green}
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Line x1="32" y1="50" x2="32" y2="55" stroke={green} strokeWidth="3" strokeLinecap="round" />
      <Line x1="24" y1="53" x2="40" y2="53" stroke={green} strokeWidth="3" strokeLinecap="round" />
    </Svg>
  );
}
