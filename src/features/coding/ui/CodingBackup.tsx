import React, { useState } from 'react';
import { YStack, XStack, Paragraph, H4, Button } from 'tamagui';
import { useCodingStore } from '../model/codingStore';
import { useCoding } from '../hooks/useCoding';
import { useCarBackup } from '../hooks/useCarBackup';
import { useCarBackupStore } from '../model/carBackupStore';
import {
  backupVehicleMismatch,
  summarizeCarBackup,
  type CarBackup,
  type CarBackupModule,
} from '../api/carBackup';
import { useBackupWorkStore } from '../model/backupWorkStore';
import { useSessionStore } from '@/shared/state/sessionStore';
import { useActiveProfile } from '@/features/vehicle-select/api/activeProfile';
import { AdaptationRestorePanel } from './AdaptationRestorePanel';

const fmtDate = (ts: number) => new Date(ts).toLocaleString();

/** Per-module block in an expanded snapshot: ident + coding + adaptation values, a gated
 *  "Restore coding" action for codeable modules, and the adaptation compare / restore panel.
 *  `blocked` (the snapshot is from another car) disables every restore. The coding restore takes
 *  the Backup section's shared work gate, so it never overlaps an adaptation compare / restore. */
function BackupModuleBlock({ m, blocked }: { m: CarBackupModule; blocked: string | null }) {
  const { modules, write } = useCoding();
  const unlocked = useCodingStore((s) => s.unlocked);
  const [confirming, setConfirming] = useState(false);
  const busy = useBackupWorkStore((s) => s.busy);

  // The live profile's codeable module for this snapshot module (restore target), matched by header.
  const codingMod = modules.find((x) => x.reqHeader === m.reqHeader);
  const canRestoreCoding = !!codingMod && !!m.coding;

  const restore = async () => {
    if (!codingMod || !m.coding || blocked) return;
    const gate = useBackupWorkStore.getState();
    if (!gate.tryBegin()) return;
    try {
      await write(codingMod, m.coding.bytes);
    } finally {
      gate.end();
      setConfirming(false);
    }
  };

  return (
    <YStack gap="$1" backgroundColor="$color1" borderRadius="$3" padding="$2">
      <XStack gap="$2" alignItems="center">
        {m.address ? (
          <Paragraph fontFamily="$mono" theme="alt2" size="$2">
            {m.address}
          </Paragraph>
        ) : null}
        <Paragraph flex={1}>{m.name}</Paragraph>
        <Paragraph theme="alt2" size="$2" fontFamily="$mono">
          {m.reqHeader}
        </Paragraph>
      </XStack>
      {m.partNumber ? (
        <Paragraph theme="alt2" size="$2">
          {m.partNumber}
          {m.softwareVersion ? ` · SW ${m.softwareVersion}` : ''}
        </Paragraph>
      ) : null}
      {m.coding ? (
        <Paragraph size="$2" fontFamily="$mono">
          Coding {m.coding.did}: {m.coding.hex}
        </Paragraph>
      ) : null}
      {m.adaptations.map((a) => (
        <Paragraph key={a.did} size="$2" theme="alt2">
          {a.name} ({a.did}): {a.value !== null ? `${a.value}${a.unit ?? ''}` : '—'}
        </Paragraph>
      ))}

      {canRestoreCoding ? (
        !confirming ? (
          <Button
            size="$2"
            disabled={!unlocked || busy || !!blocked}
            onPress={() => unlocked && !busy && !blocked && setConfirming(true)}
          >
            {unlocked ? 'Restore coding' : 'Unlock to restore coding'}
          </Button>
        ) : (
          <YStack gap="$2" backgroundColor="$color2" padding="$2" borderRadius="$3">
            <Paragraph size="$2">
              Restore {m.name} coding to {m.coding!.hex}? This is the same gated write — the current
              value is backed up and re-verified.
            </Paragraph>
            <XStack gap="$2">
              <Button flex={1} size="$3" theme="red" disabled={busy || !!blocked} onPress={restore}>
                {busy ? 'Writing…' : 'Confirm restore'}
              </Button>
              <Button flex={1} size="$3" disabled={busy} onPress={() => setConfirming(false)}>
                Cancel
              </Button>
            </XStack>
          </YStack>
        )
      ) : null}
      {m.adaptations.length ? <AdaptationRestorePanel m={m} blocked={blocked} /> : null}
    </YStack>
  );
}

