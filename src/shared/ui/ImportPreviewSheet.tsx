import React, { useState } from 'react';
import { Sheet, YStack, XStack, Text, Paragraph, Button } from 'tamagui';
import { PROTOCOL_LABELS } from '@/shared/obd-core/obd/protocols';
import { vinSuffix } from '@/shared/vehicles/userVehicle';
import { labelPackCounts, overlapText } from '@/shared/lib/exchange';
import {
  applyImport,
  type ImportChoice,
  type ImportOutcome,
  type ImportPreview,
} from '@/shared/state/exchangeService';
import type { PendingImport } from './useExchangeImport';
import { useTranslation } from '@/shared/i18n';

/** How many validator errors the sheet lists for a refused file. */
export const SHOWN_ERRORS = 3;

/** The preview of an imported profile or label-pack file (plan 13), opened by **Import profile**
 *  on the Vehicle screen and **Import label pack** in Settings → Data. A valid file shows what it
 *  holds and, when something with the same identity is already on the phone, **Replace** /
 *  **Keep both** / **Cancel**; a refused file shows the reason and the validator's first three
 *  errors, and nothing changes. */
export function ImportPreviewSheet({
  pending,
  onClose,
  onImported,
}: {
  pending: PendingImport | null;
  onClose: () => void;
  onImported?: (outcome: ImportOutcome) => void;
}) {
  return (
    <Sheet
      modal
      open={pending !== null}
      onOpenChange={(o: boolean) => {
        if (!o) onClose();
      }}
      snapPoints={[85]}
      dismissOnSnapToBottom
    >
      <Sheet.Overlay />
      <Sheet.Handle />
      <Sheet.Frame padding="$4">
        <Sheet.ScrollView>
          {pending ? (
            <ImportPreviewBody pending={pending} onClose={onClose} onImported={onImported} />
          ) : null}
        </Sheet.ScrollView>
      </Sheet.Frame>
    </Sheet>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <XStack gap="$2">
      <Paragraph theme="alt2" fontSize="$2" width={130}>
        {label}
      </Paragraph>
      <Paragraph fontSize="$2" flex={1}>
        {value}
      </Paragraph>
    </XStack>
  );
}

function Warning({ children }: { children: string }) {
  return (
    <Paragraph fontSize="$2" color="$statusWarn">
      {children}
    </Paragraph>
  );
}

export function ImportPreviewBody({
  pending,
  onClose,
  onImported,
}: {
  pending: PendingImport;
  onClose: () => void;
  onImported?: (outcome: ImportOutcome) => void;
}) {
  const { t } = useTranslation();
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);

  if ('error' in pending) {
    return (
      <YStack gap="$3">
        <Text fontWeight="800" fontSize="$6">
          {t('importPreview.cantImport')}
        </Text>
        <Paragraph>{pending.error}</Paragraph>
        {pending.details.slice(0, SHOWN_ERRORS).map((d) => (
          <Paragraph key={d} fontSize="$2" fontFamily="monospace" theme="alt2">
            {d}
          </Paragraph>
        ))}
        {pending.details.length > SHOWN_ERRORS ? (
          <Paragraph fontSize="$1" theme="alt2">
            {t('importPreview.andMore', { count: pending.details.length - SHOWN_ERRORS })}
          </Paragraph>
        ) : null}
        <Paragraph fontSize="$1" theme="alt2">
          {t('importPreview.nothingChanged')}
        </Paragraph>
        <Button onPress={onClose}>{t('actions.close')}</Button>
      </YStack>
    );
  }

  if (outcome) {
    return (
      <YStack gap="$3">
        <Text fontWeight="800" fontSize="$6">
          {outcome.ok ? t('importPreview.imported') : t('importPreview.cantImport')}
        </Text>
        <Paragraph>{outcome.message}</Paragraph>
        <Button theme={outcome.ok ? 'green' : undefined} onPress={onClose}>
          {t('actions.done')}
        </Button>
      </YStack>
    );
  }

  const apply = (choice: ImportChoice) => {
    const result = applyImport(pending, choice);
    setOutcome(result);
    if (result.ok) onImported?.(result);
  };
  const conflict =
    pending.kind === 'profile'
      ? pending.plan.action === 'conflict'
      : pending.plan.action === 'replace';
  const blocked = pending.kind === 'labelpack' && pending.plan.full;

  return (
    <YStack gap="$3">
      {pending.kind === 'profile' ? <ProfilePreview p={pending} /> : <PackPreview p={pending} />}
      {blocked ? <Warning>{t('importPreview.packsFull')}</Warning> : null}
      {conflict ? (
        <XStack gap="$2" flexWrap="wrap">
          <Button flex={1} theme="green" onPress={() => apply('replace')}>
            {t('actions.replace')}
          </Button>
          <Button
            flex={1}
            disabled={blocked}
            opacity={blocked ? 0.5 : 1}
            onPress={() => apply('keep-both')}
          >
            {t('actions.keepBoth')}
          </Button>
          <Button flex={1} onPress={onClose}>
            {t('actions.cancel')}
          </Button>
        </XStack>
      ) : (
        <XStack gap="$2">
          <Button
            flex={1}
            theme="green"
            disabled={blocked}
            opacity={blocked ? 0.5 : 1}
            onPress={() => apply('create')}
          >
            {t('actions.import')}
          </Button>
          <Button flex={1} onPress={onClose}>
            {t('actions.cancel')}
          </Button>
        </XStack>
      )}
    </YStack>
  );
}

