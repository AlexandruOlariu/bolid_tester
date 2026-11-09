import React, { useEffect, useMemo, useState } from 'react';
import { useLocalSearchParams, useNavigation } from 'expo-router';
import { YStack, XStack, Paragraph, H4, Button, Input } from 'tamagui';
import { useScanShare } from '../hooks/useScanShare';
import { searchScan } from '../api/scanSearch';
import { diffScans, type ModuleDiff } from '../api/scanDiff';
import { historyVehicleKey } from '@/shared/state/historyStore';
import { useScanHistoryStore, type SavedScan } from '../model/scanHistoryStore';
import { HIT_SLOP } from '@/shared/ui';

const fmtDate = (ts: number) => new Date(ts).toLocaleString();

/** Coloured pill for a diff/badge count. Semantic tokens only (plan 20): the scale's `$red10` /
 *  `$green10` / `$yellow10` miss 4.5:1 on the light background. */
function Badge({
  label,
  tone,
}: {
  label: string;
  tone: 'statusError' | 'statusOk' | 'statusWarn' | 'alt2';
}) {
  const color = tone === 'alt2' ? undefined : `$${tone}`;
  return (
    <Paragraph
      size="$2"
      fontFamily="$mono"
      theme={tone === 'alt2' ? 'alt2' : undefined}
      color={color}
    >
      {label}
    </Paragraph>
  );
}

/** Share the newest saved scan as the forum-pasteable VCDS-style text report. */
function ShareRow({ latest }: { latest: SavedScan }) {
  const { shareReport, busy } = useScanShare();
  return (
    <XStack gap="$2" alignItems="center">
      <YStack flex={1}>
        <Paragraph>Latest scan · {fmtDate(latest.ts)}</Paragraph>
        <Paragraph theme="alt2" size="$2">
          {latest.modules.length} modules · {latest.vehicle.label}
        </Paragraph>
      </YStack>
      <Button size="$3" hitSlop={HIT_SLOP} disabled={busy} onPress={() => shareReport(latest)}>
        {busy ? 'Sharing…' : 'Share report'}
      </Button>
    </XStack>
  );
}

/** Search the latest saved scan's faults across every module (VAG number / SAE code / text). */
function SearchSection({ latest }: { latest: SavedScan }) {
  const [query, setQuery] = useState('');
  const hits = useMemo(() => searchScan(latest.modules, query), [latest, query]);
  const trimmed = query.trim();
  return (
    <YStack gap="$2">
      <H4>Search faults</H4>
      <Input
        size="$3"
        placeholder="VAG number, P-code or text (e.g. 08579, P2183, coolant)"
        value={query}
        onChangeText={setQuery}
        autoCapitalize="none"
        accessibilityLabel="Search the scan's fault codes"
      />
      {trimmed && !hits.length ? (
        <Paragraph theme="alt2" size="$2">
          No fault in the last scan matches “{trimmed}”.
        </Paragraph>
      ) : null}
      {hits.map((h) => (
        <YStack key={h.address} backgroundColor="$color1" borderRadius="$3" padding="$2" gap="$1">
          <Paragraph size="$2" theme="alt2">
            {h.address} · {h.name}
          </Paragraph>
          {h.dtcs.map((d) => (
            <XStack key={d.display} gap="$2" alignItems="center">
              <Paragraph fontFamily="$mono" size="$2">
                {d.display}
              </Paragraph>
              {d.vagCode ? (
                <Paragraph theme="alt2" size="$2">
                  VAG {d.vagCode}
                </Paragraph>
              ) : null}
              <Paragraph size="$2" flex={1}>
                {d.description}
              </Paragraph>
            </XStack>
          ))}
        </YStack>
      ))}
    </YStack>
  );
}

