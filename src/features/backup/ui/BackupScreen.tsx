import React, { useMemo, useState } from 'react';
import { YStack, XStack, Card, Text, Paragraph, Button, Spinner } from 'tamagui';
import { SquareCheck, Square } from 'lucide-react-native';
import { Screen, appAlert } from '@/shared/ui';
import {
  LARGE_BACKUP_BYTES,
  formatBytes,
  type BackupBundle,
  type BackupValidation,
} from '@/shared/lib/backup';
import { PERSISTED_STORES, storeRef } from '../api/registry';
import type { RestoreResult } from '../api/backupService';
import { MAX_BACKUP_RECORDS, type BackupRecord } from '../model/backupStore';
import { useBackup } from '../hooks/useBackup';
import { isWebRuntime } from '@/shared/lib/webRuntime';

const ACCENT = '#2bb673';
const fmtDate = (ts: number) => (ts > 0 ? new Date(ts).toLocaleString() : 'unknown date');
const labelOf = (name: string) => storeRef(name)?.label ?? name;

function SectionLabel({ children }: { children: string }) {
  return (
    <Text
      fontWeight="800"
      fontSize="$2"
      color={ACCENT}
      letterSpacing={0.8}
      textTransform="uppercase"
    >
      {children}
    </Text>
  );
}

function CheckRow({
  label,
  hint,
  checked,
  disabled,
  onToggle,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  const Icon = checked ? SquareCheck : Square;
  return (
    <XStack
      alignItems="center"
      gap="$3"
      paddingVertical="$2"
      opacity={disabled ? 0.5 : 1}
      onPress={disabled ? undefined : onToggle}
      accessible
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked, disabled: !!disabled }}
    >
      <Icon size={20} color={disabled ? '#8B949E' : ACCENT} />
      <YStack flex={1}>
        <Text fontWeight="700">{label}</Text>
        {hint ? (
          <Paragraph theme="alt2" fontSize="$2">
            {hint}
          </Paragraph>
        ) : null}
      </YStack>
    </XStack>
  );
}

/** A file picked (or chosen from the list) and validated, waiting for the user's checklist. */
interface Pending {
  name: string;
  bundle: BackupBundle;
  warnings: string[];
}

function itemsText(name: string, state: unknown): string {
  const n = storeRef(name)?.count(state) ?? null;
  return n === null ? 'Saved' : `${n} item${n === 1 ? '' : 's'}`;
}

