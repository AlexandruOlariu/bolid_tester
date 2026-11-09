import React from 'react';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { renderWithProviders } from '@test/renderWithProviders';
import { NOT_ON_WEB_YET, hideToast, showToast } from '@/shared/state/toastStore';
import { Toast } from './Toast';

describe('Toast (plan 28)', () => {
  afterEach(() => act(() => hideToast()));

  it('renders nothing until a toast is shown, then the message until dismissed', () => {
    renderWithProviders(<Toast />);
    expect(screen.queryByTestId('toast')).toBeNull();
    act(() => showToast(NOT_ON_WEB_YET));
    expect(screen.getByTestId('toast')).toHaveTextContent(/Not available on web yet/);
    fireEvent.press(screen.getByLabelText('Dismiss'));
    expect(screen.queryByTestId('toast')).toBeNull();
  });
});
