import React from 'react';
import { Paragraph, Separator, XStack, YStack } from 'tamagui';

interface SettingsRowProps {
  title: string;
  /** One grey line under the title: the current state ("Off", "2 installed") or what is inside. */
  status?: string;
  onPress: () => void;
  /** The spoken name; defaults to "<title>. <status>". */
  accessibilityLabel?: string;
  /** The mark at the end of the row; `›` (opens a page) by default. */
  trailing?: string;
  testID?: string;
}

/** A tappable Settings row (the hub's links to its pages, About's actions): the title, a grey
 *  status line and a chevron, announced as one button whose name starts with the title. */
export function SettingsRow({
  title,
  status,
  onPress,
  accessibilityLabel,
  trailing = '›',
  testID,
}: SettingsRowProps) {
  return (
    <XStack
      alignItems="center"
      gap="$3"
      paddingHorizontal="$3"
      paddingVertical="$2"
      minHeight={48}
      pressStyle={{ backgroundColor: '$color4' }}
      accessible
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (status ? `${title}. ${status}` : title)}
      onPress={onPress}
      testID={testID}
    >
      <YStack flex={1}>
        <Paragraph fontWeight="700">{title}</Paragraph>
        {status ? (
          <Paragraph theme="alt2" fontSize="$2" lineHeight="$2">
            {status}
          </Paragraph>
        ) : null}
      </YStack>
      <Paragraph
        theme="alt2"
        fontSize="$6"
        accessibilityElementsHidden
        importantForAccessibility="no"
      >
        {trailing}
      </Paragraph>
    </XStack>
  );
}

/** Rows in one bordered card, divided by hairlines (the look of the old Notifications row, stacked
 *  without gaps so the hub stays short). `null` children are skipped. */
export function SettingsRowGroup({ children }: { children: React.ReactNode }) {
  const rows = React.Children.toArray(children);
  return (
    <YStack
      backgroundColor="$backgroundHover"
      borderRadius="$4"
      borderWidth={1}
      borderColor="$borderColor"
      overflow="hidden"
    >
      {rows.map((row, i) => (
        <React.Fragment key={i}>
          {i > 0 ? <Separator borderColor="$borderColor" /> : null}
          {row}
        </React.Fragment>
      ))}
    </YStack>
  );
}