function RestoreCard({
  pending,
  busy,
  onRestore,
  onCancel,
}: {
  pending: Pending;
  busy: boolean;
  onRestore: (stores: string[], includeTrips: boolean) => void;
  onCancel: () => void;
}) {
  const { bundle } = pending;
  const inFile = useMemo(() => new Set(bundle.stores.map((s) => s.name)), [bundle]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () =>
      new Set(
        PERSISTED_STORES.filter((s) => s.restoreByDefault && inFile.has(s.name)).map((s) => s.name),
      ),
  );
  const tripFiles = bundle.tripFiles?.length ?? 0;
  const [includeTrips, setIncludeTrips] = useState(tripFiles > 0);
  const toggle = (name: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  const blobOf = (name: string) => bundle.stores.find((s) => s.name === name);

  return (
    <Card bordered padding="$3" gap="$2" borderLeftWidth={3} borderLeftColor={ACCENT}>
      <Text fontWeight="800">{pending.name || 'Backup file'}</Text>
      <Paragraph theme="alt2" fontSize="$2">
        Made {fmtDate(bundle.createdAt)} by app version {bundle.app.version ?? 'unknown'} (
        {bundle.app.platform}).
      </Paragraph>
      {pending.warnings.map((w) => (
        <Paragraph key={w} fontSize="$2" color="$orange10">
          {w}
        </Paragraph>
      ))}
      <Paragraph fontSize="$2">Choose what to restore. Everything else stays as it is.</Paragraph>
      {PERSISTED_STORES.map((s) => {
        const blob = blobOf(s.name);
        return (
          <CheckRow
            key={s.name}
            label={s.label}
            hint={blob ? itemsText(s.name, blob.state) : 'Not in this backup'}
            checked={!!blob && selected.has(s.name)}
            disabled={!blob}
            onToggle={() => toggle(s.name)}
          />
        );
      })}
      <CheckRow
        label="Trip recordings"
        hint={
          tripFiles > 0
            ? `${tripFiles} file${tripFiles === 1 ? '' : 's'}, ${formatBytes(bundle.sizes.tripBytes)}; only for trips in the trips list`
            : 'Not in this backup'
        }
        checked={includeTrips}
        disabled={tripFiles === 0}
        onToggle={() => setIncludeTrips((v) => !v)}
      />
      <XStack gap="$2">
        <Button
          flex={1}
          theme="green"
          disabled={busy || (selected.size === 0 && !includeTrips)}
          icon={busy ? <Spinner /> : undefined}
          accessibilityLabel="Restore the selected data"
          onPress={() =>
            onRestore(
              PERSISTED_STORES.map((s) => s.name).filter((n) => selected.has(n)),
              includeTrips,
            )
          }
        >
          Restore
        </Button>
        <Button flex={1} disabled={busy} onPress={onCancel}>
          Cancel
        </Button>
      </XStack>
    </Card>
  );
}

function ResultCard({ result, onDone }: { result: RestoreResult; onDone: () => void }) {
  if (!result.ok) {
    return (
      <Card bordered padding="$3" gap="$2" borderLeftWidth={3} borderLeftColor="#e5534b">
        <Text fontWeight="800">Nothing was restored</Text>
        <Paragraph fontSize="$2">{result.reason}</Paragraph>
        <Button size="$2" onPress={onDone}>
          OK
        </Button>
      </Card>
    );
  }
  return (
    <Card bordered padding="$3" gap="$2" borderLeftWidth={3} borderLeftColor={ACCENT}>
      <Text fontWeight="800">Restore finished</Text>
      {result.restored.length > 0 ? (
        <Paragraph fontSize="$2">Restored: {result.restored.map(labelOf).join(', ')}.</Paragraph>
      ) : (
        <Paragraph fontSize="$2">No data was restored.</Paragraph>
      )}
      {result.tripFilesWritten > 0 ? (
        <Paragraph fontSize="$2">Trip recordings restored: {result.tripFilesWritten}.</Paragraph>
      ) : null}
      {result.skipped.map((s) => (
        <Paragraph key={s.name} fontSize="$2" color="$orange10">
          Skipped {labelOf(s.name)}: {s.reason}
        </Paragraph>
      ))}
      <Paragraph theme="alt2" fontSize="$1">
        Your data from before the restore was saved as {result.snapshot.fileName}. Restore that file
        from the list below to undo.
      </Paragraph>
      <Button size="$2" onPress={onDone}>
        OK
      </Button>
    </Card>
  );
}

function RecordRow({
  record,
  busy,
  onShare,
  onRestore,
  onDelete,
}: {
  record: BackupRecord;
  busy: boolean;
  onShare: () => void;
  onRestore: () => void;
  onDelete: () => void;
}) {
  return (
    <YStack paddingVertical="$2" gap="$1" borderBottomWidth={1} borderColor="$borderColor">
      <Text fontWeight="700" fontSize="$3">
        {record.fileName}
      </Text>
      <Paragraph theme="alt2" fontSize="$1">
        {record.kind === 'pre-restore' ? 'Automatic, before a restore · ' : ''}
        {fmtDate(record.createdAt)} · {formatBytes(record.bytes)}
        {record.includesTrips ? ' · with trips' : ''}
      </Paragraph>
      <XStack gap="$2">
        <Button
          size="$2"
          disabled={busy}
          onPress={onShare}
          accessibilityLabel={`Share ${record.fileName}`}
        >
          Share
        </Button>
        <Button
          size="$2"
          disabled={busy}
          onPress={onRestore}
          accessibilityLabel={`Restore ${record.fileName}`}
        >
          Restore
        </Button>
        <Button
          size="$2"
          theme="red"
          disabled={busy}
          onPress={onDelete}
          accessibilityLabel={`Delete ${record.fileName}`}
        >
          Delete
        </Button>
      </XStack>
    </YStack>
  );
}

/** **Backup & restore** (plan 18): one file with every store and the trip recordings, written on
 *  the phone and shared wherever the user keeps it; restore from such a file after validating it,
 *  with the current data snapshotted first; per-store JSON / CSV export. See docs/features/backup.md. */
export function BackupScreen() {
  const {
    records,
    trips,
    storesBytes,
    busy,
    backUpNow,
    pick,
    open,
    restore,
    exportOne,
    share,
    remove,
  } = useBackup();
  const [includeTrips, setIncludeTrips] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [result, setResult] = useState<RestoreResult | null>(null);
  const [exported, setExported] = useState<string | null>(null);
  const tripsIncluded = includeTrips && trips.count > 0;
  // The whole bundle: the stores as serialized plus the trip CSVs (JSON escaping adds a little).
  const estimate = storesBytes + (tripsIncluded ? trips.bytes : 0);

  const onBackUp = async () => {
    setStatus(null);
    const created = await backUpNow(tripsIncluded);
    // Browser: useBackup showed the "not available on web yet" toast and wrote (or logged) nothing,
    // so the native "see the error log" follow-ups below would be wrong there (plan 28).
    if (!created && isWebRuntime()) return;
    setStatus(
      created
        ? `Saved ${created.record.fileName} (${formatBytes(created.record.bytes)}).${created.shared ? '' : ' Sharing is not available here; the file is in the list below.'}`
        : 'The backup could not be saved. See More → Error log for details.',
    );
  };

  const accept = (name: string, validation: BackupValidation) => {
    setResult(null);
    if (!validation.ok) {
      setPending(null);
      setPickError(validation.reason);
      return;
    }
    setPickError(null);
    setPending({ name, bundle: validation.bundle, warnings: validation.warnings });
  };

  const onPick = async () => {
    const res = await pick();
    if (res.status === 'unavailable' && isWebRuntime()) return; // the toast already said why
    if (res.status === 'unavailable') {
      setPickError(
        'Choosing a file needs a newer build of the app. You can still restore a backup from the list below.',
      );
    } else if (res.status === 'picked') accept(res.name, res.validation);
  };

  const onRestore = (bundleToRestore: BackupBundle, stores: string[], withTrips: boolean) => {
    const what = [
      ...stores.map(labelOf),
      ...(withTrips ? [`${bundleToRestore.tripFiles?.length ?? 0} trip recordings`] : []),
    ].join(', ');
    appAlert(
      'Restore from this backup?',
      `This replaces: ${what}. Your current data is snapshotted first, so you can undo.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          onPress: () =>
            appAlert(
              'Replace your data?',
              'The selected data on this phone is replaced by the backup. The adapter is disconnected first.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Restore',
                  style: 'destructive',
                  onPress: async () => {
                    const res = await restore(bundleToRestore, stores, withTrips);
                    setPending(null);
                    setResult(res);
                  },
                },
              ],
            ),
        },
      ],
    );
  };

  const onDelete = (record: BackupRecord) =>
    appAlert('Delete this backup?', `${record.fileName} is deleted from this phone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void remove(record) },
    ]);

  const onExport = async (name: string, format: 'json' | 'csv') => {
    const uri = await exportOne(name, format);
    if (!uri && isWebRuntime()) return; // the toast already said why
    setExported(
      uri
        ? `Saved ${uri.slice(uri.lastIndexOf('/') + 1)}.`
        : 'The export could not be saved. See More → Error log for details.',
    );
  };

  const tripHint =
    trips.count > 0
      ? `${trips.count} file${trips.count === 1 ? '' : 's'}, about ${formatBytes(trips.bytes)}`
      : 'No trip recordings yet';

  return (
    <Screen title="Backup & restore" subtitle="Everything in one file you keep">
      <YStack gap="$2">
        <SectionLabel>Back up</SectionLabel>
        <Card bordered padding="$3" gap="$2">
          <Paragraph fontSize="$2">
            One file with your garage, history, scans, trips, maintenance log, coding backups, alert
            rules and settings. It stays on this phone until you share it; keep a copy somewhere
            else. The file is plain text and holds your VINs, but never an AI API key.
          </Paragraph>
          <CheckRow
            label="Include trip recordings"
            hint={tripHint}
            checked={tripsIncluded}
            disabled={trips.count === 0}
            onToggle={() => setIncludeTrips((v) => !v)}
          />
          {estimate > 0 ? (
            <Paragraph theme="alt2" fontSize="$2">
              The backup file will be about {formatBytes(estimate)}.
            </Paragraph>
          ) : null}
          {estimate > LARGE_BACKUP_BYTES ? (
            <Paragraph fontSize="$2" color="$orange10">
              This backup is large (about {formatBytes(estimate)}). Sharing a file this big can fail
              {tripsIncluded ? '; leave the trip recordings out to make a small backup.' : '.'}
            </Paragraph>
          ) : null}
          <Button
            theme="green"
            disabled={busy !== null}
            icon={busy === 'backup' ? <Spinner /> : undefined}
            onPress={() => void onBackUp()}
          >
            Back up now
          </Button>
          {status ? <Paragraph fontSize="$2">{status}</Paragraph> : null}
        </Card>
      </YStack>

      <YStack gap="$2">
        <SectionLabel>Restore from file</SectionLabel>
        {result ? <ResultCard result={result} onDone={() => setResult(null)} /> : null}
        {pending ? (
          <RestoreCard
            key={`${pending.name}-${pending.bundle.createdAt}`}
            pending={pending}
            busy={busy === 'restore'}
            onRestore={(stores, withTrips) => onRestore(pending.bundle, stores, withTrips)}
            onCancel={() => setPending(null)}
          />
        ) : (
          <Card bordered padding="$3" gap="$2">
            <Paragraph fontSize="$2">
              Pick a backup file. You see what it holds and choose what to restore before anything
              changes.
            </Paragraph>
            <Button
              disabled={busy !== null}
              icon={busy === 'pick' ? <Spinner /> : undefined}
              onPress={() => void onPick()}
            >
              Choose a backup file…
            </Button>
            {pickError ? (
              <Paragraph fontSize="$2" color="$red10">
                {pickError}
              </Paragraph>
            ) : null}
          </Card>
        )}
      </YStack>

      <YStack gap="$2">
        <SectionLabel>Backups on this phone</SectionLabel>
        <Card bordered padding="$3">
          {records.length > 0 ? (
            <Paragraph theme="alt2" fontSize="$1">
              The newest {MAX_BACKUP_RECORDS} backups are kept (the automatic snapshots taken before
              a restore are counted apart); an older file is deleted when a new one is saved. Share
              the ones you want to keep elsewhere.
            </Paragraph>
          ) : null}
          {records.length === 0 ? (
            <Paragraph theme="alt2" fontSize="$2">
              No backups yet.
            </Paragraph>
          ) : (
            records.map((r) => (
              <RecordRow
                key={r.fileName}
                record={r}
                busy={busy !== null}
                onShare={() => void share(r)}
                onRestore={async () => accept(r.fileName, await open(r))}
                onDelete={() => onDelete(r)}
              />
            ))
          )}
        </Card>
      </YStack>

      <YStack gap="$2">
        <SectionLabel>Export one part</SectionLabel>
        <Card bordered padding="$3" gap="$1">
          <Paragraph theme="alt2" fontSize="$2">
            Share one kind of data on its own: JSON for any of them, CSV (opens in a spreadsheet)
            for history, module scans and the maintenance log.
          </Paragraph>
          {PERSISTED_STORES.map((s) => (
            <XStack key={s.name} alignItems="center" gap="$2" paddingVertical="$1">
              <Paragraph flex={1} fontSize="$3">
                {s.label}
              </Paragraph>
              <Button
                size="$2"
                disabled={busy !== null}
                onPress={() => void onExport(s.name, 'json')}
                accessibilityLabel={`Export ${s.label} as JSON`}
              >
                JSON
              </Button>
              {s.csv ? (
                <Button
                  size="$2"
                  disabled={busy !== null}
                  onPress={() => void onExport(s.name, 'csv')}
                  accessibilityLabel={`Export ${s.label} as CSV`}
                >
                  CSV
                </Button>
              ) : null}
            </XStack>
          ))}
          {exported ? <Paragraph fontSize="$2">{exported}</Paragraph> : null}
        </Card>
      </YStack>
    </Screen>
  );
}
