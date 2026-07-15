import React, { useMemo, useState } from 'react';
import { YStack, XStack, Paragraph, H4, Button, Input } from 'tamagui';
import { useScanShare } from '../hooks/useScanShare';
import { searchScan } from '../api/scanSearch';
import { diffScans, type ModuleDiff } from '../api/scanDiff';
import { useScanHistoryStore, type SavedScan } from '../model/scanHistoryStore';

const fmtDate = (ts: number) => new Date(ts).toLocaleString();

/** Coloured pill for a diff/badge count. */
function Badge({ label, tone }: { label: string; tone: 'red' | 'green' | 'yellow' | 'alt2' }) {
  const color = tone === 'alt2' ? undefined : `$${tone}10`;
  return (
    <Paragraph size="$2" fontFamily="$mono" theme={tone === 'alt2' ? 'alt2' : undefined} color={color}>
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
      <Button size="$3" disabled={busy} onPress={() => shareReport(latest)}>
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
        {m.status === 'added' ? <Badge label="new module" tone="yellow" /> : null}
        {m.status === 'removed' ? <Badge label="gone" tone="alt2" /> : null}
        {m.faultsAppeared.length ? <Badge label={`+${m.faultsAppeared.length}`} tone="red" /> : null}
        {m.faultsCleared.length ? <Badge label={`−${m.faultsCleared.length}`} tone="green" /> : null}
      </XStack>
      {m.faultsAppeared.map((d) => (
        <Paragraph key={`a-${d.display}`} size="$2" color="$red10">
          appeared · {d.display} {d.vagCode ? `(VAG ${d.vagCode})` : ''} — {d.description}
        </Paragraph>
      ))}
      {m.faultsCleared.map((d) => (
        <Paragraph key={`c-${d.display}`} size="$2" color="$green10">
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

/** Pick two saved scans (default latest vs previous) and render the grouped diff. */
function CompareSection({ scans }: { scans: SavedScan[] }) {
  const [beforeId, setBeforeId] = useState<string>(scans[1]?.id ?? '');
  const [afterId, setAfterId] = useState<string>(scans[0]?.id ?? '');

  const before = scans.find((s) => s.id === beforeId) ?? scans[1];
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
            size="$2"
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

/** Saved-scan tools shown below the live scan: share the latest report, search its faults, and
 *  compare two scans. Reads the persisted scan history (auto-saved after each scan). */
export function ScanHistorySection() {
  const scans = useScanHistoryStore((s) => s.scans);
  if (!scans.length) return null;
  const latest = scans[0];

  return (
    <YStack gap="$3" backgroundColor="$color2" borderRadius="$4" padding="$3">
      <H4>Saved scans ({scans.length})</H4>
      <ShareRow latest={latest} />
      <SearchSection latest={latest} />
      {scans.length >= 2 ? <CompareSection scans={scans} /> : null}
    </YStack>
  );
}
