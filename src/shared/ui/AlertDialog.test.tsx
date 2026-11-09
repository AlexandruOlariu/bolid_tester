import React from 'react';
import { Alert, Platform } from 'react-native';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { renderWithProviders } from '@test/renderWithProviders';
import { clearDialogs, openDialog, useDialogStore } from '@/shared/state/dialogStore';
import { AlertDialog } from './AlertDialog';
import { appAlert } from './appAlert';

/** react-native-web's `Alert.alert` is an empty stub, so the web build routes alerts through
 *  `appAlert` → the in-app `AlertDialog` (plan 28 review). */
describe('AlertDialog + appAlert', () => {
  afterEach(() => act(() => clearDialogs()));

  it('renders nothing until an alert is queued', () => {
    renderWithProviders(<AlertDialog />);
    expect(screen.queryByTestId('alert-dialog')).toBeNull();
  });

  it('offers every button (a three-way choice) and runs only the one pressed', () => {
    const md = jest.fn();
    const json = jest.fn();
    const cancel = jest.fn();
    renderWithProviders(<AlertDialog />);
    act(() =>
      openDialog('Export error log', 'Choose a format to share.', [
        { text: 'Cancel', style: 'cancel', onPress: cancel },
        { text: 'Markdown', onPress: md },
        { text: 'JSON', onPress: json },
      ]),
    );
    expect(screen.getByTestId('alert-dialog')).toHaveTextContent(/Choose a format to share/);
    fireEvent.press(screen.getByText('Markdown'));
    expect(md).toHaveBeenCalledTimes(1);
    expect(json).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    expect(screen.queryByTestId('alert-dialog')).toBeNull();
  });

  it('a tap outside counts as Cancel', () => {
    const cancel = jest.fn();
    const destroy = jest.fn();
    renderWithProviders(<AlertDialog />);
    act(() =>
      openDialog('Delete?', undefined, [
        { text: 'Cancel', style: 'cancel', onPress: cancel },
        { text: 'Delete', style: 'destructive', onPress: destroy },
      ]),
    );
    // Hidden from screen readers (the dialog is modal), so query it as hidden.
    fireEvent.press(screen.getByTestId('alert-dialog-backdrop', { includeHiddenElements: true }));
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(destroy).not.toHaveBeenCalled();
    expect(screen.queryByTestId('alert-dialog')).toBeNull();
  });

  it('a two-step confirm shows the follow-up alert the first button opens', () => {
    const reset = jest.fn();
    renderWithProviders(<AlertDialog />);
    act(() =>
      openDialog('Reset all app data?', 'Step one.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          onPress: () =>
            openDialog('Delete all app data?', 'Step two.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Reset everything', style: 'destructive', onPress: reset },
            ]),
        },
      ]),
    );
    fireEvent.press(screen.getByText('Continue'));
    expect(screen.getByTestId('alert-dialog')).toHaveTextContent(/Step two/);
    fireEvent.press(screen.getByText('Reset everything'));
    expect(reset).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('alert-dialog')).toBeNull();
  });

  it('a notice with no buttons gets an OK that closes it', () => {
    renderWithProviders(<AlertDialog />);
    act(() => openDialog('Export unavailable', 'Sharing is not available on this device.'));
    fireEvent.press(screen.getByText('OK'));
    expect(screen.queryByTestId('alert-dialog')).toBeNull();
  });

  it('appAlert uses the system alert on the phone and the in-app dialog on the web', () => {
    const system = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    jest.replaceProperty(Platform, 'OS', 'android');
    appAlert('Phone', 'native');
    expect(system).toHaveBeenCalledWith('Phone', 'native');
    expect(useDialogStore.getState().queue).toHaveLength(0);

    jest.replaceProperty(Platform, 'OS', 'web');
    appAlert('Browser', 'web');
    expect(system).toHaveBeenCalledTimes(1);
    expect(useDialogStore.getState().queue.map((d) => d.title)).toEqual(['Browser']);
  });
});
