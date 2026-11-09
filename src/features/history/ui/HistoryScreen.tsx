/** History — the per-car timeline (plan 16). One chronological list per car that merges AI runs,
 *  fault-code checks, saved module scans, trips, maintenance entries, coding backups and generated
 *  reports, grouped by day and filtered by car, kind and text. Rows deep-link: a scan opens Module
 *  scan's compare pre-selected, a trip its detail, an AI run its report (sheet), a report re-shares
 *  its file. This slice is a composition point (it reads the module-scan, trip, maintenance and
 *  coding stores) — see docs/features/history.md and docs/architecture.md. */
import React, { useEffect, useMemo, useState } from 'react';
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
import { Screen, appAlert, SegmentedControl, HIT_SLOP, usePalette, type Tone } from '@/shared/ui';
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
import { isWebRuntime } from '@/shared/lib/webRuntime';
import { translate, useTranslation } from '@/shared/i18n';
import { formatDate, formatTime } from '@/shared/lib/format';

const KIND_ICON: Record<TimelineKind, typeof Sparkles> = {
  ai: Sparkles,
  dtc: TriangleAlert,
  scan: Network,
  trip: Route,
  maintenance: Wrench,
  backup: KeyRound,
  report: FileText,
};

/** Kind chip labels in English ("Service" is the maintenance log); the screen shows the
 *  translated `history:kind.<kind>` (plan 11). */
export const KIND_LABEL: Record<TimelineKind, string> = {
  ai: 'AI',
  dtc: 'Faults',
  scan: 'Scans',
  trip: 'Trips',
  maintenance: 'Service',
  backup: 'Backups',
  report: 'Reports',
};

const TONE: Record<TimelineTone, Tone> = {
  ok: 'statusOk',
  warn: 'statusWarn',
  bad: 'statusError',
  neutral: 'statusInfo',
};

function fmtTime(ts: number): string {
  return formatTime(ts);
}

/** `YYYY-MM-DD` (local) → a date in the UI language. */
function fmtDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const ts = new Date(y, m - 1, d).getTime();
  return Number.isNaN(ts) ? day : formatDate(ts);
}

const kindLabel = (k: TimelineKind) =>
  translate(`history:kind.${k}`, { defaultValue: KIND_LABEL[k] });

/** One kind filter: several can be on at once, so each is a checkbox (plan 20). */
function KindChip({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Button
      size="$3"
      hitSlop={HIT_SLOP}
      theme={active ? 'green' : 'gray'}
      onPress={onPress}
      role="checkbox"
      accessibilityRole="checkbox"
      accessibilityState={{ checked: active, selected: active }}
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
  const palette = usePalette();
  const color = palette[TONE[item.tone]];
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
        {onPress ? <ChevronRight size={18} color={palette.muted} /> : null}
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
  if (total === 0) return translate('history:empty.none');
  const q = query.trim();
  if (q) return translate('history:empty.query', { query: q });
  if (kinds.length > 0) {
    const names = kinds.map((k) => kindLabel(k).toLowerCase()).join(', ');
    return carFiltered
      ? translate('history:empty.kindsCar', { names })
      : translate('history:empty.kinds', { names });
  }
  return translate('history:empty.car');
}

export function HistoryScreen() {
  const { t } = useTranslation('history');
  const router = useRouter();
  const palette = usePalette();
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
    if (!uri) appAlert(t('faultCodes:export.unavailable'), t('faultCodes:export.noSharing'));
  };

  const onReshare = async (entry: HistoryEntry | undefined) => {
    if (entry?.kind !== 'report') return;
    const result = await reshareReport(entry, await loadReshareModules());
    if (result === 'missing') {
      appAlert(t('reshare.missingTitle'), t('reshare.missingBody', { file: entry.fileName }));
    } else if (result === 'unavailable' && !isWebRuntime()) {
      // (In the browser the "not available on web yet" toast already explained it — plan 28.)
      appAlert(t('reshare.unavailable'), t('faultCodes:export.noSharing'));
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
    appAlert(t('clear.title'), t('clear.body'), [
      { text: t('common:actions.cancel'), style: 'cancel' },
      { text: t('clear.confirm'), style: 'destructive', onPress: () => clear() },
    ]);

  return (
    <Screen title={t('title')} subtitle={t('subtitle')}>
      {cars.length > 1 ? (
        <YStack gap="$1">
          <XStack alignItems="center" gap="$2">
            <Car size={14} color={palette.muted} />
            <Paragraph theme="alt2" fontSize="$2">
              {t('car')}
            </Paragraph>
          </XStack>
          <SegmentedControl
            label={t('carFilterA11y')}
            options={[
              { value: 'all', label: t('tripRecording:list.allCars', { count: items.length }) },
              ...cars.map((c) => ({ value: c.key, label: `${c.label} (${c.count})` })),
            ]}
            value={activeCar}
            onChange={setCarKey}
          />
        </YStack>
      ) : null}

      <XStack gap="$2" flexWrap="wrap" accessibilityLabel={t('kindsA11y')}>
        <KindChip active={kinds.length === 0} label={t('all')} onPress={() => setKinds([])} />
        {TIMELINE_KINDS.map((k) => (
          <KindChip
            key={k}
            active={kinds.includes(k)}
            label={counts[k] > 0 ? `${kindLabel(k)} (${counts[k]})` : kindLabel(k)}
            onPress={() => toggleKind(k)}
          />
        ))}
      </XStack>

      <Input
        size="$3"
        value={query}
        onChangeText={setQuery}
        placeholder={t('filterPlaceholder')}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel={t('filterA11y')}
      />

      {dtcShown.length > 0 || historyCount > 0 ? (
        <XStack gap="$2" justifyContent="flex-end">
          {dtcShown.length > 0 ? (
            <Button
              size="$3"
              hitSlop={HIT_SLOP}
              onPress={onExport}
              disabled={exporting}
              icon={<Share2 size={15} color={palette.accent} />}
              accessibilityLabel={t('exportA11y')}
            >
              {t('export')}
            </Button>
          ) : null}
          {historyCount > 0 ? (
            <Button
              size="$3"
              hitSlop={HIT_SLOP}
              theme="red"
              onPress={confirmClear}
              icon={<Trash2 size={15} />}
              accessibilityLabel={t('clearA11y')}
            >
              {t('clear.confirm')}
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
