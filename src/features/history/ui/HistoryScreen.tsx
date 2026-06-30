import React, { useMemo, useState } from 'react';
import { Alert } from 'react-native';
import { YStack, XStack, Card, Text, Paragraph, Button } from 'tamagui';
import { Sparkles, Shield, TriangleAlert, Trash2, Car, Share2 } from 'lucide-react-native';
import { Screen } from '@/shared/ui';
import { useHistoryStore, historyVehicleKey, historyVehicleChipLabel } from '@/shared/state/historyStore';
import type { AiHistoryEntry, DtcHistoryEntry } from '@/shared/state/historyStore';
import type { OverallHealth } from '@/shared/obd-core';
import { useDtcExport } from '@/features/fault-codes';
import { formatDtcReport, type DtcCheckReport } from '@/shared/lib/dtcReport';

const OVERALL_COLOR: Record<OverallHealth, string> = {
  ok: '#2bb673',
  attention: '#d29922',
  urgent: '#f85149',
};

type TypeFilter = 'all' | 'ai' | 'dtc';

function fmtTime(ts: number): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

function Chip({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  return (
    <Button size="$2" theme={active ? 'green' : 'gray'} onPress={onPress}>
      {label}
    </Button>
  );
}

function VinLine({ vin }: { vin: string | null }) {
  if (!vin) return null;
  return (
    <Paragraph theme="alt2" fontSize="$1">
      VIN {vin}
    </Paragraph>
  );
}

function AiCard({ e }: { e: AiHistoryEntry }) {
  const color = OVERALL_COLOR[e.overall];
  return (
    <Card bordered padding="$3" borderLeftWidth={3} borderLeftColor={color} gap="$1">
      <XStack alignItems="center" gap="$2">
        {e.source === 'ai' ? <Sparkles size={15} color={color} /> : <Shield size={15} color={color} />}
        <Text fontWeight="800" flex={1}>
          {e.vehicle.label}
        </Text>
        <Text fontWeight="800" fontSize="$1" color={color}>
          {e.overall.toUpperCase()}
        </Text>
      </XStack>
      <Paragraph theme="alt2" fontSize="$1">
        AI diagnosis · {e.source === 'ai' ? 'AI' : 'local'} · {fmtTime(e.ts)}
      </Paragraph>
      <VinLine vin={e.vehicle.vin} />
      <Paragraph fontSize="$3">{e.summary}</Paragraph>
      <Paragraph theme="alt2" fontSize="$2">
        {e.findingCount} finding(s)
      </Paragraph>
    </Card>
  );
}

function DtcCard({ e }: { e: DtcHistoryEntry }) {
  const codes = [...e.stored, ...e.pending, ...e.permanent];
  const color = e.milOn ? '#f85149' : codes.length > 0 ? '#d29922' : '#2bb673';
  return (
    <Card bordered padding="$3" borderLeftWidth={3} borderLeftColor={color} gap="$1">
      <XStack alignItems="center" gap="$2">
        <TriangleAlert size={15} color={color} />
        <Text fontWeight="800" flex={1}>
          {e.vehicle.label}
        </Text>
        {e.milOn !== null ? (
          <Text fontWeight="800" fontSize="$1" color={e.milOn ? '#f85149' : '#2bb673'}>
            MIL {e.milOn ? 'ON' : 'off'}
          </Text>
        ) : null}
      </XStack>
      <Paragraph theme="alt2" fontSize="$1">
        Fault-code check · {fmtTime(e.ts)}
      </Paragraph>
      <VinLine vin={e.vehicle.vin} />
      <Paragraph fontSize="$3">
        {e.stored.length} stored · {e.pending.length} pending · {e.permanent.length} permanent
        {e.monitorsTotal !== null ? ` · ${e.monitorsComplete}/${e.monitorsTotal} monitors` : ''}
      </Paragraph>
      <Paragraph theme="alt2" fontSize="$2">
        {codes.length > 0 ? codes.map((d) => d.code).join(', ') : 'No codes.'}
      </Paragraph>
    </Card>
  );
}

export function HistoryScreen() {
  const entries = useHistoryStore((s) => s.entries);
  const clear = useHistoryStore((s) => s.clear);
  const [carKey, setCarKey] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const { exportReport, busy: exporting } = useDtcExport();

  // Distinct cars, most-recent first (entries are already newest-first).
  const cars = useMemo(() => {
    const m = new Map<string, { key: string; label: string; count: number }>();
    for (const e of entries) {
      const key = historyVehicleKey(e.vehicle);
      const ex = m.get(key);
      if (ex) ex.count += 1;
      else m.set(key, { key, label: historyVehicleChipLabel(e.vehicle), count: 1 });
    }
    return [...m.values()];
  }, [entries]);

  const shown = useMemo(
    () =>
      entries.filter((e) => {
        if (carKey !== 'all' && historyVehicleKey(e.vehicle) !== carKey) return false;
        if (typeFilter === 'ai') return e.kind === 'ai';
        if (typeFilter === 'dtc') return e.kind === 'dtc';
        return true;
      }),
    [entries, carKey, typeFilter],
  );

  const dtcShown = useMemo(
    () => shown.filter((e): e is DtcHistoryEntry => e.kind === 'dtc'),
    [shown],
  );

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

  const confirmClear = () =>
    Alert.alert(
      'Clear history?',
      'This permanently deletes all saved diagnoses and fault-code checks for every car.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear all', style: 'destructive', onPress: () => clear() },
      ],
    );

  return (
    <Screen title="History" subtitle="Past AI diagnoses & fault-code checks, by car">
      {cars.length > 1 ? (
        <YStack gap="$1">
          <XStack alignItems="center" gap="$2">
            <Car size={14} color="#8B949E" />
            <Paragraph theme="alt2" fontSize="$2">
              Car
            </Paragraph>
          </XStack>
          <XStack gap="$2" flexWrap="wrap">
            <Chip active={carKey === 'all'} label={`All cars (${entries.length})`} onPress={() => setCarKey('all')} />
            {cars.map((c) => (
              <Chip key={c.key} active={carKey === c.key} label={`${c.label} (${c.count})`} onPress={() => setCarKey(c.key)} />
            ))}
          </XStack>
        </YStack>
      ) : null}

      <XStack gap="$2" alignItems="center" flexWrap="wrap">
        <Chip active={typeFilter === 'all'} label="All" onPress={() => setTypeFilter('all')} />
        <Chip active={typeFilter === 'ai'} label="AI" onPress={() => setTypeFilter('ai')} />
        <Chip active={typeFilter === 'dtc'} label="Faults" onPress={() => setTypeFilter('dtc')} />
        <XStack flex={1} />
        {dtcShown.length > 0 ? (
          <Button
            size="$2"
            onPress={onExport}
            disabled={exporting}
            icon={() => <Share2 size={15} color="#2bb673" />}
          >
            Export
          </Button>
        ) : null}
        {entries.length > 0 ? (
          <Button size="$2" theme="red" onPress={confirmClear} icon={() => <Trash2 size={15} color="#fff" />}>
            Clear
          </Button>
        ) : null}
      </XStack>

      {shown.length === 0 ? (
        <Paragraph theme="alt2">
          {entries.length === 0
            ? 'No history yet. Run a diagnosis or read fault codes and they’ll be saved here, grouped by car.'
            : 'Nothing for this filter.'}
        </Paragraph>
      ) : (
        <YStack gap="$2">
          {shown.map((e) => (e.kind === 'ai' ? <AiCard key={e.id} e={e} /> : <DtcCard key={e.id} e={e} />))}
        </YStack>
      )}
    </Screen>
  );
}
