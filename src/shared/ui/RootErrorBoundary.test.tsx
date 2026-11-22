/** The root render-error boundary's fallback (finding F9) points to Report a problem (plan 32). */
import React from 'react';
import { fireEvent, screen } from '@testing-library/react-native';
import { renderWithProviders } from '@test/renderWithProviders';
import { useErrorLogStore } from '@/shared/state/errorLogStore';
import { RootErrorBoundary } from './RootErrorBoundary';

function Boom(): React.ReactElement {
  throw new Error('render exploded');
}

describe('RootErrorBoundary', () => {
  it('logs a render error and offers Retry or a problem report', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    renderWithProviders(
      <RootErrorBoundary>
        <Boom />
      </RootErrorBoundary>,
    );
    expect(screen.getByText('Something broke')).toBeTruthy();
    expect(screen.getByText(/report it from More > Report a problem/)).toBeTruthy();
    expect(screen.getByText('render exploded')).toBeTruthy();
    expect(useErrorLogStore.getState().errors[0]).toMatchObject({
      source: 'render',
      message: 'render exploded',
    });
    expect(screen.getByText('Retry')).toBeTruthy();
    fireEvent.press(screen.getByText('Retry')); // re-renders Boom, which throws again
    expect(screen.getByText('Something broke')).toBeTruthy();
    spy.mockRestore();
  });
});
