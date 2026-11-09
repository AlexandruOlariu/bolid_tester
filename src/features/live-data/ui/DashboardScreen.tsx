import React, { useCallback, useMemo, useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';
import { YStack, XStack, Paragraph, Button, Text, Card } from 'tamagui';
import { ArrowUp, ArrowDown, Eye, EyeOff, Sliders, Check, RotateCcw } from 'lucide-react-native';
import {
  Screen,
  Gauge,
  ValueCard,
  useLayoutClass,
  isTwoPane,
  HIT_SLOP,
  LARGE_TEXT_FONT_SCALE,
} from '@/shared/ui';
import { useSessionStore } from '@/shared/state/sessionStore';
import { livePidFilter } from '@/shared/vehicles';
import { useActiveProfile } from '@/shared/state/activeProfile';
import {
  fuelEconomyFromValues,
  FUEL_ECONOMY_PIDS,
  type FuelEconomyResult,
} from '@/shared/obd-core';
import { useLiveData } from '../hooks/useLiveData';
import { useDashboardLayoutStore } from '../model/dashboardLayoutStore';
import {
  itemId,
  orderItems,
  visibleItems,
  isHidden,
  presetFor,
  type DashboardItem,
} from '../model/dashboardLayout';
import {
  CARD_GAP,
  COLUMN_GAP,
  cardWidth,
  leftColumnWidth,
  rightColumnWidth,
} from '../model/twoPaneGrid';
import { SensorGroups } from './SensorGroups';

/** The two views of the Live tab (plan 07): the customisable dashboard, or every sensor grouped. */
type LiveView = 'dashboard' | 'sensors';

/** Built-in arc gauges. The app is metric only: values and bounds are shown as decoded. */
const GAUGES: { pid: string; label: string; min: number; max: number; unit: string }[] = [
  { pid: '010C', label: 'RPM', min: 0, max: 6000, unit: 'rpm' },
  { pid: '010D', label: 'Speed', min: 0, max: 220, unit: 'km/h' },
  { pid: '0105', label: 'Coolant', min: -40, max: 130, unit: '°C' },
];
const GAUGE_PIDS = new Set(GAUGES.map((g) => g.pid));
const GAUGE_BY_PID = new Map(GAUGES.map((g) => [g.pid, g]));

/** Round a number for display to one decimal (mirrors ValueCard/Gauge expectations). */
function fmt(n: number | null): number | null {
  if (n === null) return null;
  return Math.round(n * 10) / 10;
}

/** The prominent fuel-economy card, shown only when the live snapshot carries the needed PIDs. */
function FuelEconomyCard({ result }: { result: FuelEconomyResult }) {
  const econ = fmt(result.litresPer100km);
  const flow = fmt(result.litresPerHour);
  return (
    <Card elevate bordered padding="$3" backgroundColor="$backgroundHover">
      <YStack gap="$1">
        <Paragraph theme="alt2" fontSize="$2" numberOfLines={1}>
          Fuel economy {result.source === 'fuel-rate' ? '(fuel-rate)' : '(from MAF)'}
        </Paragraph>
        <XStack alignItems="baseline" gap="$2" flexWrap="wrap">
          {econ !== null ? (
            <>
              <Text fontSize="$9" fontWeight="800" maxFontSizeMultiplier={1.3}>
                {econ}
              </Text>
              <Text fontSize="$4" theme="alt2">
                L/100km
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

/** One built-in gauge, in its own (metric) unit. */
function GaugeItem({ pid, value, size }: { pid: string; value: number | null; size?: number }) {
  const g = GAUGE_BY_PID.get(pid)!;
  return (
    <Gauge label={g.label} value={fmt(value)} min={g.min} max={g.max} unit={g.unit} size={size} />
  );
}

/** `Screen`'s horizontal padding on medium / expanded windows (24 dp a side). */
const ROOMY_PADDING = 24;

/** The Dashboard | All sensors switch under the title. */
function ViewSwitch({ view, onChange }: { view: LiveView; onChange: (v: LiveView) => void }) {
  const options: { id: LiveView; label: string }[] = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'sensors', label: 'All sensors' },
  ];
  return (
    <XStack gap="$2" accessibilityRole="tablist">
      {options.map((o) => (
        <Button
          key={o.id}
          flex={1}
          size="$3"
          hitSlop={HIT_SLOP}
          theme={view === o.id ? 'green' : 'gray'}
          accessible
          role="tab"
          accessibilityRole="tab"
          accessibilityLabel={o.label}
          accessibilityState={{ selected: view === o.id }}
          onPress={() => onChange(o.id)}
        >
          {o.label}
        </Button>
      ))}
    </XStack>
  );
}

export function DashboardScreen() {
  const status = useSessionStore((s) => s.status);
  const session = useSessionStore((s) => s.session);
  const profile = useActiveProfile();
  const selectedId = profile.id;
  const [view, setView] = useState<LiveView>('dashboard');
  const win = useLayoutClass();
  const twoPane = isTwoPane(win);
  // Plan 21: the two-pane row measures itself, so the side rail and the screen padding are already
  // taken out of the column / card widths. Until the first layout, estimate the row from the window.
  const [measuredRow, setMeasuredRow] = useState<number | null>(null);
  const onRowLayout = useCallback((e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width);
    if (w > 0) setMeasuredRow(w);
  }, []);

  // A car with no saved Customize layout starts from its fuel preset (plan 07).
  const saved = useDashboardLayoutStore((s) => s.byProfile[selectedId]);
  const preset = useMemo(() => presetFor(profile.fuel), [profile.fuel]);
  const layout = saved ?? preset;
  const move = useDashboardLayoutStore((s) => s.move);
  const toggleHidden = useDashboardLayoutStore((s) => s.toggleHidden);
  const reset = useDashboardLayoutStore((s) => s.reset);
  const [editing, setEditing] = useState(false);

  // The effective (ECU-supported) PID set drives the candidate list, so hidden cards are still
  // available to un-hide in edit mode even while they aren't being polled.
  const effective = useMemo(() => {
    if (!session) return [];
    return session.effectivePids(livePidFilter(profile));
  }, [session, profile]);

  // Candidate items: the built-in gauges first, then a card per non-gauge supported PID.
  const candidates: DashboardItem[] = useMemo(() => {
    const gauges = GAUGES.map((g) => ({
      id: itemId('gauge', g.pid),
      pid: g.pid,
      kind: 'gauge' as const,
    }));
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

  // The All sensors view registers the whole effective set itself (SensorGroups → useLiveData()).
  const { values } = useLiveData(view === 'dashboard' ? registerPids : []);

  const numeric = useMemo(() => {
    const out: Record<string, number | null> = {};
    for (const [pid, v] of Object.entries(values)) out[pid] = v?.value ?? null;
    return out;
  }, [values]);

  const fuel = useMemo(() => fuelEconomyFromValues(numeric, profile.fuel), [numeric, profile.fuel]);

  if (status !== 'connected') {
    return (
      <Screen title="Live data">
        <Paragraph theme="alt2">
          Not connected. Connect an adapter or the simulator first.
        </Paragraph>
      </Screen>
    );
  }

  const orderedIds = ordered.map((i) => i.id);

  if (view === 'sensors') {
    return (
      <Screen title="Live data" subtitle="Every sensor this ECU reports, grouped by system">
        <ViewSwitch view={view} onChange={setView} />
        <SensorGroups />
      </Screen>
    );
  }

  const gaugeSize = win.cls === 'expanded' ? 180 : undefined;
  const largeText = win.fontScale > LARGE_TEXT_FONT_SCALE;
  const gauges = (
    <XStack flexWrap="wrap" justifyContent="space-around" gap="$2">
      {visible
        .filter((i) => i.kind === 'gauge')
        .map((i) => (
          <GaugeItem key={i.id} pid={i.pid} value={numeric[i.pid] ?? null} size={gaugeSize} />
        ))}
    </XStack>
  );
  const fuelCard = fuel && !(editing && !twoPane) ? <FuelEconomyCard result={fuel} /> : null;
  const visibleGauges = visible.some((i) => i.kind === 'gauge');
  // The gauge column is left out when it would be empty (every gauge hidden, no fuel economy).
  const hasLeft = visibleGauges || fuelCard !== null;
  const rowWidth = measuredRow ?? Math.max(0, win.width - 2 * ROOMY_PADDING);
  // Up to three cards per row on expanded, two on medium — fewer when they would drop under 150 dp
  // — each sized so the row is filled exactly. With large text, one card per row (plan 20).
  const cardW = twoPane
    ? cardWidth(rightColumnWidth(rowWidth, hasLeft), largeText ? 1 : win.cls === 'expanded' ? 3 : 2)
    : undefined;
  const cardItems = visible.filter((i) => i.kind === 'card');
  const cards = (
    <YStack gap="$2">
      <XStack flexWrap="wrap" gap={CARD_GAP}>
        {cardItems.map((i) => (
          <ValueCard
            key={i.id}
            name={values[i.pid]?.name ?? i.pid}
            value={fmt(numeric[i.pid] ?? null)}
            unit={values[i.pid]?.unit ?? ''}
            width={cardW}
          />
        ))}
      </XStack>
      {cardItems.every((i) => values[i.pid] === undefined) ? (
        <Paragraph theme="alt2">Reading…</Paragraph>
      ) : null}
    </YStack>
  );
  const editList = (
    <YStack gap="$2">
      <Paragraph theme="alt2" fontSize="$2">
        Reorder with the arrows and toggle visibility. Saved per vehicle profile; Reset goes back to
        the default for this car's fuel type.
      </Paragraph>
      {ordered.map((item, idx) => {
        const hidden = isHidden(item.id, layout);
        const label =
          item.kind === 'gauge'
            ? (GAUGE_BY_PID.get(item.pid)?.label ?? item.pid)
            : (values[item.pid]?.name ?? item.pid);
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
              {label}{' '}
              <Text theme="alt2" fontSize="$1">
                {item.kind === 'gauge' ? 'gauge' : item.pid}
              </Text>
            </Text>
            {/* Icon-only buttons: each names its action (plan 20), 36 dp + 8 dp slop. */}
            <Button
              size="$3"
              circular
              hitSlop={HIT_SLOP}
              disabled={idx === 0}
              icon={<ArrowUp size={16} />}
              accessibilityLabel={`Move ${label} up`}
              accessibilityState={{ disabled: idx === 0 }}
              onPress={() => move(selectedId, orderedIds, item.id, -1)}
            />
            <Button
              size="$3"
              circular
              hitSlop={HIT_SLOP}
              disabled={idx === ordered.length - 1}
              icon={<ArrowDown size={16} />}
              accessibilityLabel={`Move ${label} down`}
              accessibilityState={{ disabled: idx === ordered.length - 1 }}
              onPress={() => move(selectedId, orderedIds, item.id, 1)}
            />
            <Button
              size="$3"
              circular
              hitSlop={HIT_SLOP}
              theme={hidden ? 'gray' : 'green'}
              icon={hidden ? <EyeOff size={16} /> : <Eye size={16} />}
              accessibilityLabel={hidden ? `Show ${label}` : `Hide ${label}`}
              onPress={() => toggleHidden(selectedId, item.id, layout)}
            />
          </XStack>
        );
      })}
    </YStack>
  );

  return (
    <Screen title="Live data" subtitle="Streaming the parameters this ECU supports" wide={twoPane}>
      <ViewSwitch
        view={view}
        onChange={(v) => {
          setEditing(false);
          setView(v);
        }}
      />
      <XStack justifyContent="flex-end" gap="$2">
        {editing ? (
          <Button
            size="$3"
            hitSlop={HIT_SLOP}
            theme="gray"
            icon={<RotateCcw size={16} />}
            onPress={() => reset(selectedId)}
          >
            Reset
          </Button>
        ) : null}
        <Button
          size="$3"
          hitSlop={HIT_SLOP}
          theme={editing ? 'green' : 'gray'}
          icon={editing ? <Check size={16} /> : <Sliders size={16} />}
          onPress={() => setEditing((e) => !e)}
        >
          {editing ? 'Done' : 'Customize'}
        </Button>
      </XStack>

      {twoPane ? (
        // Plan 21: gauges + fuel economy in a left column (dropped when empty), the value cards (or
        // the Customize list) in the right one.
        <XStack testID="live-row" gap={COLUMN_GAP} alignItems="flex-start" onLayout={onRowLayout}>
          {hasLeft ? (
            <YStack testID="live-left" width={leftColumnWidth(rowWidth)} gap="$3">
              {visibleGauges ? gauges : null}
              {fuelCard}
            </YStack>
          ) : null}
          <YStack testID="live-right" flex={1} minWidth={0} gap="$2">
            {editing ? editList : cards}
          </YStack>
        </XStack>
      ) : (
        <>
          {fuelCard}
          {editing ? (
            editList
          ) : (
            <>
              {gauges}
              {cards}
            </>
          )}
        </>
      )}
    </Screen>
  );
}
