import React, { useState } from 'react';
import { YStack, XStack, Paragraph, Button } from 'tamagui';
import { useAdaptationRestore } from '../hooks/useAdaptationRestore';
import { diffBackupModule, type CarBackupModule } from '../api/carBackup';
import {
  currentModuleFromReads,
  restoreHeadline,
  summarizeRestorePlan,
  type RestorePlanItem,
  type RestoreSkip,
} from '../api/adaptationRestore';
import { useActiveProfile } from '@/features/vehicle-select/api/activeProfile';
import { logError } from '@/shared/state/errorLogStore';
import { BACKUP_BUSY_MESSAGE } from '../model/backupWorkStore';
import { HIT_SLOP } from '@/shared/ui';
import { translate, useTranslation } from '@/shared/i18n';

/** The skip chip: `coding:restore.skip.<reason>` (plan 11). */
const skipLabel = (skip: RestoreSkip) => translate(`coding:restore.skip.${skip}`);

const fmt = (v: number | null, unit?: string) =>
  v === null ? '—' : `${v}${unit ? ' ' + unit : ''}`;

interface Compared {
  items: RestorePlanItem[];
  headline: string;
}

function PlanRow({
  item,
  canWrite,
  busy,
  onRestore,
}: {
  item: RestorePlanItem;
  canWrite: boolean;
  busy: boolean;
  onRestore: (item: RestorePlanItem) => Promise<void>;
}) {
  const { t } = useTranslation('coding');
  const [confirming, setConfirming] = useState(false);
  const chip = item.action === 'restore' ? t('restore.chip') : skipLabel(item.skip ?? 'equal');
  return (
    <YStack
      testID={`restore-row-${item.did}`}
      gap="$1"
      backgroundColor="$color2"
      borderRadius="$3"
      padding="$2"
      opacity={item.skip === 'equal' ? 0.5 : 1}
    >
      <XStack gap="$2" alignItems="center">
        <Paragraph flex={1} size="$2">
          {item.name} ({item.did})
        </Paragraph>
        <Paragraph
          size="$1"
          paddingHorizontal="$2"
          borderRadius="$2"
          backgroundColor={item.action === 'restore' ? '$blue5' : '$color4'}
        >
          {chip}
        </Paragraph>
      </XStack>
      <Paragraph size="$2" fontFamily="$mono">
        {fmt(item.snapshotValue, item.unit)} → {fmt(item.currentValue, item.unit)}
      </Paragraph>
      <Paragraph size="$1" theme="alt2">
        {t('restore.direction')}
      </Paragraph>
      {item.action === 'skip' && item.skip !== 'equal' && item.reason ? (
        <Paragraph size="$2" theme="alt2">
          {item.reason}
        </Paragraph>
      ) : null}
      {item.action === 'restore' ? (
        !confirming ? (
          <Button
            size="$3"
            hitSlop={HIT_SLOP}
            disabled={!canWrite || busy}
            // Fail closed even if a disabled button still delivers a press.
            onPress={() => canWrite && !busy && setConfirming(true)}
          >
            {t('restore.restore')}
          </Button>
        ) : (
          <YStack gap="$2" backgroundColor="$color3" padding="$2" borderRadius="$3">
            <Paragraph size="$2">
              {t('restore.confirmOne', {
                value: fmt(item.snapshotValue, item.unit),
                name: item.name,
                did: item.did,
              })}
            </Paragraph>
            <XStack gap="$2">
              <Button
                flex={1}
                size="$3"
                hitSlop={HIT_SLOP}
                theme="red"
                disabled={!canWrite || busy}
                onPress={async () => {
                  if (!canWrite || busy) return;
                  try {
                    await onRestore(item);
                  } finally {
                    setConfirming(false);
                  }
                }}
              >
                {busy ? t('tweak.writing') : t('backup.confirm')}
              </Button>
              <Button
                flex={1}
                size="$3"
                hitSlop={HIT_SLOP}
                disabled={busy}
                onPress={() => setConfirming(false)}
              >
                {t('common:actions.cancel')}
              </Button>
            </XStack>
          </YStack>
        )
      ) : null}
    </YStack>
  );
}

/** Adaptation restore for one snapshot module (plan 24): compare the backed-up channel values with
 *  a fresh read of the car, then restore one channel or all differing ones through the gated
 *  adaptation write. Out-of-bounds, locked and unknown channels are listed as skipped and cannot be
 *  forced. `blocked` (the snapshot belongs to another car — see `backupVehicleMismatch`) disables
 *  every write; comparing stays available. Needs a CAN session, like the Adaptations screen. */
