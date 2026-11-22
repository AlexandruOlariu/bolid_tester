/** SegmentedControl, AccessibleSwitch and LabeledSwitch (plan 20, docs/accessibility.md): what a
 *  screen reader gets from them — a named radio group whose options report `selected` / `checked`,
 *  and switches that report `checked` — and that the callbacks fire with the right value. */
import React, { useState } from 'react';
import { fireEvent, screen } from '@testing-library/react-native';
import { renderWithProviders } from '@test/renderWithProviders';
import { a11yProblems } from '@test/a11y';
import { SegmentedControl, HIT_SLOP, type SegmentOption } from './SegmentedControl';
import { AccessibleSwitch, LabeledSwitch } from './LabeledSwitch';

const POLL: SegmentOption<number>[] = [
  { value: 250, label: '250 ms', accessibilityLabel: '250 milliseconds' },
  { value: 500, label: '500 ms' },
  { value: 1000, label: '1000 ms' },
];

function Poll({ onChange }: { onChange?: (v: number) => void }) {
  const [value, setValue] = useState(500);
  return (
    <SegmentedControl
      label="Poll interval"
      options={POLL}
      value={value}
      onChange={(v) => {
        setValue(v);
        onChange?.(v);
      }}
      testID="poll"
    />
  );
}

describe('SegmentedControl', () => {
  it('is a named radio group: one radio per option, the active one selected and checked', () => {
    renderWithProviders(<Poll />);
    expect(screen.getByTestId('poll').props.accessibilityRole).toBe('radiogroup');
    expect(screen.getByTestId('poll').props.accessibilityLabel).toBe('Poll interval');
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(3);
    expect(screen.getByRole('radio', { name: '500 ms' })).toBeSelected();
    expect(screen.getByRole('radio', { name: '500 ms' })).toBeChecked();
    // A spoken name replaces terse visible text.
    expect(screen.getByRole('radio', { name: '250 milliseconds' })).not.toBeSelected();
    expect(screen.getByRole('radio', { name: '1000 ms' })).not.toBeChecked();
    expect(a11yProblems(screen.root)).toEqual([]);
  });

  it('calls onChange with the option value and moves the selection', () => {
    const onChange = jest.fn();
    renderWithProviders(<Poll onChange={onChange} />);
    fireEvent.press(screen.getByText('1000 ms'));
    expect(onChange).toHaveBeenCalledWith(1000);
    expect(screen.getByRole('radio', { name: '1000 ms' })).toBeSelected();
    expect(screen.getByRole('radio', { name: '500 ms' })).not.toBeSelected();
  });

  it('options are 36 dp with an 8 dp hit slop (52 dp ≥ the 44 pt minimum)', () => {
    renderWithProviders(<Poll />);
    expect(HIT_SLOP).toBe(8);
    const option = screen.UNSAFE_getAllByProps({ accessibilityRole: 'radio' })[0];
    expect(option.props.hitSlop).toBe(HIT_SLOP);
    expect(option.props.size).toBe('$3');
  });

  it('no option selected when the value is outside the options; disabled options do nothing', () => {
    const onChange = jest.fn();
    renderWithProviders(
      <SegmentedControl label="Theme" options={POLL} value={null} onChange={onChange} disabled />,
    );
    for (const r of screen.getAllByRole('radio')) expect(r).not.toBeSelected();
    expect(screen.getAllByRole('radio')[0]).toBeDisabled();
    fireEvent.press(screen.getByText('500 ms'));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('AccessibleSwitch / LabeledSwitch', () => {
  function Toggle({ onChange }: { onChange: (v: boolean) => void }) {
    const [on, setOn] = useState(false);
    return (
      <LabeledSwitch
        label="Retry the last adapter after a dropped link"
        accessibilityLabel="Auto-reconnect"
        checked={on}
        onCheckedChange={(v) => {
          setOn(v);
          onChange(v);
        }}
      />
    );
  }

  it('is a named switch that reports on / off and toggles on press', () => {
    const onChange = jest.fn();
    renderWithProviders(<Toggle onChange={onChange} />);
    expect(screen.getByText('Retry the last adapter after a dropped link')).toBeTruthy();
    const sw = screen.getByRole('switch', { name: 'Auto-reconnect' });
    expect(sw).not.toBeChecked();
    fireEvent.press(sw);
    expect(onChange).toHaveBeenLastCalledWith(true);
    expect(screen.getByRole('switch', { name: 'Auto-reconnect' })).toBeChecked();
    fireEvent.press(screen.getByRole('switch', { name: 'Auto-reconnect' }));
    expect(onChange).toHaveBeenLastCalledWith(false);
    expect(a11yProblems(screen.root)).toEqual([]);
  });

  it('is controlled: the owner decides (a confirmation can stand between tap and change)', () => {
    const onChange = jest.fn();
    renderWithProviders(
      <AccessibleSwitch
        checked={false}
        onCheckedChange={onChange}
        accessibilityLabel="Send anonymous crash reports"
      />,
    );
    fireEvent.press(screen.getByRole('switch', { name: 'Send anonymous crash reports' }));
    expect(onChange).toHaveBeenCalledWith(true);
    expect(screen.getByRole('switch', { name: 'Send anonymous crash reports' })).not.toBeChecked();
  });

  it('a disabled switch reports it and never calls back', () => {
    const onChange = jest.fn();
    renderWithProviders(
      <AccessibleSwitch checked onCheckedChange={onChange} accessibilityLabel="Unlock" disabled />,
    );
    const sw = screen.getByRole('switch', { name: 'Unlock' });
    expect(sw).toBeChecked();
    expect(sw).toBeDisabled();
    fireEvent(sw, 'checkedChange', false);
    expect(onChange).not.toHaveBeenCalled();
  });
});
