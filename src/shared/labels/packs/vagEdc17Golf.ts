import { LabelPack } from '../types';

/** EDC17-family engine ECU labels for the 03L906022* part numbers (2.0 TDI CR, e.g. the Golf
 *  Plus 2009 example car). ILLUSTRATIVE — DIDs mirror the profile's experimental extended PIDs
 *  and must be confirmed on the real car. */
export const vagEdc17Golf: LabelPack = {
  id: 'vag-edc17-03L906022',
  module: 'EDC17 engine (2.0 TDI CR)',
  partNumberPrefixes: ['03L906022'],
  measurements: {
    '1701': { name: 'DPF soot mass (calculated)', unit: 'g' },
    '1702': { name: 'DPF soot load', unit: '%' },
    '1703': { name: 'DPF ash load', unit: 'g' },
    '1704': { name: 'Distance since last regeneration', unit: 'km' },
    '1705': { name: 'Successful regenerations', unit: '' },
    '1706': { name: 'Exhaust gas temperature before DPF', unit: '°C' },
    '1707': { name: 'Oil temperature', unit: '°C' },
    '1708': { name: 'EGR valve position', unit: '%' },
    '1709': { name: 'Injection quantity', unit: 'mg/str' },
  },
  adaptations: {
    '3001': {
      name: 'Idle speed offset',
      unit: 'rpm',
      description: 'Base idle target adjustment. Small steps; engine warm.',
    },
    '3002': {
      name: 'EGR base duty',
      unit: '%',
      description: 'EGR base duty correction. Emissions-relevant — change only with cause.',
    },
  },
};
