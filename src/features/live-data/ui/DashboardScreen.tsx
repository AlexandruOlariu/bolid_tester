import React, { useMemo, useState } from 'react';
import { YStack, XStack, Paragraph, Button, Text, Card } from 'tamagui';
import { ArrowUp, ArrowDown, Eye, EyeOff, Sliders, Check, RotateCcw } from 'lucide-react-native';
import { Screen, Gauge, ValueCard } from '@/shared/ui';
import { useSessionStore } from '@/shared/state/sessionStore';
import { useSettingsStore } from '@/shared/state/settingsStore';
import { useVehicleStore } from '@/features/vehicle-select/model/vehicleStore';
import { getVehicleProfile } from '@/shared/vehicles';
import { convert, displayUnit, type UnitSystem } from '@/shared/lib/units';
import { fuelEconomyFromValues, FUEL_ECONOMY_PIDS, type FuelEconomyResult } from '@/shared/obd-core';
import { useLiveData } from '../hooks/useLiveData';
import { useDashboardLayoutStore } from '../model/dashboardLayoutStore';
import { itemId, orderItems, visibleItems, isHidden, type DashboardItem } from '../model/dashboardLayout';

/** Built-in arc gauges (canonical/metric bounds; converted at display time). */
const GAUGES: { pid: string; label: string; min: number; max: number; unit: string }[] = [
  { pid: '010C', label: 'RPM', min: 0, max: 6000, unit: 'rpm' },
  { pid: '010D', label: 'Speed', min: 0, max: 220, unit: 'km/h' },
  { pid: '0105', label: 'Coolant', min: -40, max: 130, unit: '°C' },
];
const GAUGE_PIDS = new Set(GAUGES.map((g) => g.pid));
const GAUGE_BY_PID = new Map(GAUGES.map((g) => [g.pid, g]));

/** Round a converted number for display (mirrors ValueCard/Gauge expectations). */
function fmt(n: number | null): number | null {
  if (n === null) return null;
  return Math.round(n * 10) / 10;
}

/** The prominent fuel-economy card, shown only when the live snapshot carries the needed PIDs. */
function FuelEconomyCard({ result, units }: { result: FuelEconomyResult; units: UnitSystem }) {
  const econ = result.litresPer100km;
  const primary =
    econ !== null
      ? (() => {
          const m = convert(econ, 'L/100km', units);
          return { value: fmt(m.value), unit: m.unit };
        })()
      : null;
  const flow = fmt(result.litresPerHour);
  return (
    <Card elevate bordered padding="$3" backgroundColor="$backgroundHover">
      <YStack gap="$1">
        <Paragraph theme="alt2" fontSize="$2" numberOfLines={1}>
          Fuel economy {result.source === 'fuel-rate' ? '(fuel-rate)' : '(from MAF)'}
        </Paragraph>
        <XStack alignItems="baseline" gap="$2" flexWrap="wrap">
          {primary && primary.value !== null ? (
            <>
              <Text fontSize="$9" fontWeight="800">
                {primary.value}
              </Text>
              <Text fontSize="$4" theme="alt2">
                {primary.unit}
              </Text>
            </>
          ) : (
            <Text fontSize="$6" fontWeight="800" theme="alt2">
              standstill
            </Text>
          )}
          {flow !== null ? (
            <Text fontSize="$3" theme="alt2">
              · {flow} L/h
            </Text>
          ) : null}
        </XStack>
      </YStack>
    </Card>
  );
}

/** One gauge with unit conversion applied. */
function GaugeItem({ pid, units, value }: { pid: string; units: UnitSystem; value: number | null }) {
  const g = GAUGE_BY_PID.get(pid)!;
  const val = convert(value, g.unit, units);
  return (
    <Gauge
      label={g.label}
      value={fmt(val.value)}
      min={fmt(convert(g.min, g.unit, units).value) ?? g.min}
      max={fmt(convert(g.max, g.unit, units).value) ?? g.max}
      unit={displayUnit(g.unit, units)}
    />
  );
}

/** One value card with unit conversion applied. */
function CardItem({
  units,
  name,
  value,
  unit,
}: {
  pid: string;
  units: UnitSystem;
  name: string;
  value: number | null;
  unit: string;
}) {
  const m = convert(value, unit, units);
  return <ValueCard name={name} value={fmt(m.value)} unit={m.unit} />;
}