function BackupRow({
  backup,
  onExport,
  onRemove,
}: {
  backup: CarBackup;
  onExport: (b: CarBackup) => Promise<string | null>;
  onRemove: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [exporting, setExporting] = useState(false);
  const s = summarizeCarBackup(backup);
  const profile = useActiveProfile();
  const liveVin = useSessionStore((st) => st.info?.vin ?? null);
  // A snapshot from another car (profile id or VIN) is shown and exportable, but never restored.
  const blocked = backupVehicleMismatch(backup.vehicle, { profileId: profile.id, vin: liveVin });

  return (
    <YStack gap="$2" backgroundColor="$color1" borderRadius="$3" padding="$2">
      <XStack gap="$2" alignItems="center" onPress={() => setExpanded((e) => !e)}>
        <YStack flex={1}>
          <Paragraph>{fmtDate(backup.ts)}</Paragraph>
          <Paragraph theme="alt2" size="$2">
            {s.modules} modules · {s.codedModules} coded · {s.adaptations} adaptations
            {backup.vehicle.vin ? ` · VIN …${backup.vehicle.vin.slice(-5)}` : ''}
          </Paragraph>
        </YStack>
        <Paragraph theme="alt2">{expanded ? '▾' : '▸'}</Paragraph>
      </XStack>

      {expanded ? (
        <YStack gap="$2">
          {blocked ? (
            <Paragraph size="$2" color="$red10" testID="backup-vehicle-mismatch">
              {blocked}
            </Paragraph>
          ) : null}
          {backup.modules.map((m) => (
            <BackupModuleBlock key={m.reqHeader} m={m} blocked={blocked} />
          ))}
          <XStack gap="$2">
            <Button
              flex={1}
              size="$2"
              disabled={exporting}
              onPress={async () => {
                setExporting(true);
                try {
                  await onExport(backup);
                } finally {
                  setExporting(false);
                }
              }}
            >
              {exporting ? 'Exporting…' : 'Export .json'}
            </Button>
            <Button flex={1} size="$2" theme="red" onPress={() => onRemove(backup.id)}>
              Delete
            </Button>
          </XStack>
        </YStack>
      ) : null}
    </YStack>
  );
}

/** Full coding backup ("clone my car") section: snapshot every declared module's coding +
 *  adaptation values, export as JSON, and restore coding and adaptation channels per module through
 *  the gated writes. */
export function CodingBackup() {
  const { available, creating, create, exportBackup } = useCarBackup();
  const workBusy = useBackupWorkStore((s) => s.busy);
  const backups = useCarBackupStore((s) => s.backups);
  const remove = useCarBackupStore((s) => s.remove);

  if (!available && !backups.length) return null;

  return (
    <YStack gap="$2" backgroundColor="$color2" borderRadius="$4" padding="$3">
      <H4>Full backup — clone my car</H4>
      <Paragraph theme="alt2" size="$2">
        One tap reads every declared module's long coding + adaptation values into a dated snapshot.
        Export it as JSON to keep in a drawer, and restore coding and adaptation values per module
        through the same gated writes. Experimental.
      </Paragraph>
      {available ? (
        <Button theme="green" disabled={creating || workBusy} onPress={() => create()}>
          {creating ? 'Reading modules…' : 'Create backup'}
        </Button>
      ) : (
        <Paragraph theme="alt2" size="$2">
          Connect over CAN to create a new backup. Saved backups below stay exportable.
        </Paragraph>
      )}
      {backups.map((b) => (
        <BackupRow key={b.id} backup={b} onExport={exportBackup} onRemove={remove} />
      ))}
    </YStack>
  );
}
