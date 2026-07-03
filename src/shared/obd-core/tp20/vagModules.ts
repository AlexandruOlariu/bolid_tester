/** VAG diagnostic-address → common module name, for labelling TP2.0 scans / gateway install lists
 *  (the two-digit addresses VCDS shows). Not exhaustive; unknown addresses show as the raw hex. */
export const VAG_MODULE_NAMES: Record<number, string> = {
  0x01: 'Engine',
  0x02: 'Auto transmission',
  0x03: 'ABS brakes',
  0x08: 'Auto HVAC',
  0x09: 'Central electrics',
  0x15: 'Airbag',
  0x16: 'Steering wheel',
  0x17: 'Instruments',
  0x19: 'CAN gateway',
  0x25: 'Immobilizer',
  0x2b: 'Steering column lock',
  0x37: 'Navigation',
  0x42: 'Door electronics driver',
  0x44: 'Steering assist',
  0x46: 'Central conv. (comfort)',
  0x52: 'Door electronics passenger',
  0x56: 'Radio',
};

export function vagModuleName(address: number): string {
  return VAG_MODULE_NAMES[address] ?? `Address ${address.toString(16).padStart(2, '0').toUpperCase()}`;
}
