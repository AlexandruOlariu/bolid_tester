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
  // ILLUSTRATIVE measuring groups over the profile's experimental 1701–170D DIDs, VCDS-style
  // (number → up to four values). The numbers echo familiar EDC17 groups, but which DIDs answer and
  // what VCDS groups them as is unconfirmed — prune to real ones after a capture (plan 25).
  measuringGroups: {
    '120': {
      name: 'EGR and injection',
      dids: ['1708', '1709', '170A', '170B'],
      description:
        'EGR valve position, injection quantity and the cylinder 1–2 injector corrections.',
    },
    '075': {
      name: 'Diesel particulate filter',
      dids: ['1701', '1702', '1704', '1705'],
      description:
        'Soot mass, soot load, distance since the last regeneration, regeneration count.',
    },
    '099': {
      name: 'Temperatures',
      dids: ['1706', '1707'],
      description: 'Exhaust gas temperature before the DPF and engine oil temperature.',
    },
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
