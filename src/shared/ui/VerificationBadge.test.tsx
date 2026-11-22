import React from 'react';
import { screen } from '@testing-library/react-native';
import { renderWithProviders } from '@test/renderWithProviders';
import { VerificationBadge } from './VerificationBadge';

describe('VerificationBadge', () => {
  it('renders the three states with their text and an accessible label', () => {
    renderWithProviders(
      <>
        <VerificationBadge item={{ experimental: false }} testID="standard" />
        <VerificationBadge
          item={{ experimental: true, confirmed: { on: '2026-11-20', source: 'sniffer-capture' } }}
          testID="confirmed"
        />
        <VerificationBadge item={{ experimental: true }} testID="unverified" />
      </>,
    );
    expect(screen.getByText('Standard OBD2')).toBeTruthy();
    expect(screen.getByText('Confirmed 2026-11-20 (sniffer capture)')).toBeTruthy();
    expect(screen.getByText('Illustrative — not yet confirmed on this car')).toBeTruthy();
    expect(
      screen.getByLabelText('Verification: Confirmed 2026-11-20 (sniffer capture)'),
    ).toBeTruthy();
  });
});
