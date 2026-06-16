import { useState } from 'react';
import { decodeVin } from '@/shared/obd-core';
import { useSessionStore } from '@/shared/state/sessionStore';

/** Decode the connected car's VIN, or a manually entered one (manual takes precedence). */
export function useVinDecode() {
  const sessionVin = useSessionStore((s) => s.info?.vin ?? null);
  const [manual, setManual] = useState('');
  const vin = (manual.trim() || sessionVin || '').toUpperCase();
  const decoded = vin ? decodeVin(vin) : null;
  return { sessionVin, manual, setManual, vin, decoded };
}