export function AdaptationRestorePanel({
  m,
  blocked = null,
}: {
  m: CarBackupModule;
  blocked?: string | null;
}) {
  const { t } = useTranslation('coding');
  const profile = useActiveProfile();
  const { busy, unlocked, available, readCurrent, plan, restoreOne, restoreAll } =
    useAdaptationRestore();
  const [compared, setCompared] = useState<Compared | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  /** Report a rejection (e.g. the link dropped inside a read's `resetAddressing`) instead of
   *  letting it escape the press handler unseen. */
  const fail = (where: string, e: unknown) => {
    logError({ source: `coding/adaptation-restore/${where}`, error: e, severity: 'warning' });
    setMessage(t('failed', { error: e instanceof Error ? e.message : String(e) }));
  };

  /** Fresh read + plan. Returns false when nothing was read (busy elsewhere, link gone, threw). */
  const refresh = async (): Promise<boolean> => {
    try {
      const current = await readCurrent(m);
      if (!current) {
        setMessage(available ? t(BACKUP_BUSY_MESSAGE) : t('restore.notCan'));
        return false;
      }
      const items = plan(m, current);
      const channels = (profile.adaptations ?? []).filter((c) => c.reqHeader === m.reqHeader);
      const now = currentModuleFromReads(m, channels, current);
      setCompared({ items, headline: restoreHeadline(m, now, diffBackupModule(m, now), items) });
      return true;
    } catch (e) {
      // Drop the stale table: it no longer reflects the car.
      setCompared(null);
      fail('read', e);
      return false;
    }
  };

  const compare = async () => {
    setMessage(null);
    await refresh();
  };

  const one = async (item: RestorePlanItem) => {
    try {
      const res = await restoreOne(item);
      setMessage(res.message);
    } catch (e) {
      fail('write', e);
    }
    await refresh();
  };

  const all = async (items: RestorePlanItem[]) => {
    setMessage(null);
    try {
      const res = await restoreAll(items, (done, total) =>
        setProgress(t('restore.progress', { done, total })),
      );
      if (res.failed) {
        const failedAt = items.findIndex((i) => i.did === res.failed!.did);
        const remaining = items
          .slice(failedAt)
          .filter((i) => i.action === 'restore')
          .map((i) => `${i.name} (${i.did})`);
        setMessage(
          t('restore.stopped', {
            did: res.failed.did,
            message: res.failed.message,
            remaining: remaining.join(', '),
          }),
        );
      } else {
        setMessage(t('restore.restoredMany', { count: res.done }));
      }
    } catch (e) {
      fail('write', e);
    } finally {
      setProgress(null);
      setConfirmAll(false);
    }
    await refresh();
  };

  const toRestore = compared?.items.filter((i) => i.action === 'restore') ?? [];
  const summary = compared ? summarizeRestorePlan(compared.items) : null;
  const canWrite = unlocked && available && !blocked;

  return (
    <YStack gap="$2" testID={`adaptation-restore-${m.reqHeader}`}>
      <Button
        size="$3"
        hitSlop={HIT_SLOP}
        disabled={!available || busy}
        // Fail closed even if a disabled button still delivers a press.
        onPress={() => (available && !busy ? compare() : undefined)}
      >
        {busy && !progress
          ? t('restore.busy')
          : compared
            ? t('restore.compareAgain')
            : t('restore.compare')}
      </Button>
      {!available ? (
        <Paragraph theme="alt2" size="$2">
          {t('restore.connectCan')}
        </Paragraph>
      ) : null}
      {compared ? (
        <YStack gap="$2">
          <Paragraph size="$2">{compared.headline}</Paragraph>
          {compared.items.map((item) => (
            <PlanRow key={item.did} item={item} canWrite={canWrite} busy={busy} onRestore={one} />
          ))}
          {!unlocked ? (
            <Paragraph theme="alt2" size="$2">
              {t('restore.lockedHelp')}
            </Paragraph>
          ) : null}
          {summary && summary.restore > 0 ? (
            !confirmAll ? (
              <Button
                size="$3"
                hitSlop={HIT_SLOP}
                theme="red"
                disabled={!canWrite || busy}
                onPress={() => canWrite && !busy && setConfirmAll(true)}
              >
                {t('restore.all', { count: summary.restore })}
              </Button>
            ) : (
              <YStack gap="$2" backgroundColor="$color3" padding="$2" borderRadius="$3">
                <Paragraph size="$2">
                  {t('restore.confirmAll', { count: toRestore.length, name: m.name })}
                </Paragraph>
                {toRestore.map((i) => (
                  <Paragraph key={i.did} size="$2" fontFamily="$mono">
                    {t('restore.planLine', {
                      name: i.name,
                      did: i.did,
                      value: fmt(i.snapshotValue, i.unit),
                      now: fmt(i.currentValue, i.unit),
                    })}
                  </Paragraph>
                ))}
                {progress ? <Paragraph size="$2">{progress}</Paragraph> : null}
                <XStack gap="$2">
                  <Button
                    flex={1}
                    size="$3"
                    hitSlop={HIT_SLOP}
                    theme="red"
                    disabled={!canWrite || busy}
                    onPress={() => (canWrite && !busy ? all(compared.items) : undefined)}
                  >
                    {busy ? t('tweak.writing') : t('restore.confirmAllButton')}
                  </Button>
                  <Button
                    flex={1}
                    size="$3"
                    hitSlop={HIT_SLOP}
                    disabled={busy}
                    onPress={() => setConfirmAll(false)}
                  >
                    {t('common:actions.cancel')}
                  </Button>
                </XStack>
              </YStack>
            )
          ) : null}
        </YStack>
      ) : null}
      {message ? (
        <Paragraph size="$2" testID="adaptation-restore-message">
          {message}
        </Paragraph>
      ) : null}
    </YStack>
  );
}
