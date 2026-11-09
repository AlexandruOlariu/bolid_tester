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

const FUEL_LABEL: Record<string, string> = {
  diesel: 'Diesel',
  petrol: 'Petrol',
  lpg: 'LPG',
  hybrid: 'Hybrid',
  other: 'Other',
};

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
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);

  if ('error' in pending) {
    return (
      <YStack gap="$3">
        <Text fontWeight="800" fontSize="$6">
          Can't import this file
        </Text>
        <Paragraph>{pending.error}</Paragraph>
        {pending.details.slice(0, SHOWN_ERRORS).map((d) => (
          <Paragraph key={d} fontSize="$2" fontFamily="monospace" theme="alt2">
            {d}
          </Paragraph>
        ))}
        {pending.details.length > SHOWN_ERRORS ? (
          <Paragraph fontSize="$1" theme="alt2">
            …and {pending.details.length - SHOWN_ERRORS} more.
          </Paragraph>
        ) : null}
        <Paragraph fontSize="$1" theme="alt2">
          Nothing was changed.
        </Paragraph>
        <Button onPress={onClose}>Close</Button>
      </YStack>
    );
  }

  if (outcome) {
    return (
      <YStack gap="$3">
        <Text fontWeight="800" fontSize="$6">
          {outcome.ok ? 'Imported' : "Can't import this file"}
        </Text>
        <Paragraph>{outcome.message}</Paragraph>
        <Button theme={outcome.ok ? 'green' : undefined} onPress={onClose}>
          Done
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
      {blocked ? (
        <Warning>
          You already have 100 imported label packs. Delete one in Settings → Data first.
        </Warning>
      ) : null}
      {conflict ? (
        <XStack gap="$2" flexWrap="wrap">
          <Button flex={1} theme="green" onPress={() => apply('replace')}>
            Replace
          </Button>
          <Button
            flex={1}
            disabled={blocked}
            opacity={blocked ? 0.5 : 1}
            onPress={() => apply('keep-both')}
          >
            Keep both
          </Button>
          <Button flex={1} onPress={onClose}>
            Cancel
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
            Import
          </Button>
          <Button flex={1} onPress={onClose}>
            Cancel
          </Button>
        </XStack>
      )}
    </YStack>
  );
}

function ProfilePreview({ p }: { p: Extract<ImportPreview, { kind: 'profile' }> }) {
  const v = p.file.payload.vehicle;
  const suffix = vinSuffix(v.learned?.vin);
  return (
    <YStack gap="$2">
      <Text fontWeight="800" fontSize="$6">
        Import car profile
      </Text>
      <Row label="Name" value={v.name} />
      {v.year !== undefined ? <Row label="Year" value={String(v.year)} /> : null}
      <Row label="Fuel" value={FUEL_LABEL[v.fuel] ?? v.fuel} />
      <Row label="Based on" value={p.baseName} />
      {suffix ? <Row label="VIN ending" value={suffix} /> : null}
      <Row
        label="Learned"
        value={
          v.learned
            ? `${v.learned.supportedPids.length} readings · ${PROTOCOL_LABELS[v.learned.protocol]}`
            : 'Not learned yet — connect to the car to learn it'
        }
      />
      {v.modules?.length ? <Row label="Modules" value={`${v.modules.length} discovered`} /> : null}
      {p.packs.add.length ? (
        <Paragraph fontSize="$2">
          Includes {p.packs.add.length} label pack{p.packs.add.length === 1 ? '' : 's'}:{' '}
          {p.packs.add.map((x) => x.module).join(', ')}.
        </Paragraph>
      ) : null}
      {p.packs.kept.length ? (
        <Paragraph fontSize="$2" theme="alt2">
          Already on this phone (kept as they are): {p.packs.kept.map((x) => x.module).join(', ')}.
        </Paragraph>
      ) : null}
      {p.packs.overCap.length ? (
        <Warning>{`Not imported — the phone already holds 100 label packs: ${p.packs.overCap.map((x) => x.module).join(', ')}.`}</Warning>
      ) : null}
      {!p.baseKnown ? (
        <Warning>{`The base profile "${v.baseProfileId}" is not in this version of the app; the car will use Auto / Generic.`}</Warning>
      ) : null}
      {p.plan.action === 'conflict' ? (
        <Warning>
          {p.plan.reason === 'same-vin'
            ? `${p.plan.existingName} in your garage has the same VIN. Replace it with this profile, or keep both?`
            : `Your garage already has a car named ${p.plan.existingName}. Replace it with this profile, or keep both?`}
        </Warning>
      ) : null}
      <Paragraph fontSize="$1" theme="alt2">
        Login codes are never part of a profile file; a replaced car keeps its own.
      </Paragraph>
    </YStack>
  );
}

function PackPreview({ p }: { p: Extract<ImportPreview, { kind: 'labelpack' }> }) {
  const pack = p.file.payload;
  const c = labelPackCounts(pack);
  return (
    <YStack gap="$2">
      <Text fontWeight="800" fontSize="$6">
        Import label pack
      </Text>
      <Row label="Module" value={pack.module} />
      <Row label="Id" value={pack.id} />
      <Row label="Part numbers" value={pack.partNumberPrefixes.map((x) => `${x}…`).join(', ')} />
      <Row
        label="Names"
        value={`${c.measurements} measurements · ${c.codingBits} coding bits · ${c.adaptations} adaptations · ${c.measuringGroups} measuring groups`}
      />
      {pack.author ? <Row label="Author" value={pack.author} /> : null}
      {pack.license ? <Row label="Licence" value={pack.license} /> : null}
      {pack.source ? <Row label="Source" value={pack.source} /> : null}
      <Row
        label="Checked on a car"
        value={pack.confirmed ? `Yes, ${pack.confirmed.on}` : 'No — names are unconfirmed'}
      />
      {p.plan.overlaps.map((o) => (
        <Warning key={`${o.packId}:${o.prefix}:${o.otherPrefix}`}>{overlapText(o)}</Warning>
      ))}
      {p.plan.action === 'replace' ? (
        <Warning>
          {`You already imported a pack with the id ${pack.id}. Replace it, or keep both (the copy gets a new id)?`}
        </Warning>
      ) : null}
    </YStack>
  );
}
