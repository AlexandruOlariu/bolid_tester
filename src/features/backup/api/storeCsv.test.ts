import {
  csvCell,
  historyCsv,
  maintenanceCsv,
  maintenanceEntryCount,
  scansCsv,
  HISTORY_CSV_HEADER,
} from './storeCsv';

const T = Date.UTC(2026, 10, 9, 14, 30);
const VEHICLE = { id: 'golf', label: 'VW Golf, Plus', vin: 'WVWZZZ1KZ9W903398' };

const lines = (csv: string) => csv.trimEnd().split('\r\n');

describe('csvCell', () => {
  it('quotes commas, quotes and line breaks', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(false)).toBe('false');
  });
});

describe('historyCsv', () => {
  it('writes one row per code of each fault-code check, and one row for a clean check', () => {
    const csv = historyCsv({
      entries: [
        {
          kind: 'dtc',
          id: '1',
          ts: T,
          vehicle: VEHICLE,
          milOn: true,
          stored: [{ code: 'P0299', description: 'Turbo underboost' }],
          pending: [{ code: 'P0401', description: 'EGR flow' }],
          permanent: [],
          monitorsComplete: 5,
          monitorsTotal: 7,
        },
        {
          kind: 'dtc',
          id: '2',
          ts: T,
          vehicle: VEHICLE,
          milOn: false,
          stored: [],
          pending: [],
          permanent: [],
          monitorsComplete: null,
          monitorsTotal: null,
        },
        { kind: 'ai', id: '3', ts: T, vehicle: VEHICLE },
      ],
    });
    const rows = lines(csv);
    expect(rows[0]).toBe(HISTORY_CSV_HEADER.join(','));
    expect(rows.slice(1)).toEqual([
      '2026-11-09T14:30:00.000Z,"VW Golf, Plus",WVWZZZ1KZ9W903398,true,stored,P0299,Turbo underboost',
      '2026-11-09T14:30:00.000Z,"VW Golf, Plus",WVWZZZ1KZ9W903398,true,pending,P0401,EGR flow',
      '2026-11-09T14:30:00.000Z,"VW Golf, Plus",WVWZZZ1KZ9W903398,false,,,No fault codes',
    ]);
  });

  it('tolerates a malformed state', () => {
    expect(lines(historyCsv(null))).toHaveLength(1);
    expect(lines(historyCsv({ entries: 'x' }))).toHaveLength(1);
  });
});

describe('scansCsv', () => {
  it('writes one row per module fault, UDS and TP2.0', () => {
    const csv = scansCsv({
      scans: [
        {
          id: 's1',
          ts: T,
          vehicle: VEHICLE,
          protocol: 'CAN',
          modules: [
            {
              address: '01',
              name: 'Engine',
              state: 'ok',
              dtcs: [
                {
                  sae: 'P2183',
                  display: 'P2183 00',
                  vagCode: '08579',
                  description: 'ECT 2',
                  status: 9,
                },
              ],
            },
            { address: '03', name: 'ABS', state: 'ok', dtcs: [] },
          ],
          tp20: {
            installed: [0x17],
            modules: [
              {
                address: 0x17,
                name: 'Cluster',
                state: 'ok',
                dtcs: [{ vag: '01314', status: 0x2c }],
              },
            ],
          },
        },
      ],
    });
    const rows = lines(csv).slice(1);
    expect(rows).toEqual([
      '2026-11-09T14:30:00.000Z,"VW Golf, Plus",WVWZZZ1KZ9W903398,s1,01,Engine,P2183 00,08579,ECT 2,09',
      '2026-11-09T14:30:00.000Z,"VW Golf, Plus",WVWZZZ1KZ9W903398,s1,17,Cluster,,01314,,2C',
    ]);
  });
});

describe('maintenanceCsv', () => {
  const state = {
    byVehicle: {
      'id:golf': {
        entries: [
          { id: 'a', itemId: 'engine-oil', date: T - 86_400_000, odoKm: 180_000 },
          { id: 'b', itemId: 'air-filter', date: T, odoKm: 182_000, note: 'OEM, Mann' },
        ],
        odoKm: 182_000,
        kmPerYear: 15_000,
      },
    },
  };

  it('writes one row per entry, newest first, with the item name and km', () => {
    expect(lines(maintenanceCsv(state)).slice(1)).toEqual([
      'id:golf,2026-11-09T14:30:00.000Z,Air filter,182000,"OEM, Mann"',
      'id:golf,2026-11-08T14:30:00.000Z,Engine oil & filter,180000,',
    ]);
    expect(lines(maintenanceCsv(state))[0]).toBe('car,date_utc,item,odometer_km,note');
  });

  it('counts the entries across cars', () => {
    expect(maintenanceEntryCount(state)).toBe(2);
    expect(maintenanceEntryCount({})).toBeNull();
  });
});
