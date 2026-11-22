import React, { useMemo, useState } from 'react';
import { YStack, XStack, Card, Text, Paragraph, Button, Spinner } from 'tamagui';
import { SquareCheck, Square } from 'lucide-react-native';
import { Screen, appAlert, usePalette, HIT_SLOP } from '@/shared/ui';
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
import { translate, useTranslation } from '@/shared/i18n';
import { formatDateTime } from '@/shared/lib/format';

const fmtDate = (ts: number) => (ts > 0 ? formatDateTime(ts) : translate('backup:unknownDate'));
/** A store's name in the UI language (`backup:store.<name without "bolid.">`, plan 11). */
const labelOf = (name: string) =>
  translate(`backup:store.${name.replace(/^bolid\./, '')}`, {
    defaultValue: storeRef(name)?.label ?? name,
  });

function SectionLabel({ children }: { children: string }) {
  return (
    <Text
      fontWeight="800"
      fontSize="$2"
      color="$accent"
      letterSpacing={0.8}
      textTransform="uppercase"
      role="heading"
      accessibilityRole="header"
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
  const palette = usePalette();
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
      <Icon size={20} color={disabled ? palette.muted : palette.accent} />
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
  return n === null ? translate('backup:saved') : translate('backup:items', { count: n });
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
  const { t } = useTranslation('backup');
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
    <Card bordered padding="$3" gap="$2" borderLeftWidth={3} borderLeftColor="$accent">
      <Text fontWeight="800">{pending.name || t('restore.file')}</Text>
      <Paragraph theme="alt2" fontSize="$2">
        {t('restore.made', {
          date: fmtDate(bundle.createdAt),
          version: bundle.app.version ?? t('unknown'),
          platform: bundle.app.platform,
        })}
      </Paragraph>
      {pending.warnings.map((w) => (
        <Paragraph key={w} fontSize="$2" color="$statusWarn">
          {w}
        </Paragraph>
      ))}
      <Paragraph fontSize="$2">{t('restore.choose')}</Paragraph>
      {PERSISTED_STORES.map((s) => {
        const blob = blobOf(s.name);
        return (
          <CheckRow
            key={s.name}
            label={labelOf(s.name)}
            hint={blob ? itemsText(s.name, blob.state) : t('restore.notInBackup')}
            checked={!!blob && selected.has(s.name)}
            disabled={!blob}
            onToggle={() => toggle(s.name)}
          />
        );
      })}
      <CheckRow
        label={t('restore.trips')}
        hint={
          tripFiles > 0
            ? t('restore.tripFiles', {
                count: tripFiles,
                size: formatBytes(bundle.sizes.tripBytes),
              })
            : t('restore.notInBackup')
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
          accessibilityLabel={t('restore.restoreA11y')}
          onPress={() =>
            onRestore(
              PERSISTED_STORES.map((s) => s.name).filter((n) => selected.has(n)),
              includeTrips,
            )
          }
        >
          {t('restore.restore')}
        </Button>
        <Button flex={1} disabled={busy} onPress={onCancel}>
          {t('common:actions.cancel')}
        </Button>
      </XStack>
    </Card>
  );
}

function ResultCard({ result, onDone }: { result: RestoreResult; onDone: () => void }) {
  const { t } = useTranslation('backup');
  if (!result.ok) {
    return (
      <Card bordered padding="$3" gap="$2" borderLeftWidth={3} borderLeftColor="$statusError">
        <Text fontWeight="800">{t('result.nothing')}</Text>
        <Paragraph fontSize="$2">{result.reason}</Paragraph>
        <Button size="$3" hitSlop={HIT_SLOP} onPress={onDone}>
          {t('common:actions.ok')}
        </Button>
      </Card>
    );
  }
  return (
    <Card bordered padding="$3" gap="$2" borderLeftWidth={3} borderLeftColor="$accent">
      <Text fontWeight="800">{t('result.finished')}</Text>
      {result.restored.length > 0 ? (
        <Paragraph fontSize="$2">
          {t('result.restored', { list: result.restored.map(labelOf).join(', ') })}
        </Paragraph>
      ) : (
        <Paragraph fontSize="$2">{t('result.noData')}</Paragraph>
      )}
      {result.tripFilesWritten > 0 ? (
        <Paragraph fontSize="$2">{t('result.trips', { count: result.tripFilesWritten })}</Paragraph>
      ) : null}
      {result.skipped.map((s) => (
        <Paragraph key={s.name} fontSize="$2" color="$statusWarn">
          {t('result.skipped', { name: labelOf(s.name), reason: s.reason })}
        </Paragraph>
      ))}
      <Paragraph theme="alt2" fontSize="$1">
        {t('result.undo', { file: result.snapshot.fileName })}
      </Paragraph>
      <Button size="$3" hitSlop={HIT_SLOP} onPress={onDone}>
        {t('common:actions.ok')}
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
  const { t } = useTranslation('backup');
  return (
    <YStack paddingVertical="$2" gap="$1" borderBottomWidth={1} borderColor="$borderColor">
      <Text fontWeight="700" fontSize="$3">
        {record.fileName}
      </Text>
      <Paragraph theme="alt2" fontSize="$1">
        {record.kind === 'pre-restore' ? `${t('record.automatic')} · ` : ''}
        {fmtDate(record.createdAt)} · {formatBytes(record.bytes)}
        {record.includesTrips ? ` · ${t('record.withTrips')}` : ''}
      </Paragraph>
      <XStack gap="$2">
        <Button
          size="$3"
          hitSlop={HIT_SLOP}
          disabled={busy}
          onPress={onShare}
          accessibilityLabel={t('record.shareA11y', { file: record.fileName })}
        >
          {t('record.share')}
        </Button>
        <Button
          size="$3"
          hitSlop={HIT_SLOP}
          disabled={busy}
          onPress={onRestore}
          accessibilityLabel={t('record.restoreA11y', { file: record.fileName })}
        >
          {t('restore.restore')}
        </Button>
        <Button
          size="$3"
          hitSlop={HIT_SLOP}
          theme="red"
          disabled={busy}
          onPress={onDelete}
          accessibilityLabel={t('record.deleteA11y', { file: record.fileName })}
        >
          {t('record.delete')}
        </Button>
      </XStack>
    </YStack>
  );
}

/** **Backup & restore** (plan 18): one file with every store and the trip recordings, written on
 *  the phone and shared wherever the user keeps it; restore from such a file after validating it,
 *  with the current data snapshotted first; per-store JSON / CSV export. See docs/features/backup.md. */
export function BackupScreen() {
  const { t } = useTranslation('backup');
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
        ? `${t('status.saved', {
            file: created.record.fileName,
            size: formatBytes(created.record.bytes),
          })}${created.shared ? '' : ` ${t('status.notShared')}`}`
        : t('status.failed'),
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
      setPickError(t('pick.unavailable'));
    } else if (res.status === 'picked') accept(res.name, res.validation);
  };

  const onRestore = (bundleToRestore: BackupBundle, stores: string[], withTrips: boolean) => {
    const what = [
      ...stores.map(labelOf),
      ...(withTrips ? [t('confirm.trips', { count: bundleToRestore.tripFiles?.length ?? 0 })] : []),
    ].join(', ');
    appAlert(t('confirm.title'), t('confirm.body', { what }), [
      { text: t('common:actions.cancel'), style: 'cancel' },
      {
        text: t('confirm.continue'),
        onPress: () =>
          appAlert(t('confirm.title2'), t('confirm.body2'), [
            { text: t('common:actions.cancel'), style: 'cancel' },
            {
              text: t('restore.restore'),
              style: 'destructive',
              onPress: async () => {
                const res = await restore(bundleToRestore, stores, withTrips);
                setPending(null);
                setResult(res);
              },
            },
          ]),
      },
    ]);
  };

  const onDelete = (record: BackupRecord) =>
    appAlert(t('deleteTitle'), t('deleteBody', { file: record.fileName }), [
      { text: t('common:actions.cancel'), style: 'cancel' },
      { text: t('record.delete'), style: 'destructive', onPress: () => void remove(record) },
    ]);

  const onExport = async (name: string, format: 'json' | 'csv') => {
    const uri = await exportOne(name, format);
    if (!uri && isWebRuntime()) return; // the toast already said why
    setExported(
      uri ? t('export.saved', { file: uri.slice(uri.lastIndexOf('/') + 1) }) : t('export.failed'),
    );
  };

  const tripHint =
    trips.count > 0
      ? t('backUp.tripHint', { count: trips.count, size: formatBytes(trips.bytes) })
      : t('backUp.noTrips');

  return (
    <Screen title={t('title')} subtitle={t('subtitle')}>
      <YStack gap="$2">
        <SectionLabel>{t('backUp.title')}</SectionLabel>
        <Card bordered padding="$3" gap="$2">
          <Paragraph fontSize="$2">{t('backUp.help')}</Paragraph>
          <CheckRow
            label={t('backUp.includeTrips')}
            hint={tripHint}
            checked={tripsIncluded}
            disabled={trips.count === 0}
            onToggle={() => setIncludeTrips((v) => !v)}
          />
          {estimate > 0 ? (
            <Paragraph theme="alt2" fontSize="$2">
              {t('backUp.estimate', { size: formatBytes(estimate) })}
            </Paragraph>
          ) : null}
          {estimate > LARGE_BACKUP_BYTES ? (
            <Paragraph fontSize="$2" color="$statusWarn">
              {tripsIncluded
                ? t('backUp.largeTrips', { size: formatBytes(estimate) })
                : t('backUp.large', { size: formatBytes(estimate) })}
            </Paragraph>
          ) : null}
          <Button
            theme="green"
            disabled={busy !== null}
            icon={busy === 'backup' ? <Spinner /> : undefined}
            onPress={() => void onBackUp()}
          >
            {t('backUp.now')}
          </Button>
          {status ? <Paragraph fontSize="$2">{status}</Paragraph> : null}
        </Card>
      </YStack>

      <YStack gap="$2">
        <SectionLabel>{t('pick.title')}</SectionLabel>
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
            <Paragraph fontSize="$2">{t('pick.help')}</Paragraph>
            <Button
              disabled={busy !== null}
              icon={busy === 'pick' ? <Spinner /> : undefined}
              onPress={() => void onPick()}
            >
              {t('pick.choose')}
            </Button>
            {pickError ? (
              <Paragraph fontSize="$2" color="$statusError">
                {pickError}
              </Paragraph>
            ) : null}
          </Card>
        )}
      </YStack>

      <YStack gap="$2">
        <SectionLabel>{t('list.title')}</SectionLabel>
        <Card bordered padding="$3">
          {records.length > 0 ? (
            <Paragraph theme="alt2" fontSize="$1">
              {t('list.help', { max: MAX_BACKUP_RECORDS })}
            </Paragraph>
          ) : null}
          {records.length === 0 ? (
            <Paragraph theme="alt2" fontSize="$2">
              {t('list.empty')}
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
        <SectionLabel>{t('export.title')}</SectionLabel>
        <Card bordered padding="$3" gap="$1">
          <Paragraph theme="alt2" fontSize="$2">
            {t('export.help')}
          </Paragraph>
          {PERSISTED_STORES.map((s) => (
            <XStack key={s.name} alignItems="center" gap="$2" paddingVertical="$1">
              <Paragraph flex={1} fontSize="$3">
                {labelOf(s.name)}
              </Paragraph>
              <Button
                size="$3"
                hitSlop={HIT_SLOP}
                disabled={busy !== null}
                onPress={() => void onExport(s.name, 'json')}
                accessibilityLabel={t('export.jsonA11y', { name: labelOf(s.name) })}
              >
                JSON
              </Button>
              {s.csv ? (
                <Button
                  size="$3"
                  hitSlop={HIT_SLOP}
                  disabled={busy !== null}
                  onPress={() => void onExport(s.name, 'csv')}
                  accessibilityLabel={t('export.csvA11y', { name: labelOf(s.name) })}
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
