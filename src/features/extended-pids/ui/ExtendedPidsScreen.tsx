import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { YStack, XStack, Card, Text, Paragraph, Button, Spinner, Stack, Switch, H4 } from 'tamagui';
import { Screen, ValueCard, VerificationBadge } from '@/shared/ui';
import { toHex } from '@/shared/lib/hex';
import { extendedKey } from '@/shared/obd-core/obd/liveKeys';
import type { LiveValue } from '@/shared/obd-core/session/DiagnosticSession';
import { useLabelPackFinder } from '@/shared/state/labelPackStore';
import type { ExtendedPid } from '@/shared/vehicles';
import { useSessionStore } from '@/shared/state/sessionStore';
import { useChartsStore } from '@/shared/state/chartsStore';
import { useExtendedPids } from '../hooks/useExtendedPids';
import { useMeasuringLog, type MeasuringLog } from '../hooks/useMeasuringLog';
import { useEnginePartNumber } from '../hooks/useEnginePartNumber';
import { resolveMeasuringGroups, type ResolvedGroup } from '../model/measuringGroups';

/** One VCDS-style measuring group: number, name, up to four live tiles, Log / Chart actions. */
function GroupCard({
  group,
  live,
  log,
  onLog,
  onChart,
}: {
  group: ResolvedGroup;
  live: Record<string, LiveValue>;
  log: MeasuringLog;
  onLog: (defs: ExtendedPid[]) => void;
  onChart: (defs: ExtendedPid[]) => void;
}) {
  const readable = group.defs.length > 0;
  return (
    <Card bordered padding="$3" gap="$2" testID={`group-${group.no}`}>
      <XStack justifyContent="space-between" alignItems="center" gap="$2">
        <Text fontWeight="800" flexShrink={1}>
          Group {group.no} · {group.name}
        </Text>
        <Stack backgroundColor="$yellow8" borderRadius="$10" paddingHorizontal="$2">
          <Text fontSize="$1" color="black" fontWeight="700">
            ILLUSTRATIVE
          </Text>
        </Stack>
      </XStack>
      {group.description ? (
        <Paragraph theme="alt2" fontSize="$2">
          {group.description}
        </Paragraph>
      ) : null}
      <XStack flexWrap="wrap" gap="$2">
        {group.entries.map((e) =>
          e.def ? (
            <ValueCard
              key={e.did}
              name={e.label}
              value={live[e.did]?.value ?? null}
              unit={e.unit}
            />
          ) : (
            <Paragraph key={e.did} theme="alt2" fontSize="$2" flexBasis="100%">
              No definition for {e.did} in this profile.
            </Paragraph>
          ),
        )}
      </XStack>
      <XStack gap="$2">
        <Button
          size="$3"
          flex={1}
          theme="green"
          disabled={!readable || log.recording}
          onPress={() => onLog(group.defs)}
        >
          Log group
        </Button>
        <Button
          size="$3"
          flex={1}
          theme="blue"
          disabled={!readable}
          onPress={() => onChart(group.defs)}
        >
          Chart group
        </Button>
      </XStack>
    </Card>
  );
}

