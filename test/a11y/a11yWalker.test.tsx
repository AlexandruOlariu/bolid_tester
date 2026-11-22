/** The accessibility walker behind the screen sweep (test/a11y.ts, plan 20): each rule fires on the
 *  control that breaks it and stays quiet on a correct one — so the sweep can fail. */
import React from 'react';
import { screen } from '@testing-library/react-native';
import { Button, Card, Input, Switch, XStack, Text } from 'tamagui';
import { Trash2 } from 'lucide-react-native';
import { renderWithProviders } from '@test/renderWithProviders';
import { View } from 'react-native';
import { a11yProblems, accessibleName, textContent } from '@test/a11y';

const noop = () => undefined;

/** Render inside a plain view: `screen.root` is the first host element, so a lone Button would
 *  otherwise be the root itself and its own (composite) props would sit above it. */
const renderInView = (ui: React.ReactElement) => renderWithProviders(<View>{ui}</View>);

describe('a11yProblems', () => {
  it('a Button with text, an icon Button with a label and a labelled input pass', () => {
    renderInView(
      <>
        <Button onPress={noop}>Export</Button>
        <Button circular icon={<Trash2 size={16} />} accessibilityLabel="Delete" onPress={noop} />
        <Input accessibilityLabel="Server URL" placeholder="http://…" />
      </>,
    );
    expect(a11yProblems(screen.root)).toEqual([]);
  });

  it('an icon-only Button without a label is reported', () => {
    renderInView(<Button circular icon={<Trash2 size={16} />} onPress={noop} />);
    expect(a11yProblems(screen.root)).toEqual([expect.stringMatching(/^Pressable without a name/)]);
  });

  it('a button inside a pressable card is checked as its own control', () => {
    const card = (inner: React.ReactElement) => (
      <Card onPress={noop} accessible accessibilityRole="button" accessibilityLabel="Golf. CAN">
        <Text>Golf</Text>
        <XStack>{inner}</XStack>
      </Card>
    );
    renderInView(card(<Button onPress={noop}>Edit</Button>));
    expect(a11yProblems(screen.root)).toEqual([]);

    renderInView(card(<Button circular icon={<Trash2 size={16} />} onPress={noop} />));
    const problems = a11yProblems(screen.root);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^Pressable without a name/);
  });

  it('a pressable row without a role, or not one accessibility element, is reported', () => {
    renderInView(
      <>
        <XStack onPress={noop} accessible accessibilityLabel="Notification settings">
          <Text>Notification settings</Text>
        </XStack>
        <XStack onPress={noop} accessibilityRole="button">
          <Text>Open the log</Text>
        </XStack>
      </>,
    );
    const problems = a11yProblems(screen.root);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/"Notification settings" without a role/);
    expect(problems[1]).toMatch(/"Open the log" is not an accessibility element/);
  });

  it('an input with only a placeholder is reported', () => {
    renderInView(<Input placeholder="e.g. 215000" />);
    expect(a11yProblems(screen.root)).toEqual([
      expect.stringMatching(/Text input without accessibilityLabel \(placeholder "e.g. 215000"\)/),
    ]);
  });

  it('a bare Tamagui Switch is reported: its native build sets no role, name or state', () => {
    renderInView(
      <Switch checked onCheckedChange={noop}>
        <Switch.Thumb />
      </Switch>,
    );
    expect(a11yProblems(screen.root).length).toBeGreaterThan(0);
  });

  it('a radio without a checked state is reported', () => {
    renderInView(
      <Button accessibilityRole="radio" onPress={noop}>
        Dark
      </Button>,
    );
    expect(a11yProblems(screen.root)).toEqual([
      expect.stringMatching(/^radio without a checked state/),
    ]);
  });
});

describe('accessibleName / textContent', () => {
  it('prefers the label, else reads the text, skipping hidden subtrees', () => {
    renderInView(
      <XStack testID="row">
        <Text>Readiness</Text>
        <Text accessibilityElementsHidden>›</Text>
      </XStack>,
    );
    const row = screen.getByTestId('row');
    expect(textContent(row)).toBe('Readiness');
    expect(accessibleName(row)).toBe('Readiness');
  });
});
