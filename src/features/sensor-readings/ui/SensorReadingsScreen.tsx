import React, { useCallback, useEffect, useState } from 'react';
import { YStack, XStack, Text, Paragraph, Card, Button, Spinner, H4 } from 'tamagui';
import { Screen, ValueCard } from '@/shared/ui';
import { useSessionStore } from '@/shared/state/sessionStore';
import { isCan } from '@/shared/obd-core';
import { getVehicleProfile } from '@/shared/vehicles';
import { logError } from '@/shared/state/errorLogStore';
import { useVehicleStore } from '@/features/vehicle-select/model/vehicleStore';
import { useLiveData } from '@/features/live-data';

/** Mode 01 PIDs grouped into human sections. PIDs the ECU doesn't support simply never appear. */
const GROUPS: { title: string; pids: string[] }[] = [
  { title: 'Engine', pids: ['010C', '010D', '0104', '0111', '010E', '011F'] },
  { title: 'Temperatures', pids: ['0105', '010F', '0146', '015C'] },
  { title: 'Air & boost', pids: ['010B', '0110', '0133'] },
  { title: 'Fuel & injection', pids: ['010A', '0122', '0123', '015E', '0106', '0107', '0144', '012F'] },
  { title: 'Electrical', pids: ['0142'] },
  { title: 'Distance', pids: ['0121', '0131'] },
];
const GROUPED_PIDS = new Set(GROUPS.flatMap((g) => g.pids));

interface InjectionReading {
  did: string;
  name: string;
  unit: string;
  value: number | null;
}

export function SensorReadingsScreen() {
  const status = useSessionStore((s) => s.status);
  const session = useSessionStore((s) => s.session);
  const selectedId = useVehicleStore((s) => s.selectedProfileId);
  const { values, polling } = useLiveData();

  const profile = getVehicleProfile(selectedId);
  const injectionPids = (profile.extendedPids ?? []).filter((p) => p.category === 'injection');
  const canInjection = injectionPids.length > 0 && isCan(session?.currentProtocol ?? 'UNKNOWN');

  const [injection, setInjection] = useState<InjectionReading[]>([]);
  const [injLoading, setInjLoading] = useState(false);

  const readInjection = useCallback(async () => {
    if (!session || !canInjection) return;
    setInjLoading(true);
    try {
      const out: InjectionReading[] = [];
      for (const p of injectionPids) {
        const raw = await session.readExtended(p.did);
        out.push({ did: p.did, name: p.name, unit: p.unit, value: raw ? p.decode(raw) : null });
      }
      setInjection(out);
    } catch (e) {
      logError({ source: 'sensor-readings', error: e, severity: 'warning' });
    } finally {
      setInjLoading(false);
    }
  }, [session, canInjection, injectionPids]);

  useEffect(() => {
    void readInjection();
  }, [readInjection]);

  if (status !== 'connected') {
    return (
      <Screen title="Sensor readings">
        <Paragraph theme="alt2">Not connected. Connect an adapter or the simulator first.</Paragraph>
      </Screen>
    );
  }

  const ungrouped = Object.values(values).filter((v) => !GROUPED_PIDS.has(v.pid));

  return (
    <Screen
      title="Sensor readings"
      subtitle={polling ? 'Live — every supported sensor, grouped' : 'Live sensors'}
    >
      {GROUPS.map((g) => {
        const items = g.pids.map((pid) => values[pid]).filter((v) => v != null);
        if (items.length === 0) return null;
        return (
          <YStack key={g.title} gap="$2">
            <Text fontWeight="800" fontSize="$5">
              {g.title}
            </Text>
            <XStack flexWrap="wrap" gap="$2">
              {items.map((v) => (
                <ValueCard key={v.pid} name={v.name} value={v.value} unit={v.unit} />
              ))}
            </XStack>
          </YStack>
        );
      })}

      {ungrouped.length > 0 ? (
        <YStack gap="$2">
          <Text fontWeight="800" fontSize="$5">
            Other
          </Text>
          <XStack flexWrap="wrap" gap="$2">
            {ungrouped.map((v) => (
              <ValueCard key={v.pid} name={v.name} value={v.value} unit={v.unit} />
            ))}
          </XStack>
        </YStack>
      ) : null}

      <YStack gap="$2">
        <XStack justifyContent="space-between" alignItems="center">
          <Text fontWeight="800" fontSize="$5">
            Injection
          </Text>
          {canInjection ? (
            <Button size="$2" onPress={readInjection} icon={injLoading ? () => <Spinner /> : undefined}>
              Refresh
            </Button>
          ) : null}
        </XStack>

        {canInjection ? (
          <XStack flexWrap="wrap" gap="$2">
            {injection.map((r) => (
              <Card key={r.did} bordered padding="$3" minWidth={150}>
                <Paragraph theme="alt2" fontSize="$2">
                  {r.name}
                </Paragraph>
                <Text fontWeight="800" fontSize="$6">
                  {r.value != null ? r.value.toFixed(2) : '—'}{' '}
                  <Text fontSize="$2" theme="alt2">
                    {r.unit}
                  </Text>
                </Text>
              </Card>
            ))}
            {injection.length === 0 && !injLoading ? (
              <Paragraph theme="alt2">Reading…</Paragraph>
            ) : null}
          </XStack>
        ) : (
          <Card bordered padding="$3" gap="$1">
            <H4>Per-injector data isn’t available here</H4>
            <Paragraph theme="alt2" size="$2">
              Injection quantity, balance and per-cylinder corrections live in manufacturer measuring
              blocks (VAG groups), which a generic ELM327 cannot read over standard OBD-II on this car —
              especially on a K-line ECU. The fuel-system parameters in “Fuel & injection” above (rail
              pressure, fuel rate, fuel trims) are what is available generically; full injector data
              needs VCDS-style / enhanced tooling.
            </Paragraph>
          </Card>
        )}
      </YStack>
    </Screen>
  );
}
