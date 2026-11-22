import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWindowDimensions } from 'react-native';
import { YStack, XStack, Text, Paragraph, Card, Button, Spinner, H4 } from 'tamagui';
import { ValueCard, SectionTitle, HIT_SLOP, LARGE_TEXT_FONT_SCALE } from '@/shared/ui';
import { useSessionStore } from '@/shared/state/sessionStore';
import { isCan, isExtendedKey } from '@/shared/obd-core';
import { logError } from '@/shared/state/errorLogStore';
import { useActiveProfile } from '@/shared/state/activeProfile';
import { useLiveData } from '../hooks/useLiveData';
import { useTranslation } from '@/shared/i18n';
import { formatFixed } from '@/shared/lib/format';

/** Live → **All sensors** (plan 07; was the standalone Sensor readings screen): every live Mode 01
 *  value grouped by system, then the profile's injection DIDs on CAN cars. Rendered by
 *  DashboardScreen while its "All sensors" segment is selected, so it mounts only then: its
 *  `useLiveData()` registers the whole effective PID set, and the injection DIDs are read on mount.
 *  See docs/features/live-data.md#all-sensors. */

/** Mode 01 PIDs grouped into human sections. PIDs the ECU doesn't support simply never appear.
 *  Section titles are `liveData:group.<id>` (plan 11). */
export const GROUPS: { id: string; pids: string[] }[] = [
  { id: 'engine', pids: ['010C', '010D', '0104', '0111', '010E', '011F'] },
  { id: 'temperatures', pids: ['0105', '010F', '0146', '015C'] },
  { id: 'air', pids: ['010B', '0110', '0133'] },
  {
    id: 'fuel',
    pids: ['010A', '0122', '0123', '015E', '0106', '0107', '0144', '012F'],
  },
  { id: 'electrical', pids: ['0142'] },
  { id: 'distance', pids: ['0121', '0131'] },
];
const GROUPED_PIDS = new Set(GROUPS.flatMap((g) => g.pids));

interface InjectionReading {
  did: string;
  name: string;
  unit: string;
  value: number | null;
}

export function SensorGroups() {
  const { t } = useTranslation('liveData');
  const status = useSessionStore((s) => s.status);
  const session = useSessionStore((s) => s.session);
  const profile = useActiveProfile();
  const { values, polling } = useLiveData();
  // The value cards go one per row by themselves above this scale (ValueCard); the injection tiles
  // below follow suit (plan 20).
  const largeText = useWindowDimensions().fontScale > LARGE_TEXT_FONT_SCALE;

  // Memoised so `readInjection` keeps its identity across renders: the mount effect below must
  // run once per session / profile, not after every live-data update (each run is five Mode 22
  // requests on a half-duplex adapter that EngineHost's poll loop also uses).
  const injectionPids = useMemo(
    () => (profile.extendedPids ?? []).filter((p) => p.category === 'injection'),
    [profile],
  );
  const canInjection = injectionPids.length > 0 && isCan(session?.currentProtocol ?? 'UNKNOWN');

  const [injection, setInjection] = useState<InjectionReading[]>([]);
  const [injLoading, setInjLoading] = useState(false);
  // Run id: every read (mount, session / profile change, Refresh) takes the next id, and the effect
  // cleanup bumps it too. A read whose id is no longer current stops sending and never touches
  // state, so an older profile's / session's values cannot overwrite a newer read's, and nothing is
  // set after unmount.
  const runRef = useRef(0);

  const readInjection = useCallback(async () => {
    const run = ++runRef.current;
    const current = () => runRef.current === run;
    if (!session || !canInjection) {
      setInjLoading(false);
      return;
    }
    setInjLoading(true);
    try {
      const out: InjectionReading[] = [];
      for (const p of injectionPids) {
        const raw = await session.readExtended(p.did);
        if (!current()) return;
        out.push({ did: p.did, name: p.name, unit: p.unit, value: raw ? p.decode(raw) : null });
      }
      setInjection(out);
    } catch (e) {
      if (current()) logError({ source: 'live-data/sensors', error: e, severity: 'warning' });
    } finally {
      if (current()) setInjLoading(false);
    }
  }, [session, canInjection, injectionPids]);

  // Invalidates any read in flight (a counter, not a DOM node, so bumping it in cleanup is intended).
  const cancelReads = useCallback(() => {
    runRef.current++;
  }, []);

  useEffect(() => {
    void readInjection();
    return cancelReads;
  }, [readInjection, cancelReads]);

  if (status !== 'connected') return null;

  // Mode 01 only: extended `22:<DID>` values share the live store (plan 14) but are experimental
  // manufacturer reads with their own screen — never list them among the standard sensors.
  const ungrouped = Object.entries(values)
    .filter(([key, v]) => !isExtendedKey(key) && !GROUPED_PIDS.has(v.pid))
    .map(([, v]) => v);

  return (
    <YStack gap="$3" testID="live-all-sensors">
      <Paragraph theme="alt2" fontSize="$2">
        {polling ? t('sensors.live') : t('sensors.idle')}
      </Paragraph>
      {GROUPS.map((g) => {
        const items = g.pids.map((pid) => values[pid]).filter((v) => v != null);
        if (items.length === 0) return null;
        return (
          <YStack key={g.id} gap="$2">
            <SectionTitle>{t(`group.${g.id}`)}</SectionTitle>
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
          <SectionTitle>{t('group.other')}</SectionTitle>
          <XStack flexWrap="wrap" gap="$2">
            {ungrouped.map((v) => (
              <ValueCard key={v.pid} name={v.name} value={v.value} unit={v.unit} />
            ))}
          </XStack>
        </YStack>
      ) : null}

      <YStack gap="$2">
        <XStack justifyContent="space-between" alignItems="center">
          <SectionTitle>{t('group.injection')}</SectionTitle>
          {canInjection ? (
            <Button
              size="$3"
              hitSlop={HIT_SLOP}
              onPress={readInjection}
              icon={injLoading ? () => <Spinner /> : undefined}
            >
              {t('sensors.refresh')}
            </Button>
          ) : null}
        </XStack>

        {canInjection ? (
          <XStack flexWrap="wrap" gap="$2">
            {injection.map((r) => (
              <Card
                key={r.did}
                bordered
                padding="$3"
                {...(largeText ? { width: '100%' as const } : { minWidth: 150 })}
              >
                <Paragraph theme="alt2" fontSize="$2">
                  {r.name}
                </Paragraph>
                <Text fontWeight="800" fontSize="$6" maxFontSizeMultiplier={1.3}>
                  {r.value != null ? formatFixed(r.value, 2) : '—'}{' '}
                  <Text fontSize="$2" theme="alt2">
                    {r.unit}
                  </Text>
                </Text>
              </Card>
            ))}
            {injection.length === 0 && !injLoading ? (
              <Paragraph theme="alt2">{t('reading')}</Paragraph>
            ) : null}
          </XStack>
        ) : (
          <Card bordered padding="$3" gap="$1">
            <H4>{t('sensors.noInjectorTitle')}</H4>
            <Paragraph theme="alt2" size="$2">
              {t('sensors.noInjectorBody')}
            </Paragraph>
          </Card>
        )}
      </YStack>
    </YStack>
  );
}
