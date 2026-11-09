import React from 'react';
import { Paragraph, Switch, XStack, type SizeTokens } from 'tamagui';
import { HIT_SLOP } from './SegmentedControl';

interface AccessibleSwitchProps {
  checked: boolean;
  /** Called with the requested state. A controlled switch: it shows `checked` until the owner
   *  changes it (so a confirmation can stand between the tap and the change). */
  onCheckedChange: (checked: boolean) => void;
  /** The spoken name: what the switch turns on ("Unlock writes"). Required — a bare switch has no
   *  text of its own for a screen reader to read. */
  accessibilityLabel: string;
  disabled?: boolean;
  size?: SizeTokens;
  testID?: string;
}

/** Tamagui's `Switch` with what its native build leaves out (plan 20): the `switch` role, the
 *  `checked` / `disabled` state TalkBack and VoiceOver announce ("on" / "off"), a name, and an 8 dp
 *  hit slop. Every on / off control in the app is this or `LabeledSwitch`. */
export function AccessibleSwitch({
  checked,
  onCheckedChange,
  accessibilityLabel,
  disabled,
  size = '$3',
  testID,
}: AccessibleSwitchProps) {
  return (
    <Switch
      size={size}
      checked={checked}
      disabled={disabled}
      opacity={disabled ? 0.5 : 1}
      theme={checked ? 'green' : 'gray'}
      hitSlop={HIT_SLOP}
      accessible
      role="switch"
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked, disabled: !!disabled }}
      testID={testID}
      onCheckedChange={(next) => {
        if (!disabled) onCheckedChange(!!next);
      }}
    >
      <Switch.Thumb />
    </Switch>
  );
}

interface LabeledSwitchProps extends Omit<AccessibleSwitchProps, 'accessibilityLabel' | 'size'> {
  /** Visible label, also the spoken name unless `accessibilityLabel` is given. */
  label: string;
  accessibilityLabel?: string;
}

/** An On / Off setting (plan 20): a visible label and an `AccessibleSwitch`. Replaces the pairs of
 *  On / Off buttons. */
export function LabeledSwitch({ label, accessibilityLabel, ...rest }: LabeledSwitchProps) {
  return (
    <XStack gap="$3" alignItems="center">
      <Paragraph flex={1}>{label}</Paragraph>
      <AccessibleSwitch accessibilityLabel={accessibilityLabel ?? label} {...rest} />
    </XStack>
  );
}
