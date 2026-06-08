import { useCallback, useState } from 'react';
import { useSessionStore } from '@/shared/state/sessionStore';
import { getVehicleProfile } from '@/shared/vehicles';
import { isCan } from '@/shared/obd-core/obd/protocols';
import { useVehicleStore } from '@/features/vehicle-select/model/vehicleStore';

export interface ExtendedReading {
  did: string;
  name: string;
  unit: string;
  experimental: boolean;
  raw: number[] | null;
  value: number | null;
}

/** Reads the active profile's experimental Mode 22 PIDs. Only meaningful on CAN. */
export function useExtendedPids() {
  const session = useSessionStore((s) => s.session);
  const info = useSessionStore((s) => s.info);
  const selectedId = useVehicleStore((s) => s.selectedProfileId);
  const profile = getVehicleProfile(selectedId);
  const supported = Boolean(profile.extendedPids?.length) && !!info && isCan(info.protocol);

  const [readings, setReadings] = useState<ExtendedReading[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!session || !profile.extendedPids) return;
    setLoading(true);
    try {
      const out: ExtendedReading[] = [];
      for (const e of profile.extendedPids) {
        const raw = await session.readExtended(e.did);
        out.push({
          did: e.did,
          name: e.name,
          unit: e.unit,
          experimental: e.experimental,
          raw,
          value: raw ? e.decode(raw) : null,
        });
      }
      setReadings(out);
    } finally {
      setLoading(false);
    }
  }, [session, profile]);

  return { supported, readings, loading, refresh };
}