export function DashboardScreen() {
  const status = useSessionStore((s) => s.status);
  const session = useSessionStore((s) => s.session);
  const selectedId = useVehicleStore((s) => s.selectedProfileId);
  const units = useSettingsStore((s) => s.units);

  const layout = useDashboardLayoutStore((s) => s.byProfile[selectedId]);
  const move = useDashboardLayoutStore((s) => s.move);
  const toggleHidden = useDashboardLayoutStore((s) => s.toggleHidden);
  const reset = useDashboardLayoutStore((s) => s.reset);
  const [editing, setEditing] = useState(false);

  // The effective (ECU-supported) PID set drives the candidate list, so hidden cards are still
  // available to un-hide in edit mode even while they aren't being polled.
  const effective = useMemo(() => {
    if (!session) return [];
    const profile = getVehicleProfile(selectedId);
    return session.effectivePids(profile.id === 'generic' ? undefined : profile.supportedPids);
  }, [session, selectedId]);

  // Candidate items: the built-in gauges first, then a card per non-gauge supported PID.
  const candidates: DashboardItem[] = useMemo(() => {
    const gauges = GAUGES.map((g) => ({ id: itemId('gauge', g.pid), pid: g.pid, kind: 'gauge' as const }));
    const cards = effective
      .filter((pid) => !GAUGE_PIDS.has(pid))
      .map((pid) => ({ id: itemId('card', pid), pid, kind: 'card' as const }));
    return [...gauges, ...cards];
  }, [effective]);

  const ordered = useMemo(() => orderItems(candidates, layout), [candidates, layout]);
  const visible = useMemo(() => visibleItems(candidates, layout), [candidates, layout]);

  // Register exactly the customized/visible PIDs, plus the fuel-economy PIDs the card needs (so
  // hiding e.g. the speed gauge doesn't starve the fuel card). EngineHost polls the union.
  const registerPids = useMemo(() => {
    const set = new Set(visible.map((i) => i.pid));
    for (const p of FUEL_ECONOMY_PIDS) if (effective.includes(p)) set.add(p);
    return [...set];
  }, [visible, effective]);

  const { values } = useLiveData(registerPids);

  const numeric = useMemo(() => {
    const out: Record<string, number | null> = {};
    for (const [pid, v] of Object.entries(values)) out[pid] = v?.value ?? null;
    return out;
  }, [values]);

  const profile = getVehicleProfile(selectedId);
  const fuel = useMemo(() => fuelEconomyFromValues(numeric, profile.fuel), [numeric, profile.fuel]);

  if (status !== 'connected') {
    return (
      <Screen title="Live data">
        <Paragraph theme="alt2">Not connected. Connect an adapter or the simulator first.</Paragraph>
      </Screen>
    );
  }

  const orderedIds = ordered.map((i) => i.id);

  return (
    <Screen title="Live data" subtitle="Streaming the parameters this ECU supports">
      <XStack justifyContent="flex-end" gap="$2">
        {editing ? (
          <Button size="$2" theme="gray" icon={<RotateCcw size={16} />} onPress={() => reset(selectedId)}>
            Reset
          </Button>
        ) : null}
        <Button
          size="$2"
          theme={editing ? 'green' : 'gray'}
          icon={editing ? <Check size={16} /> : <Sliders size={16} />}
          onPress={() => setEditing((e) => !e)}
        >
          {editing ? 'Done' : 'Customize'}
        </Button>
      </XStack>

      {fuel && !editing ? <FuelEconomyCard result={fuel} units={units} /> : null}

      {editing ? (
        <YStack gap="$2">
          <Paragraph theme="alt2" fontSize="$2">
            Reorder with the arrows and toggle visibility. Saved per vehicle profile.
          </Paragraph>
          {ordered.map((item, idx) => {
            const hidden = isHidden(item.id, layout);
            const label =
              item.kind === 'gauge'
                ? GAUGE_BY_PID.get(item.pid)?.label ?? item.pid
                : values[item.pid]?.name ?? item.pid;
            return (
              <XStack
                key={item.id}
                alignItems="center"
                gap="$2"
                borderColor="$borderColor"
                borderWidth={1}
                borderRadius="$3"
                padding="$2"
                opacity={hidden ? 0.5 : 1}
              >
                <Text flex={1} numberOfLines={1}>
                  {label} <Text theme="alt2" fontSize="$1">{item.kind === 'gauge' ? 'gauge' : item.pid}</Text>
                </Text>
                <Button
                  size="$2"
                  circular
                  disabled={idx === 0}
                  icon={<ArrowUp size={16} />}
                  onPress={() => move(selectedId, orderedIds, item.id, -1)}
                />
                <Button
                  size="$2"
                  circular
                  disabled={idx === ordered.length - 1}
                  icon={<ArrowDown size={16} />}
                  onPress={() => move(selectedId, orderedIds, item.id, 1)}
                />
                <Button
                  size="$2"
                  circular
                  theme={hidden ? 'gray' : 'green'}
                  icon={hidden ? <EyeOff size={16} /> : <Eye size={16} />}
                  onPress={() => toggleHidden(selectedId, item.id)}
                />
              </XStack>
            );
          })}
        </YStack>
      ) : (
        <>
          <XStack flexWrap="wrap" justifyContent="space-around" gap="$2">
            {visible
              .filter((i) => i.kind === 'gauge')
              .map((i) => (
                <GaugeItem key={i.id} pid={i.pid} units={units} value={numeric[i.pid] ?? null} />
              ))}
          </XStack>

          <YStack gap="$2">
            <XStack flexWrap="wrap" gap="$2">
              {visible
                .filter((i) => i.kind === 'card')
                .map((i) => (
                  <CardItem
                    key={i.id}
                    pid={i.pid}
                    units={units}
                    name={values[i.pid]?.name ?? i.pid}
                    value={numeric[i.pid] ?? null}
                    unit={values[i.pid]?.unit ?? ''}
                  />
                ))}
            </XStack>
            {visible.filter((i) => i.kind === 'card').every((i) => values[i.pid] === undefined) ? (
              <Paragraph theme="alt2">Reading…</Paragraph>
            ) : null}
          </YStack>
        </>
      )}
    </Screen>
  );
}
