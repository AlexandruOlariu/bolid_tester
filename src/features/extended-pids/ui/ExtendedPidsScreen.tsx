import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { YStack, XStack, Card, Text, Paragraph, Button, Spinner, Stack, Switch } from 'tamagui';
import { Screen } from '@/shared/ui';
import { toHex } from '@/shared/lib/hex';
import { useSessionStore } from '@/shared/state/sessionStore';
import { useExtendedPids } from '../hooks/useExtendedPids';
import { useMeasuringLog } from '../hooks/useMeasuringLog';

export function ExtendedPidsScreen() {
  const { supported, pids, readings, loading, refresh } = useExtendedPids();
  const session = useSessionStore((s) => s.session);
  const log = useMeasuringLog();

  // Which DIDs are selected for logging.
  const [selected, setSelected] = useState<Set<string>>(new Set());
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
          Not available for this vehicle/connection. Manufacturer Mode 22 reads require a CAN car with
          a profile that declares extended PIDs (e.g. the Golf Plus).
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
          const value = p.did in log.latest ? log.latest[p.did] : r?.value ?? null;
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
                {p.experimental ? (
                  <Stack backgroundColor="$yellow8" borderRadius="$10" paddingHorizontal="$2">
                    <Text fontSize="$1" color="black" fontWeight="700">
                      EXPERIMENTAL
                    </Text>
                  </Stack>
                ) : null}
              </XStack>
              <Text fontSize="$7" fontWeight="900">
                {value != null ? `${value} ${p.unit}` : 'no data'}
              </Text>
              <Paragraph theme="alt2" fontSize="$2">
                DID 22{p.did} · raw {r?.raw ? toHex(r.raw, ' ') : '—'}
                {highlighted ? ' · from guide' : ''}
              </Paragraph>
            </Card>
          );
        })}
      </YStack>
    </Screen>
  );
}
