import React from 'react';
import { XStack, YStack } from 'tamagui';
import { useLayoutClass } from './useLayoutClass';
import { isTwoPane } from './layoutClass';

interface CardGridProps {
  children: React.ReactNode;
  /** Vertical gap between rows (and between items on a phone), in dp. */
  gap?: number;
  /** In two-column mode the grid gets this testID and each cell `<testID>-cell`. */
  testID?: string;
}

/** A list of cards: one column on a phone, two columns (each cell 49 % wide) on medium / expanded
 *  windows (plan 21). Used by More's sections and the Vehicle screen's garage / built-in lists. */
export function CardGrid({ children, gap = 8, testID }: CardGridProps) {
  const layout = useLayoutClass();
  const items = React.Children.toArray(children).filter(Boolean);
  if (!isTwoPane(layout)) return <YStack gap={gap}>{items}</YStack>;
  return (
    <XStack testID={testID} flexWrap="wrap" justifyContent="space-between" rowGap={gap}>
      {items.map((child, i) => (
        <YStack
          key={React.isValidElement(child) && child.key != null ? child.key : i}
          testID={testID ? `${testID}-cell` : undefined}
          flexBasis="49%"
          maxWidth="49%"
        >
          {child}
        </YStack>
      ))}
    </XStack>
  );
}