export function ExtendedPidsScreen() {
  const { supported, pids, readings, live, loading, refresh } = useExtendedPids();
  const session = useSessionStore((s) => s.session);
  const log = useMeasuringLog();
  const router = useRouter();
  // Which DIDs are selected for logging.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const addPanel = useChartsStore((s) => s.addPanel);
  const partNumber = useEnginePartNumber();
  // The label-pack lookup re-resolves when the imported packs change (plan 13).
  const findLabelPack = useLabelPackFinder();
  const groups = useMemo(
    () => resolveMeasuringGroups(findLabelPack(partNumber), pids),
    [partNumber, pids, findLabelPack],
  );

  // "Chart this" / "Chart group": a new panel over the DIDs' live keys, then open Charts.
  const chart = (defs: ExtendedPid[]) => {
    if (defs.length === 0) return;
    addPanel(defs.map((d) => extendedKey(d.did)));
    router.push('/charts');
  };

  // "Log group": record exactly that group's DIDs (the per-DID toggles follow, for clarity).
  const logGroup = (defs: ExtendedPid[]) => {
    if (log.recording || defs.length === 0) return;
    setSelected(new Set(defs.map((d) => d.did)));
    log.start(defs);
  };

  // DIDs arrived-with from a fault guide deep-link (`/extended?dids=1708,1701`) — highlighted.
  const [guideDids, setGuideDids] = useState<Set<string>>(new Set());
  const params = useLocalSearchParams<{ dids?: string | string[] }>();
  const appliedRef = useRef<string | null>(null);

  // On a guide deep-link, pre-select the referenced DIDs and read them once so values show up.
  useEffect(() => {
    const raw = Array.isArray(params.dids) ? params.dids[0] : params.dids;
    if (!raw || raw === appliedRef.current) return;
    appliedRef.current = raw;
    const wanted = raw
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    const matched = pids.filter((p) => wanted.includes(p.did.toUpperCase())).map((p) => p.did);
    if (matched.length > 0) {
      setSelected(new Set(matched));
      setGuideDids(new Set(matched));
      void refresh();
    }
  }, [params.dids, pids, refresh]);

  const byDid = useMemo(() => Object.fromEntries(readings.map((r) => [r.did, r])), [readings]);

  const toggle = (did: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(did)) next.delete(did);
      else next.add(did);
      return next;
    });

  const onStartStop = async () => {
    if (log.recording) {
      await log.stop();
    } else {
      log.start(pids.filter((p) => selected.has(p.did)));
    }
  };

  if (!supported) {
    return (
      <Screen
        title="Extended PIDs"
        subtitle="Experimental manufacturer (Mode 22) reads — values must be confirmed on the real car"
      >
        <Paragraph theme="alt2">
          Not available for this vehicle/connection. Manufacturer Mode 22 reads require a CAN car
          with a profile that declares extended PIDs (e.g. the Golf Plus).
        </Paragraph>
      </Screen>
    );
  }

  return (
    <Screen
      title="Extended PIDs"
      subtitle="Experimental manufacturer (Mode 22) reads — values must be confirmed on the real car"
    >
      <YStack gap="$3">
        {groups.length > 0 ? (
          <YStack gap="$2">
            <H4>Measuring groups</H4>
            <Paragraph theme="alt2" fontSize="$2">
              VCDS-style groups from the label pack for engine part number {partNumber}. The
              groupings are illustrative until confirmed on the real car.
            </Paragraph>
            {groups.map((g) => (
              <GroupCard
                key={g.no}
                group={g}
                live={live}
                log={log}
                onLog={logGroup}
                onChart={chart}
              />
            ))}
          </YStack>
        ) : null}

        <Paragraph theme="alt2" fontSize="$2">
          Values update live while this screen is open. "Read extended PIDs" also shows the raw
          reply of every DID.
        </Paragraph>
        <Button onPress={refresh} icon={loading ? () => <Spinner /> : undefined} theme="blue">
          Read extended PIDs
        </Button>

        {/* Measuring-block logging: record the selected DIDs over time, then export/share a CSV. */}
        <Card bordered padding="$3" gap="$2" backgroundColor="$color2">
          <XStack justifyContent="space-between" alignItems="center">
            <Text fontWeight="800">Measuring-block log</Text>
            {log.recording ? (
              <XStack gap="$2" alignItems="center">
                <Spinner size="small" />
                <Text fontSize="$2" color="$red10" fontWeight="700">
                  REC · {log.sampleCount} sweeps
                </Text>
              </XStack>
            ) : null}
          </XStack>
          <Paragraph theme="alt2" fontSize="$2">
            {log.recording
              ? 'Recording the selected DIDs once per second. Stop to save and share a CSV.'
              : `Select DIDs below, then start a log. ${selected.size} selected.`}
          </Paragraph>
          <Button
            theme={log.recording ? 'red' : 'green'}
            disabled={(!log.recording && (selected.size === 0 || !session)) || log.busy}
            icon={log.busy ? () => <Spinner /> : undefined}
            onPress={onStartStop}
          >
            {log.recording ? 'Stop & share CSV' : 'Start log'}
          </Button>
        </Card>

        {pids.map((p) => {
          const r = byDid[p.did];
          // Freshest first: the measuring log's sweep (only WHILE recording — a finished log never
          // freezes a card), then the live poll loop, then the one-shot read.
          const logged = log.recording ? log.latest[p.did] : undefined;
          const value = logged ?? live[p.did]?.value ?? r?.value ?? null;
          const highlighted = guideDids.has(p.did);
          return (
            <Card
              key={p.did}
              bordered
              padding="$3"
              gap="$1"
              borderColor={highlighted ? '$blue8' : undefined}
              borderWidth={highlighted ? 2 : undefined}
            >
              <XStack justifyContent="space-between" alignItems="center">
                <XStack gap="$2" alignItems="center" flex={1}>
                  <Switch
                    size="$2"
                    checked={selected.has(p.did)}
                    disabled={log.recording}
                    onCheckedChange={() => toggle(p.did)}
                  >
                    <Switch.Thumb />
                  </Switch>
                  <Text fontWeight="800" flexShrink={1}>
                    {p.name}
                  </Text>
                </XStack>
                <VerificationBadge item={p} testID={`verify-${p.did}`} />
              </XStack>
              <Text fontSize="$7" fontWeight="900">
                {value != null ? `${value} ${p.unit}` : 'no data'}
              </Text>
              <XStack justifyContent="space-between" alignItems="center" gap="$2">
                <Paragraph theme="alt2" fontSize="$2" flexShrink={1}>
                  DID 22{p.did} · raw {r?.raw ? toHex(r.raw, ' ') : '—'}
                  {highlighted ? ' · from guide' : ''}
                </Paragraph>
                <Button size="$2" theme="alt2" onPress={() => chart([p])}>
                  Chart this
                </Button>
              </XStack>
            </Card>
          );
        })}
      </YStack>
    </Screen>
  );
}
