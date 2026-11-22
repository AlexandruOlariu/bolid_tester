/** Settings → Security access plugins (plan 23): import the fixture plugin through the
 *  picker (preview → Install), Test in simulator reports pass, a plugin over the limits is refused
 *  with the reason and nothing is installed, Delete asks first. The modules are faked at
 *  `loadSeedKeyModules` (in-memory file system). The plugin is a TEST VECTOR (seed XOR 0xFFFF),
 *  not a routine for any real module. */
import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderWithProviders } from '@test/renderWithProviders';
import { fileSystemMock, memoryFiles } from '@test/mocks/fileSystem';
import { useSeedKeyStore } from '@/shared/state/seedKeyStore';
import * as seedKeyFiles from '@/shared/security/seedKeyFiles';
import { SeedKeysSection } from './SeedKeysSection';

const FIXTURE = {
  schema: 'bolid.seedkey.v1',
  name: 'Test vector BCM',
  applies: { reqHeader: '70E', level: 3 },
  seedBytes: 2,
  keyBytes: 2,
  program: [{ op: 'load', from: 'seed' }, { op: 'xor', value: 0xffff }, { op: 'store' }],
};

function pickerFor(text: string) {
  jest.spyOn(seedKeyFiles, 'loadSeedKeyModules').mockResolvedValue({
    FileSystem: fileSystemMock,
    Picker: {
      getDocumentAsync: async () => {
        memoryFiles.set('file:///test-cache/plugin.json', text);
        return {
          canceled: false,
          assets: [{ uri: 'file:///test-cache/plugin.json', name: 'plugin.json' }],
        };
      },
    },
  });
}

describe('SeedKeysSection', () => {
  afterEach(() => jest.restoreAllMocks());

  it('imports the fixture plugin, tests it in the simulator, and deletes it after asking', async () => {
    pickerFor(JSON.stringify(FIXTURE));
    renderWithProviders(<SeedKeysSection />);
    expect(screen.getByText(/No plugins installed/)).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByText('Import plugin'));
    });
    expect(screen.getByTestId('seed-key-preview')).toHaveTextContent(/Test vector BCM/);
    expect(screen.getByTestId('seed-key-preview')).toHaveTextContent(
      /module 70E · security level 0x03/,
    );
    expect(screen.getByTestId('seed-key-preview')).toHaveTextContent(/3 steps written, 3 run/);
    await act(async () => {
      fireEvent.press(screen.getByText('Install'));
    });
    const installed = useSeedKeyStore.getState().plugins;
    expect(installed.map((p) => p.name)).toEqual(['Test vector BCM']);
    expect(installed[0].vehicleKey).toBeUndefined();
    expect(memoryFiles.has(installed[0].fileUri)).toBe(true);
    expect(screen.getByText('Installed (1)')).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByLabelText('Test in simulator: Test vector BCM'));
    });
    // The check drives a real DiagnosticSession over MockTransport (timer-paced replies).
    await waitFor(() =>
      expect(screen.getByTestId('seed-key-note')).toHaveTextContent(/^Passed in the simulator/),
    );
    expect(screen.getByTestId('seed-key-note')).toHaveTextContent(/12 34 into key ED CB/);

    const alert = jest.spyOn(Alert, 'alert');
    fireEvent.press(screen.getByLabelText('Delete Test vector BCM'));
    const buttons = alert.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    await act(async () => {
      buttons.find((b) => b.text === 'Delete')?.onPress?.();
    });
    expect(useSeedKeyStore.getState().plugins).toEqual([]);
    expect(memoryFiles.has(installed[0].fileUri)).toBe(false);
  });

  it('pins a plugin to the current car when asked', async () => {
    pickerFor(JSON.stringify(FIXTURE));
    renderWithProviders(<SeedKeysSection />);
    await act(async () => {
      fireEvent.press(screen.getByText('Import plugin'));
    });
    fireEvent(screen.getByLabelText('Only for this car'), 'checkedChange', true);
    await act(async () => {
      fireEvent.press(screen.getByText('Install'));
    });
    expect(useSeedKeyStore.getState().plugins[0].vehicleKey).toMatch(/^(id|vin):/);
    expect(screen.getByText(/this car only/)).toBeTruthy();
  });

  it('refuses a plugin over the limits with a clear message and installs nothing', async () => {
    pickerFor(
      JSON.stringify({
        ...FIXTURE,
        program: [
          {
            op: 'repeat',
            count: 64,
            body: [{ op: 'repeat', count: 64, body: [{ op: 'add', value: 1 }] }],
          },
          { op: 'store' },
        ],
      }),
    );
    renderWithProviders(<SeedKeysSection />);
    await act(async () => {
      fireEvent.press(screen.getByText('Import plugin'));
    });
    const refusal = screen.getByTestId('seed-key-refusal');
    expect(refusal).toHaveTextContent(/over the safety limits/);
    expect(refusal).toHaveTextContent(/more than 4096 steps/);
    expect(refusal).toHaveTextContent(/Nothing was changed/);
    expect(useSeedKeyStore.getState().plugins).toEqual([]);
  });
});
