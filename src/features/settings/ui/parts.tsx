import React from 'react';
import { Card, Text } from 'tamagui';

/** A section heading (announced as a heading, plan 20) in the theme's accent colour. */
export function SectionLabel({ children }: { children: string }) {
  return (
    <Text
      fontWeight="800"
      fontSize="$2"
      color="$accent"
      letterSpacing={0.8}
      textTransform="uppercase"
      role="heading"
      accessibilityRole="header"
    >
      {children}
    </Text>
  );
}

/** A heading inside a section or a Settings page (e.g. the parts of Developer & simulator). */
export function SubLabel({ children }: { children: string }) {
  return (
    <Text fontWeight="700" fontSize="$3" role="heading" accessibilityRole="header">
      {children}
    </Text>
  );
}

/** The bordered card a group of settings sits in. */
export function SegGroup({ children }: { children: React.ReactNode }) {
  return (
    <Card bordered padding="$3" backgroundColor="$backgroundHover">
      {children}
    </Card>
  );
}
