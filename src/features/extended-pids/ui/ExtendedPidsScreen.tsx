import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { YStack, XStack, Card, Text, Paragraph, Button, Spinner, Stack, H4 } from 'tamagui';
import { Screen, ValueCard, VerificationBadge, HIT_SLOP, AccessibleSwitch } from '@/shared/ui';
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
import { useTranslation } from '@/shared/i18n';

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
  const { t } = useTranslation('extendedPids');
  const readable = group.defs.length > 0;
  return (
    <Card bordered padding="$3" gap="$2" testID={`group-${group.no}`}>
      <XStack justifyContent="space-between" alignItems="center" gap="$2">
        <Text fontWeight="800" flexShrink={1}>
          {t('group.title', { no: group.no, name: group.name })}
        </Text>
        <Stack backgroundColor="$statusWarn" borderRadius="$10" paddingHorizontal="$2">
          <Text fontSize="$1" color="$onFill" fontWeight="700">
            {t('group.illustrative')}
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
              {t('group.noDefinition', { did: e.did })}
            </Paragraph>
          ),
        )}
      </XStack>
      <XStack gap="$2">
        <Button
          size="$3"
          hitSlop={HIT_SLOP}
          flex={1}
          theme="green"
          disabled={!readable || log.recording}
          onPress={() => onLog(group.defs)}
        >
          {t('group.log')}
        </Button>
        <Button
          size="$3"
          hitSlop={HIT_SLOP}
          flex={1}
          theme="blue"
          disabled={!readable}
          onPress={() => onChart(group.defs)}
        >
          {t('group.chart')}
        </Button>
      </XStack>
    </Card>
  );
}

export function ExtendedPidsScreen() {
  const { t } = useTranslation('extendedPids');
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
      <Screen title={t('title')} subtitle={t('subtitle')}>
        <Paragraph theme="alt2">{t('unavailable')}</Paragraph>
      </Screen>
    );
  }

  return (
    <Screen title={t('title')} subtitle={t('subtitle')}>
      <YStack gap="$3">
        {groups.length > 0 ? (
          <YStack gap="$2">
            <H4>{t('groups')}</H4>
            <Paragraph theme="alt2" fontSize="$2">
              {t('groupsHelp', { part: partNumber })}
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
          {t('liveHelp')}
        </Paragraph>
        <Button onPress={refresh} icon={loading ? () => <Spinner /> : undefined} theme="blue">
          {t('read')}
        </Button>

        {/* Measuring-block logging: record the selected DIDs over time, then export/share a CSV. */}
        <Card bordered padding="$3" gap="$2" backgroundColor="$color2">
          <XStack justifyContent="space-between" alignItems="center">
            <Text fontWeight="800">{t('log.title')}</Text>
            {log.recording ? (
              <XStack gap="$2" alignItems="center">
                <Spinner size="small" />
                <Text fontSize="$2" color="$statusError" fontWeight="700">
                  {t('log.rec', { count: log.sampleCount })}
                </Text>
              </XStack>
            ) : null}
          </XStack>
          <Paragraph theme="alt2" fontSize="$2">
            {log.recording ? t('log.recording') : t('log.select', { count: selected.size })}
          </Paragraph>
          <Button
            theme={log.recording ? 'red' : 'green'}
            disabled={(!log.recording && (selected.size === 0 || !session)) || log.busy}
            icon={log.busy ? () => <Spinner /> : undefined}
            onPress={onStartStop}
          >
            {log.recording ? t('log.stop') : t('log.start')}
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
                  <AccessibleSwitch
                    checked={selected.has(p.did)}
                    disabled={log.recording}
                    onCheckedChange={() => toggle(p.did)}
                    accessibilityLabel={t('logA11y', { name: p.name })}
                  />
                  <Text fontWeight="800" flexShrink={1}>
                    {p.name}
                  </Text>
                </XStack>
                <VerificationBadge item={p} testID={`verify-${p.did}`} />
              </XStack>
              <Text fontSize="$7" fontWeight="900">
                {value != null ? `${value} ${p.unit}` : t('noData')}
              </Text>
              <XStack justifyContent="space-between" alignItems="center" gap="$2">
                <Paragraph theme="alt2" fontSize="$2" flexShrink={1}>
                  DID 22{p.did} · {t('raw', { raw: r?.raw ? toHex(r.raw, ' ') : '—' })}
                  {highlighted ? ` · ${t('fromGuide')}` : ''}
                </Paragraph>
                <Button size="$3" hitSlop={HIT_SLOP} theme="alt2" onPress={() => chart([p])}>
                  {t('chartThis')}
                </Button>
              </XStack>
            </Card>
          );
        })}
      </YStack>
    </Screen>
  );
}