/** One module's row in the before→after diff. */
function DiffRow({ m }: { m: ModuleDiff }) {
  if (m.status === 'unchanged') return null;
  return (
    <YStack backgroundColor="$color1" borderRadius="$3" padding="$2" gap="$1">
      <XStack gap="$2" alignItems="center">
        <Paragraph fontFamily="$mono" theme="alt2" size="$2">
          {m.address}
        </Paragraph>
        <Paragraph flex={1}>{m.name}</Paragraph>
        {m.status === 'added' ? <Badge label="new module" tone="statusWarn" /> : null}
        {m.status === 'removed' ? <Badge label="gone" tone="alt2" /> : null}
        {m.faultsAppeared.length ? (
          <Badge label={`+${m.faultsAppeared.length}`} tone="statusError" />
        ) : null}
        {m.faultsCleared.length ? (
          <Badge label={`−${m.faultsCleared.length}`} tone="statusOk" />
        ) : null}
      </XStack>
      {m.faultsAppeared.map((d) => (
        <Paragraph key={`a-${d.display}`} size="$2" color="$statusError">
          appeared · {d.display} {d.vagCode ? `(VAG ${d.vagCode})` : ''} — {d.description}
        </Paragraph>
      ))}
      {m.faultsCleared.map((d) => (
        <Paragraph key={`c-${d.display}`} size="$2" color="$statusOk">
          cleared · {d.display} {d.vagCode ? `(VAG ${d.vagCode})` : ''} — {d.description}
        </Paragraph>
      ))}
      {m.codingChanged ? (
        <Paragraph size="$2" theme="alt2">
          coding {m.codingChanged.before ?? '—'} → {m.codingChanged.after ?? '—'}
        </Paragraph>
      ) : null}
      {m.partNumberChanged ? (
        <Paragraph size="$2" theme="alt2">
          part no {m.partNumberChanged.before ?? '—'} → {m.partNumberChanged.after ?? '—'}
        </Paragraph>
      ) : null}
    </YStack>
  );
}

/** The id of the scan saved just before `afterId` **for the same car** (`scans` is newest first),
 *  or '' when that is the car's first scan. */
export function baselineFor(scans: SavedScan[], afterId: string): string {
  const i = scans.findIndex((s) => s.id === afterId);
  if (i < 0) return '';
  const key = historyVehicleKey(scans[i].vehicle);
  return scans.slice(i + 1).find((o) => historyVehicleKey(o.vehicle) === key)?.id ?? '';
}

/** The Before id a deep link asks for: its own `before`, else the same car's previous scan (none
 *  for a car's first scan — never another car's scan or the After scan itself). */
function linkedBefore(scans: SavedScan[], beforeId?: string, afterId?: string): string | undefined {
  if (beforeId) return beforeId;
  if (afterId) return baselineFor(scans, afterId);
  return undefined;
}

/** Pick two saved scans (default latest vs previous, or the ids a deep link hands in) and render
 *  the grouped diff. A later deep link with new ids re-seeds both pickers; a link with only `after`
 *  (a car's first scan, from the History timeline) seeds Before with that car's previous scan, or
 *  leaves it empty when there is none. */
