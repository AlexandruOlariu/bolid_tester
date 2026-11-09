/** History — the per-car timeline (plan 16). One chronological list per car that merges AI runs,
 *  fault-code checks, saved module scans, trips, maintenance entries, coding backups and generated
 *  reports, grouped by day and filtered by car, kind and text. Rows deep-link: a scan opens Module
 *  scan's compare pre-selected, a trip its detail, an AI run its report (sheet), a report re-shares
 *  its file. This slice is a composition point (it reads the module-scan, trip, maintenance and
 *  coding stores) — see docs/features/history.md and docs/architecture.md. */
import React, { useEffect, useMemo, useState } from 'react';
import { Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { Sheet, YStack, XStack, Card, Text, Paragraph, Button, Input } from 'tamagui';
import {
  Sparkles,
  TriangleAlert,
  Network,
  Route,
  Wrench,
  KeyRound,
  FileText,
  ChevronRight,
  Trash2,
  Car,
  Share2,
} from 'lucide-react-native';
import { Screen } from '@/shared/ui';
import {
  useHistoryStore,
  type AiHistoryEntry,
  type DtcHistoryEntry,
  type HistoryEntry,
} from '@/shared/state/historyStore';
import {
  TIMELINE_KINDS,
  groupByDay,
  mergeTimeline,
  summarizeTimeline,
  type TimelineItem,
  type TimelineKind,
  type TimelineTone,
} from '@/shared/lib/timeline';
import { formatDtcReport, type DtcCheckReport } from '@/shared/lib/dtcReport';
import { useDtcExport } from '@/features/fault-codes';
import { AiReportView } from '@/features/ai-diagnose';
import { useTimeline } from '../hooks/useTimeline';
import { loadReshareModules, reshareReport } from '../api/reportFile';

const KIND_ICON: Record<TimelineKind, typeof Sparkles> = {
  ai: Sparkles,
  dtc: TriangleAlert,
  scan: Network,
  trip: Route,
  maintenance: Wrench,
  backup: KeyRound,
  report: FileText,
};

/** Kind chip labels (plain English; "Service" is the maintenance log). */
export const KIND_LABEL: Record<TimelineKind, string> = {
  ai: 'AI',
  dtc: 'Faults',
  scan: 'Scans',
  trip: 'Trips',
  maintenance: 'Service',
  backup: 'Backups',
  report: 'Reports',
};

const TONE_COLOR: Record<TimelineTone, string> = {
  ok: '#2bb673',
  warn: '#d29922',
  bad: '#f85149',
  neutral: '#58a6ff',
};

function fmtTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return String(ts);
  }
}

/** `YYYY-MM-DD` (local) → the device's date format. */
function fmtDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  try {
    return new Date(y, m - 1, d).toLocaleDateString();
  } catch {
    return day;
  }
}

