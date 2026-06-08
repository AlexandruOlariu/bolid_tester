import { useSessionStore } from '@/shared/state/sessionStore';
import { PROTOCOL_LABELS } from '@/shared/obd-core/obd/protocols';

export function useVehicleInfo() {
  const info = useSessionStore((s) => s.info);
  const deviceName = useSessionStore((s) => s.deviceName);
  return {
    info,
    deviceName,
    protocolLabel: info ? PROTOCOL_LABELS[info.protocol] : '—',
  };
}
