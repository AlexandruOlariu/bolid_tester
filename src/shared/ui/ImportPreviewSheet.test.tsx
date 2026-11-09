/** The import preview (plan 13): a refused file lists the validator's first three errors and
 *  changes nothing; a profile imports as a garage car; a second import offers Replace / Keep both;
 *  a label pack shows its counts and the overlap with the bundled pack. */
import React from 'react';
import * as fs from 'fs';
import * as path from 'path';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { renderWithProviders } from '@test/renderWithProviders';
import { useGarageStore } from '@/shared/state/garageStore';
import { useLabelPackStore } from '@/shared/state/labelPackStore';
import { isParseError, parseExchangeFile, type ParsedExchange } from '@/shared/lib/exchange';
import { previewImport } from '@/shared/state/exchangeService';
import { ImportPreviewBody } from './ImportPreviewSheet';

const EXAMPLES = path.resolve(__dirname, '../../../docs/examples');
const example = (name: string) => fs.readFileSync(path.join(EXAMPLES, name), 'utf8');

function parsed(text: string): ParsedExchange {
  const r = parseExchangeFile(text);
  if (isParseError(r)) throw new Error(r.error);
  return r;
}

async function press(text: string | RegExp) {
  await act(async () => {
    fireEvent.press(screen.getByText(text));
  });
}

describe('ImportPreviewBody', () => {
  it("a corrupted file shows the validator's first three errors and changes nothing", () => {
    const raw = JSON.parse(example('profile.example.json')) as {
      payload: { vehicle: Record<string, unknown> };
    };
    Object.assign(raw.payload.vehicle, { name: '', year: 'x', fuel: 'coal', baseProfileId: '!' });
    const r = parseExchangeFile(JSON.stringify(raw));
    if (!isParseError(r)) throw new Error('expected a parse error');
    const onClose = jest.fn();
    renderWithProviders(<ImportPreviewBody pending={r} onClose={onClose} />);

    expect(screen.getByText("Can't import this file")).toBeTruthy();
    expect(screen.getByText('This profile file is not valid.')).toBeTruthy();
    expect(screen.getByText('/payload/vehicle/name: must not be empty')).toBeTruthy();
    expect(screen.getByText('/payload/vehicle/year: expected a number, got "x"')).toBeTruthy();
    expect(screen.getByText(/^\/payload\/vehicle\/fuel: /)).toBeTruthy();
    expect(screen.queryByText(/^\/payload\/vehicle\/baseProfileId/)).toBeNull();
    expect(screen.getByText('…and 1 more.')).toBeTruthy();
    expect(screen.getByText('Nothing was changed.')).toBeTruthy();
    fireEvent.press(screen.getByText('Close'));
    expect(onClose).toHaveBeenCalled();
    expect(useGarageStore.getState().vehicles).toEqual([]);
  });

  it('imports a profile as a garage car, then offers Replace / Keep both', async () => {
    const text = example('profile.example.json');
    renderWithProviders(
      <ImportPreviewBody pending={previewImport(parsed(text))} onClose={jest.fn()} />,
    );
    expect(screen.getByText('Import car profile')).toBeTruthy();
    expect(screen.getByText('Not learned yet — connect to the car to learn it')).toBeTruthy();
    expect(screen.getByText('Based on')).toBeTruthy();
    await press('Import');
    expect(screen.getByText('Imported VW Golf Plus 2009 2.0 TDI 81 kW.')).toBeTruthy();
    expect(useGarageStore.getState().vehicles.map((v) => v.baseProfileId)).toEqual([
      'golf-plus-2009-20tdi',
    ]);

    screen.unmount();
    renderWithProviders(
      <ImportPreviewBody pending={previewImport(parsed(text))} onClose={jest.fn()} />,
    );
    expect(screen.getByText(/already has a car named VW Golf Plus/)).toBeTruthy();
    expect(screen.getByText('Replace')).toBeTruthy();
    expect(screen.getByText('Cancel')).toBeTruthy();
    await press('Keep both');
    expect(useGarageStore.getState().vehicles.map((v) => v.name)).toEqual([
      'VW Golf Plus 2009 2.0 TDI 81 kW',
      'VW Golf Plus 2009 2.0 TDI 81 kW (2)',
    ]);
  });

  it('previews a label pack with its counts and the bundled-pack overlap', async () => {
    renderWithProviders(
      <ImportPreviewBody
        pending={previewImport(parsed(example('label-pack.example.json')))}
        onClose={jest.fn()}
      />,
    );
    expect(screen.getByText('Import label pack')).toBeTruthy();
    expect(
      screen.getByText('10 measurements · 0 coding bits · 2 adaptations · 3 measuring groups'),
    ).toBeTruthy();
    expect(screen.getByText('CC0-1.0')).toBeTruthy();
    expect(
      screen.getByText(
        'This pack also matches prefix 03L906022 used by the bundled EDC17 engine (2.0 TDI CR) pack; the imported names will take precedence.',
      ),
    ).toBeTruthy();
    await press('Import');
    expect(useLabelPackStore.getState().packs.map((p) => p.id)).toEqual([
      'example-edc17-03L906022',
    ]);
  });
});
