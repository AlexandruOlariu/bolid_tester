/** Settings → Label packs (plan 13): import a pack file, list it with Export / Delete, and
 *  the bundled packs with Export as template. The native file I/O is covered in
 *  shared/state/exchangeService.test.ts; here the modules are faked at `loadExchangeModules`. */
import React from 'react';
import * as fs from 'fs';
import * as path from 'path';
import { Alert } from 'react-native';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { renderWithProviders } from '@test/renderWithProviders';
import { findLabelPack } from '@/shared/labels';
import { useLabelPackStore } from '@/shared/state/labelPackStore';
import * as exchangeService from '@/shared/state/exchangeService';
import * as labelPackFile from '../api/labelPackFile';
import { LabelPacksSection } from './LabelPacksSection';

const EXAMPLE = fs.readFileSync(
  path.resolve(__dirname, '../../../../docs/examples/label-pack.example.json'),
  'utf8',
);

function fakeModules(text: string): exchangeService.ExchangeModules {
  return {
    FileSystem: {
      documentDirectory: 'file:///test/',
      getInfoAsync: async () => ({ exists: true, size: text.length }),
      readAsStringAsync: async () => text,
      writeAsStringAsync: async () => undefined,
    },
    Sharing: null,
    Picker: {
      getDocumentAsync: async () => ({
        canceled: false,
        assets: [{ uri: 'file:///cache/pack.json', name: 'pack.json' }],
      }),
    },
  };
}

describe('LabelPacksSection', () => {
  afterEach(() => jest.restoreAllMocks());

  it('lists the bundled packs with Export as template', async () => {
    const share = jest.spyOn(labelPackFile, 'shareLabelPackFile').mockResolvedValue(null);
    renderWithProviders(<LabelPacksSection />);
    expect(screen.getByText('No imported label packs yet.')).toBeTruthy();
    expect(screen.getAllByText('Export as template')).toHaveLength(2);
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Export as template: EDC17 engine (2.0 TDI CR)'));
    });
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ id: 'vag-edc17-03L906022' }));
    expect(screen.getByTestId('label-pack-note')).toHaveTextContent(/Could not export/);
  });

  it('imports the example pack, then Delete (after asking) restores the bundled pack', async () => {
    jest.spyOn(exchangeService, 'loadExchangeModules').mockResolvedValue(fakeModules(EXAMPLE));
    const alert = jest.spyOn(Alert, 'alert');
    renderWithProviders(<LabelPacksSection />);
    await act(async () => {
      fireEvent.press(screen.getByText('Import label pack'));
    });
    // The button and the sheet's title.
    expect(await screen.findAllByText('Import label pack')).toHaveLength(2);
    await act(async () => {
      fireEvent.press(screen.getByText('Import'));
    });
    expect(useLabelPackStore.getState().packs.map((p) => p.id)).toEqual([
      'example-edc17-03L906022',
    ]);
    expect(findLabelPack('03L906022LM')?.id).toBe('example-edc17-03L906022');
    expect(screen.getByText('Imported (1)')).toBeTruthy();

    fireEvent.press(
      screen.getByLabelText('Delete EDC17 engine (2.0 TDI CR), example community pack'),
    );
    expect(alert).toHaveBeenCalled();
    const buttons = alert.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    await act(async () => {
      buttons.find((b) => b.text === 'Delete')?.onPress?.();
    });
    expect(useLabelPackStore.getState().packs).toEqual([]);
    expect(findLabelPack('03L906022LM')?.id).toBe('vag-edc17-03L906022');
  });

  it('a corrupted pack file is refused with its errors and nothing is stored', async () => {
    const raw = JSON.parse(EXAMPLE) as { payload: { measurements: Record<string, unknown> } };
    raw.payload.measurements['17G1'] = { name: 'Bogus' };
    jest
      .spyOn(exchangeService, 'loadExchangeModules')
      .mockResolvedValue(fakeModules(JSON.stringify(raw)));
    renderWithProviders(<LabelPacksSection />);
    await act(async () => {
      fireEvent.press(screen.getByText('Import label pack'));
    });
    expect(await screen.findByText("Can't import this file")).toBeTruthy();
    expect(
      screen.getByText('/payload/measurements: key "17G1" is not a 4-digit uppercase hex DID'),
    ).toBeTruthy();
    expect(useLabelPackStore.getState().packs).toEqual([]);
  });
});