export function CompareSection({
  scans,
  initialBeforeId,
  initialAfterId,
}: {
  scans: SavedScan[];
  initialBeforeId?: string;
  initialAfterId?: string;
}) {
  const [beforeId, setBeforeId] = useState<string>(
    () => linkedBefore(scans, initialBeforeId, initialAfterId) ?? scans[1]?.id ?? '',
  );
  const [afterId, setAfterId] = useState<string>(initialAfterId ?? scans[0]?.id ?? '');
  useEffect(() => {
    if (initialAfterId) setAfterId(initialAfterId);
    const linked = linkedBefore(scans, initialBeforeId, initialAfterId);
    if (linked !== undefined) setBeforeId(linked);
    // Re-seed only when a new link arrives, not when the scan list changes underneath.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialBeforeId, initialAfterId]);

  // An empty Before (a car's first scan) stays empty until the user picks one; a stale id (the
  // scan was dropped by the cap) falls back to the previous scan.
  const before = beforeId ? (scans.find((s) => s.id === beforeId) ?? scans[1]) : undefined;
  const after = scans.find((s) => s.id === afterId) ?? scans[0];
  const diff = useMemo(() => (before && after ? diffScans(before, after) : null), [before, after]);
  const changed = diff ? diff.modules.filter((m) => m.status !== 'unchanged') : [];

  const Picker = ({
    title,
    selectedId,
    onSelect,
  }: {
    title: string;
    selectedId: string;
    onSelect: (id: string) => void;
  }) => (
    <YStack gap="$1">
      <Paragraph size="$2" theme="alt2">
        {title}
      </Paragraph>
      <XStack gap="$2" flexWrap="wrap">
        {scans.map((s) => (
          <Button
            key={s.id}
            size="$3"
            hitSlop={HIT_SLOP}
            theme={s.id === selectedId ? 'green' : undefined}
            onPress={() => onSelect(s.id)}
          >
            {fmtDate(s.ts)}
          </Button>
        ))}
      </XStack>
    </YStack>
  );

  return (
    <YStack gap="$2">
      <H4>Compare scans</H4>
      <Picker title="Before (baseline)" selectedId={before?.id ?? ''} onSelect={setBeforeId} />
      <Picker title="After" selectedId={after?.id ?? ''} onSelect={setAfterId} />
      {after && !before ? (
        <Paragraph theme="alt2" size="$2">
          No earlier scan of this car — pick a baseline above.
        </Paragraph>
      ) : null}
      {diff && before && after ? (
        before.id === after.id ? (
          <Paragraph theme="alt2" size="$2">
            Pick two different scans to compare.
          </Paragraph>
        ) : (
          <YStack gap="$2">
            <Paragraph size="$2" theme="alt2">
              {diff.totals.appeared} appeared · {diff.totals.cleared} cleared ·{' '}
              {diff.totals.modulesChanged} changed · {diff.totals.modulesAdded} added ·{' '}
              {diff.totals.modulesRemoved} removed
            </Paragraph>
            {changed.length ? (
              changed.map((m) => <DiffRow key={`${m.status}-${m.address}`} m={m} />)
            ) : (
              <Paragraph theme="alt2" size="$2">
                No differences between these two scans.
              </Paragraph>
            )}
          </YStack>
        )
      ) : null}
    </YStack>
  );
}

/** The first value of a route param (expo-router hands repeated params as an array). */
function firstParam(v: string | string[] | undefined): string | undefined {
  const one = Array.isArray(v) ? v[0] : v;
  return one || undefined;
}

/** Saved-scan tools shown below the live scan: share the latest report, search its faults, and
 *  compare two scans. Reads the persisted scan history (auto-saved after each scan). The History
 *  timeline (plan 16) deep-links here as `/module-scan?after=<id>&before=<id>`: the ids seed the
 *  Compare pickers, then the params are cleared on this route so the same link works again after
 *  the pickers were changed by hand. */
export function ScanHistorySection() {
  const scans = useScanHistoryStore((s) => s.scans);
  const params = useLocalSearchParams<{ before?: string | string[]; after?: string | string[] }>();
  const navigation = useNavigation<{
    setParams(params: { before?: string; after?: string }): void;
  }>();
  const before = firstParam(params.before);
  const after = firstParam(params.after);
  // Children's effects run first, so CompareSection has taken the ids before they are cleared.
  useEffect(() => {
    if (before || after) navigation.setParams({ before: undefined, after: undefined });
  }, [before, after, navigation]);

  if (!scans.length) return null;
  const latest = scans[0];

  return (
    <YStack gap="$3" backgroundColor="$color2" borderRadius="$4" padding="$3">
      <H4>Saved scans ({scans.length})</H4>
      <ShareRow latest={latest} />
      <SearchSection latest={latest} />
      {scans.length >= 2 ? (
        <CompareSection scans={scans} initialBeforeId={before} initialAfterId={after} />
      ) : null}
    </YStack>
  );
}