function Chip({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  return (
    <Button
      size="$2"
      theme={active ? 'green' : 'gray'}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      {label}
    </Button>
  );
}

function TimelineRow({
  item,
  showCar,
  onPress,
}: {
  item: TimelineItem;
  showCar: boolean;
  onPress: (() => void) | undefined;
}) {
  const Icon = KIND_ICON[item.kind];
  const color = TONE_COLOR[item.tone];
  const meta = `${fmtTime(item.ts)}${showCar ? ` · ${item.vehicleLabel}` : ''}`;
  const label = [item.title, item.subtitle, meta].filter(Boolean).join('. ');
  return (
    <Card
      bordered
      padding="$3"
      borderLeftWidth={3}
      borderLeftColor={color}
      pressStyle={onPress ? { opacity: 0.8 } : undefined}
      onPress={onPress}
      accessible
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityLabel={label}
      testID={`timeline-${item.id}`}
    >
      <XStack alignItems="center" gap="$3">
        <Icon size={18} color={color} />
        <YStack flex={1} gap="$1">
          <Text fontWeight="800">{item.title}</Text>
          {item.subtitle ? (
            <Paragraph theme="alt2" fontSize="$2">
              {item.subtitle}
            </Paragraph>
          ) : null}
          <Paragraph theme="alt2" fontSize="$1">
            {meta}
          </Paragraph>
        </YStack>
        {onPress ? <ChevronRight size={18} color="#8B949E" /> : null}
      </XStack>
    </Card>
  );
}

/** The saved AI run's full report, shown in the History sheet. `onNavigate` closes the sheet before
 *  a fault-guide button leaves the screen (History is a tab that stays mounted). */
export function AiEntryBody({
  entry,
  onNavigate,
}: {
  entry: AiHistoryEntry;
  onNavigate?: () => void;
}) {
  return (
    <YStack gap="$3">
      <YStack gap="$1">
        <Text fontWeight="800" fontSize="$6">
          {entry.vehicle.label}
        </Text>
        {entry.vehicle.vin ? (
          <Paragraph theme="alt2" fontSize="$1">
            VIN {entry.vehicle.vin}
          </Paragraph>
        ) : null}
      </YStack>
      <AiReportView
        report={entry.report}
        profileId={entry.vehicle.id}
        ranAt={entry.ts}
        onNavigate={onNavigate}
      />
    </YStack>
  );
}

function AiSheet({ entry, onClose }: { entry: AiHistoryEntry | null; onClose: () => void }) {
  return (
    <Sheet
      modal
      open={entry !== null}
      onOpenChange={(open: boolean) => {
        if (!open) onClose();
      }}
      snapPoints={[85]}
      dismissOnSnapToBottom
    >
      <Sheet.Overlay />
      <Sheet.Handle />
      <Sheet.Frame padding="$4">
        <Sheet.ScrollView>
          {entry ? <AiEntryBody entry={entry} onNavigate={onClose} /> : null}
        </Sheet.ScrollView>
      </Sheet.Frame>
    </Sheet>
  );
}

/** Empty-state copy for the current filter. */
function emptyText(
  total: number,
  kinds: TimelineKind[],
  query: string,
  carFiltered: boolean,
): string {
  if (total === 0) {
    return 'Nothing yet. Diagnoses, fault-code reads, module scans, trips, service entries, coding backups and reports appear here, newest first, grouped by car.';
  }
  const q = query.trim();
  if (q) return `Nothing matches “${q}”.`;
  if (kinds.length > 0) {
    const names = kinds.map((k) => KIND_LABEL[k].toLowerCase()).join(', ');
    return `No ${names} ${carFiltered ? 'for this car' : 'yet'}.`;
  }
  return 'Nothing for this car yet.';
}

export function HistoryScreen() {
  const router = useRouter();
  const { items, entriesById, historyCount } = useTimeline();
  const clear = useHistoryStore((s) => s.clear);
  const [carKey, setCarKey] = useState<string>('all');
  const [kinds, setKinds] = useState<TimelineKind[]>([]);
  const [query, setQuery] = useState('');
  const [aiEntry, setAiEntry] = useState<AiHistoryEntry | null>(null);
  const { exportReport, busy: exporting } = useDtcExport();

  // Distinct cars across every source, most recent first (items are newest first).
  const cars = useMemo(() => {
    const m = new Map<string, { key: string; label: string; count: number }>();
    for (const it of items) {
      const ex = m.get(it.vehicleKey);
      if (ex) ex.count += 1;
      else m.set(it.vehicleKey, { key: it.vehicleKey, label: it.vehicleLabel, count: 1 });
    }
    return [...m.values()];
  }, [items]);

  // A car filter whose car has nothing left (or no chip row any more) falls back to "All cars".
  const activeCar =
    carKey !== 'all' && cars.length > 1 && cars.some((c) => c.key === carKey) ? carKey : 'all';
  useEffect(() => {
    if (carKey !== activeCar) setCarKey('all');
  }, [carKey, activeCar]);

  const carItems = useMemo(
    () => mergeTimeline([items], { vehicleKey: activeCar }),
    [items, activeCar],
  );
  const counts = useMemo(() => summarizeTimeline(carItems), [carItems]);
  const shown = useMemo(
    () => mergeTimeline([carItems], { kinds, query }),
    [carItems, kinds, query],
  );
  const days = useMemo(() => groupByDay(shown), [shown]);

  const dtcShown = useMemo(
    () =>
      shown
        .filter((it) => it.kind === 'dtc')
        .map((it) => entriesById.get(it.sourceId))
        .filter((e): e is DtcHistoryEntry => e?.kind === 'dtc'),
    [shown, entriesById],
  );

  const toggleKind = (k: TimelineKind) =>
    setKinds((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]));

  const onExport = async () => {
    const checks: DtcCheckReport[] = dtcShown.map((e) => ({
      ts: e.ts,
      vehicleLabel: e.vehicle.label,
      vin: e.vehicle.vin,
      milOn: e.milOn,
      stored: e.stored,
      pending: e.pending,
      permanent: e.permanent,
      monitorsComplete: e.monitorsComplete,
      monitorsTotal: e.monitorsTotal,
    }));
    const body = formatDtcReport(checks, { title: 'Bolid Tester — fault-code history' });
    const uri = await exportReport('bolid-fault-history', body);
    if (!uri) Alert.alert('Export unavailable', 'Sharing is not available on this device.');
  };

  const onReshare = async (entry: HistoryEntry | undefined) => {
    if (entry?.kind !== 'report') return;
    const result = await reshareReport(entry, await loadReshareModules());
    if (result === 'missing') {
      Alert.alert(
        'File no longer on device',
        `${entry.fileName} was deleted. Make a new one from Vehicle report.`,
      );
    } else if (result === 'unavailable') {
      Alert.alert('Sharing unavailable', 'Sharing is not available on this device.');
    }
  };

  const pressFor = (it: TimelineItem): (() => void) | undefined => {
    if (it.kind === 'ai') {
      const e = entriesById.get(it.sourceId);
      return e?.kind === 'ai' ? () => setAiEntry(e) : undefined;
    }
    if (it.kind === 'report') return () => void onReshare(entriesById.get(it.sourceId));
    const link = it.link;
    if (!link) return undefined;
    return () =>
      link.params
        ? router.push({ pathname: link.route, params: link.params })
        : router.push(link.route);
  };

  const confirmClear = () =>
    Alert.alert(
      'Clear history?',
      'This permanently deletes the saved AI diagnoses, fault-code checks and report records for every car. Module scans, trips, service entries and coding backups are kept — delete those on their own screens.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear', style: 'destructive', onPress: () => clear() },
      ],
    );

  return (
    <Screen title="History" subtitle="Everything that happened to this car">
      {cars.length > 1 ? (
        <YStack gap="$1">
          <XStack alignItems="center" gap="$2">
            <Car size={14} color="#8B949E" />
            <Paragraph theme="alt2" fontSize="$2">
              Car
            </Paragraph>
          </XStack>
          <XStack gap="$2" flexWrap="wrap">
            <Chip
              active={activeCar === 'all'}
              label={`All cars (${items.length})`}
              onPress={() => setCarKey('all')}
            />
            {cars.map((c) => (
              <Chip
                key={c.key}
                active={activeCar === c.key}
                label={`${c.label} (${c.count})`}
                onPress={() => setCarKey(c.key)}
              />
            ))}
          </XStack>
        </YStack>
      ) : null}

      <XStack gap="$2" flexWrap="wrap">
        <Chip active={kinds.length === 0} label="All" onPress={() => setKinds([])} />
        {TIMELINE_KINDS.map((k) => (
          <Chip
            key={k}
            active={kinds.includes(k)}
            label={counts[k] > 0 ? `${KIND_LABEL[k]} (${counts[k]})` : KIND_LABEL[k]}
            onPress={() => toggleKind(k)}
          />
        ))}
      </XStack>

      <Input
        size="$3"
        value={query}
        onChangeText={setQuery}
        placeholder="Filter (e.g. P0299, oil, trip)"
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel="Filter the timeline"
      />

      {dtcShown.length > 0 || historyCount > 0 ? (
        <XStack gap="$2" justifyContent="flex-end">
          {dtcShown.length > 0 ? (
            <Button
              size="$2"
              onPress={onExport}
              disabled={exporting}
              icon={() => <Share2 size={15} color="#2bb673" />}
              accessibilityLabel="Export the listed fault-code checks"
            >
              Export
            </Button>
          ) : null}
          {historyCount > 0 ? (
            <Button
              size="$2"
              theme="red"
              onPress={confirmClear}
              icon={() => <Trash2 size={15} color="#fff" />}
              accessibilityLabel="Clear the diagnosis, fault-code and report history"
            >
              Clear
            </Button>
          ) : null}
        </XStack>
      ) : null}

      {days.length === 0 ? (
        <Paragraph theme="alt2">
          {emptyText(items.length, kinds, query, activeCar !== 'all')}
        </Paragraph>
      ) : (
        days.map((d) => (
          <YStack key={d.day} gap="$2">
            <Text fontWeight="800" fontSize="$3" theme="alt2" accessibilityRole="header">
              {fmtDay(d.day)}
            </Text>
            {d.items.map((it) => (
              <TimelineRow
                key={it.id}
                item={it}
                showCar={activeCar === 'all' && cars.length > 1}
                onPress={pressFor(it)}
              />
            ))}
          </YStack>
        ))
      )}

      <AiSheet entry={aiEntry} onClose={() => setAiEntry(null)} />
    </Screen>
  );
}