function ProfilePreview({ p }: { p: Extract<ImportPreview, { kind: 'profile' }> }) {
  const { t } = useTranslation();
  const v = p.file.payload.vehicle;
  const suffix = vinSuffix(v.learned?.vin);
  return (
    <YStack gap="$2">
      <Text fontWeight="800" fontSize="$6">
        {t('importPreview.profileTitle')}
      </Text>
      <Row label={t('importPreview.name')} value={v.name} />
      {v.year !== undefined ? <Row label={t('importPreview.year')} value={String(v.year)} /> : null}
      <Row label={t('importPreview.fuel')} value={t(`fuel.${v.fuel}`, { defaultValue: v.fuel })} />
      <Row label={t('importPreview.basedOn')} value={p.baseName} />
      {suffix ? <Row label={t('importPreview.vinEnding')} value={suffix} /> : null}
      <Row
        label={t('importPreview.learned')}
        value={
          v.learned
            ? t('importPreview.learnedValue', {
                count: v.learned.supportedPids.length,
                protocol: PROTOCOL_LABELS[v.learned.protocol],
              })
            : t('importPreview.notLearned')
        }
      />
      {v.modules?.length ? (
        <Row
          label={t('importPreview.modules')}
          value={t('importPreview.modulesDiscovered', { count: v.modules.length })}
        />
      ) : null}
      {p.packs.add.length ? (
        <Paragraph fontSize="$2">
          {t('importPreview.includesPacks', {
            count: p.packs.add.length,
            modules: p.packs.add.map((x) => x.module).join(', '),
          })}
        </Paragraph>
      ) : null}
      {p.packs.kept.length ? (
        <Paragraph fontSize="$2" theme="alt2">
          {t('importPreview.packsKept', { modules: p.packs.kept.map((x) => x.module).join(', ') })}
        </Paragraph>
      ) : null}
      {p.packs.overCap.length ? (
        <Warning>
          {t('importPreview.packsOverCap', {
            modules: p.packs.overCap.map((x) => x.module).join(', '),
          })}
        </Warning>
      ) : null}
      {!p.baseKnown ? (
        <Warning>{t('importPreview.baseUnknown', { id: v.baseProfileId })}</Warning>
      ) : null}
      {p.plan.action === 'conflict' ? (
        <Warning>
          {p.plan.reason === 'same-vin'
            ? t('importPreview.conflictVin', { name: p.plan.existingName })
            : t('importPreview.conflictName', { name: p.plan.existingName })}
        </Warning>
      ) : null}
      <Paragraph fontSize="$1" theme="alt2">
        {t('importPreview.loginCodesNote')}
      </Paragraph>
    </YStack>
  );
}

function PackPreview({ p }: { p: Extract<ImportPreview, { kind: 'labelpack' }> }) {
  const { t } = useTranslation();
  const pack = p.file.payload;
  const c = labelPackCounts(pack);
  return (
    <YStack gap="$2">
      <Text fontWeight="800" fontSize="$6">
        {t('importPreview.packTitle')}
      </Text>
      <Row label={t('importPreview.module')} value={pack.module} />
      <Row label={t('importPreview.id')} value={pack.id} />
      <Row
        label={t('importPreview.partNumbers')}
        value={pack.partNumberPrefixes.map((x) => `${x}…`).join(', ')}
      />
      <Row label={t('importPreview.names')} value={t('importPreview.namesValue', { ...c })} />
      {pack.author ? <Row label={t('importPreview.author')} value={pack.author} /> : null}
      {pack.license ? <Row label={t('importPreview.licence')} value={pack.license} /> : null}
      {pack.source ? <Row label={t('importPreview.source')} value={pack.source} /> : null}
      <Row
        label={t('importPreview.checkedOnCar')}
        value={
          pack.confirmed
            ? t('importPreview.checkedYes', { on: pack.confirmed.on })
            : t('importPreview.checkedNo')
        }
      />
      {p.plan.overlaps.map((o) => (
        <Warning key={`${o.packId}:${o.prefix}:${o.otherPrefix}`}>{overlapText(o)}</Warning>
      ))}
      {p.plan.action === 'replace' ? (
        <Warning>{t('importPreview.packReplace', { id: pack.id })}</Warning>
      ) : null}
    </YStack>
  );
}
