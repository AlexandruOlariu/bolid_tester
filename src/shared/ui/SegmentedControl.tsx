import React from 'react';
import { Button, XStack, YStack } from 'tamagui';

export interface SegmentOption<T extends string | number> {
  value: T;
  /** Visible text. */
  label: string;
  /** Spoken name when the visible text is not enough (e.g. "15 seconds" for "15s"). */
  accessibilityLabel?: string;
  testID?: string;
}

interface SegmentedControlProps<T extends string | number> {
  /** The group's spoken name ("Theme", "Poll interval"). Not shown — the screen shows its own label. */
  label: string;
  options: readonly SegmentOption<T>[];
  /** The selected value; `null` when none is (e.g. a custom entry outside the options). */
  value: T | null;
  onChange: (value: T) => void;
  disabled?: boolean;
  /** One full-width option per line (a list of long names) instead of a wrapping row. */
  vertical?: boolean;
  testID?: string;
}

/** Touch-target slop around each 36 dp option: 36 + 2 × 8 = 52 dp ≥ the 44 pt minimum (plan 20). */
export const HIT_SLOP = 8;

/** A single-choice row of buttons (plan 20, docs/accessibility.md): the group is a `radiogroup`
 *  with a name, each option a `radio` whose `selected` / `checked` state TalkBack and VoiceOver
 *  announce. Options are 36 dp (`size="$3"`) plus an 8 dp hit slop, and wrap on narrow screens or
 *  large text. Replaces the ad-hoc `Seg` / `Chip` rows. */
export function SegmentedControl<T extends string | number>({
  label,
  options,
  value,
  onChange,
  disabled,
  vertical,
  testID,
}: SegmentedControlProps<T>) {
  const Group = vertical ? YStack : XStack;
  return (
    <Group
      gap="$2"
      flexWrap={vertical ? undefined : 'wrap'}
      role="radiogroup"
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      testID={testID}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Button
            key={String(o.value)}
            size="$3"
            hitSlop={HIT_SLOP}
            justifyContent={vertical ? 'flex-start' : undefined}
            theme={active ? 'green' : 'gray'}
            disabled={disabled}
            opacity={disabled ? 0.5 : 1}
            role="radio"
            accessibilityRole="radio"
            accessibilityLabel={o.accessibilityLabel}
            accessibilityState={{ selected: active, checked: active, disabled: !!disabled }}
            testID={o.testID}
            onPress={() => {
              if (!disabled) onChange(o.value);
            }}
          >
            {o.label}
          </Button>
        );
      })}
    </Group>
  );
}
