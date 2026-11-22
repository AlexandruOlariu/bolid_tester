import React from 'react';
import { Text, type TextProps } from 'tamagui';

/** A section heading inside a screen (plan 20): announced as a heading, so screen-reader users can
 *  jump between sections. The look is the one the screens used inline (`fontWeight="800"
 *  fontSize="$5"`); extra Text props (margins, colour) pass through. */
export function SectionTitle({ children, ...rest }: TextProps & { children: React.ReactNode }) {
  return (
    <Text fontWeight="800" fontSize="$5" role="heading" accessibilityRole="header" {...rest}>
      {children}
    </Text>
  );
}
