import React from 'react';
import { act, screen } from '@testing-library/react-native';
import { renderWithProviders } from '@test/renderWithProviders';
import { i18n } from '@/shared/i18n';
import { ValueCard } from './ValueCard';
import { StatusBadge } from './StatusBadge';

describe('ValueCard number format (plan 11)', () => {
  it('uses a decimal point in English', () => {
    renderWithProviders(<ValueCard name="Fuel economy" value={7.5} unit="L/100km" />);
    expect(screen.getByText('7.5')).toBeTruthy();
    expect(screen.getByLabelText('Fuel economy: 7.5 L/100km')).toBeTruthy();
  });

  it('uses a decimal comma in Romanian, and translates the stale marker; units stay metric', async () => {
    await act(async () => {
      await i18n.changeLanguage('ro');
    });
    renderWithProviders(<ValueCard name="Consum" value={7.5} unit="L/100km" stale />);
    expect(screen.getByText('7,5')).toBeTruthy();
    expect(screen.getByText('L/100km')).toBeTruthy();
    expect(screen.getByLabelText('Consum: 7,5 L/100km (neactualizat)')).toBeTruthy();
  });

  it('switches live when the language changes', async () => {
    renderWithProviders(<ValueCard name="Voltage" value={3.25} unit="V" />);
    expect(screen.getByText('3.3')).toBeTruthy();
    await act(async () => {
      await i18n.changeLanguage('ro');
    });
    expect(screen.getByText('3,3')).toBeTruthy();
  });
});

describe('StatusBadge (plan 11)', () => {
  it('reads the connection state in the UI language', async () => {
    await act(async () => {
      await i18n.changeLanguage('ro');
    });
    renderWithProviders(<StatusBadge status="connected" />);
    expect(screen.getByText('Conectat')).toBeTruthy();
    expect(screen.getByLabelText('Starea conexiunii: Conectat')).toBeTruthy();
  });
});
