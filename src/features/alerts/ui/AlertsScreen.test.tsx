/** Alerts (plan 11): the starter rules' names and every threshold / value follow the UI language;
 *  a rule the user named keeps its own name. */
import React from 'react';
import { act, screen } from '@testing-library/react-native';
import { renderWithProviders } from '@test/renderWithProviders';
import { i18n } from '@/shared/i18n';
import { defaultRules } from '@/shared/obd-core';
import { useAlertsStore } from '../model/alertsStore';
import { ruleLabel } from '../model/ruleLabel';
import { AlertsScreen } from './AlertsScreen';

function seed() {
  const rules = [
    ...defaultRules(['0105', '0142']),
    {
      id: 'mine',
      pid: '0142',
      op: 'lt' as const,
      value: 12.25,
      severity: 'info' as const,
      label: 'Battery check',
    },
  ];
  const lowVoltage = rules.find((r) => r.id === 'low-voltage')!;
  useAlertsStore.setState({
    rules,
    active: [
      {
        ruleId: 'low-voltage',
        pid: '0142',
        severity: 'warn',
        value: 11.4,
        since: 0,
        rule: lowVoltage,
      },
    ],
  });
}

describe('AlertsScreen language (plan 11)', () => {
  it('English: starter names as written, decimal points', () => {
    seed();
    renderWithProviders(<AlertsScreen />);
    expect(screen.getByText('Low battery voltage: 11.4')).toBeTruthy();
    expect(screen.getByText(/^Low battery voltage \(0142 < 11\.8\)/)).toBeTruthy();
    expect(screen.getByText(/^Coolant overheating \(0105 > 110\)/)).toBeTruthy();
    expect(screen.getByText(/^Battery check \(0142 < 12\.25\)/)).toBeTruthy();
  });

  it('Romanian: starter names translated, decimal commas; a user label stays as written', async () => {
    seed();
    await act(async () => {
      await i18n.changeLanguage('ro');
    });
    renderWithProviders(<AlertsScreen />);
    expect(screen.getByText('Tensiune scăzută la baterie: 11,4')).toBeTruthy();
    expect(
      screen.getByText(/^Tensiune scăzută la baterie \(0142 < 11,8\) · avertizare/),
    ).toBeTruthy();
    expect(screen.getByText(/^Supraîncălzire lichid de răcire \(0105 > 110\)/)).toBeTruthy();
    expect(screen.getByText(/^Battery check \(0142 < 12,25\)/)).toBeTruthy();
    expect(screen.getByLabelText('Alertă Tensiune scăzută la baterie')).toBeTruthy();
  });

  it('a starter rule the user renamed keeps the new name; a rule without a label shows its PID', () => {
    expect(ruleLabel({ id: 'low-voltage', pid: '0142', label: 'My battery' })).toBe('My battery');
    expect(ruleLabel({ id: 'x', pid: '010C' })).toBe('010C');
  });
});
