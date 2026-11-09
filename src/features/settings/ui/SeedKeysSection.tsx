import React, { useState } from 'react';
import { Alert } from 'react-native';
import { YStack, XStack, Text, Paragraph, Button, Card, Switch } from 'tamagui';
import type { SeedKeyPluginV1 } from '@/shared/obd-core';
import { useSeedKeyStore, type SeedKeyIndexEntry } from '@/shared/state/seedKeyStore';
import { useActiveProfile } from '@/shared/state/activeProfile';
import { vehicleLabel } from '@/shared/vehicles';
import {
  installSeedKeyPlugin,
  loadSeedKeyModules,
  pickSeedKeyFile,
  readSeedKeyProgram,
  removeSeedKeyPlugin,
} from '@/shared/security/seedKeyFiles';
import { testSeedKeyPluginInSimulator } from '@/shared/security/simulatorCheck';
import { useSeedKeyVehicleKeys } from '@/shared/security/useUnlockStatus';

const hex2 = (n: number) => `0x${n.toString(16).toUpperCase().padStart(2, '0')}`;

/** "Module 70E · level 0x03 · part numbers 1K0937…" — the plugin's scope in plain words. */
export function scopeText(applies: SeedKeyPluginV1['applies']): string {
  const parts = [
    applies.reqHeader ? `module ${applies.reqHeader}` : null,
    applies.address ? `address ${applies.address}` : null,
    applies.partNumberPrefix ? `part numbers ${applies.partNumberPrefix}…` : null,
  ].filter(Boolean);
  return `${parts.join(' · ')} · security level ${hex2(applies.level)}`;
}

interface Preview {
  plugin: SeedKeyPluginV1;
  opCount: number;
  steps: number;
  fileName: string;
}

interface Refusal {
  error: string;
  details: string[];
}

function PluginRow({
  entry,
  pinnedHere,
  onTest,
  onDelete,
  busy,
}: {
  entry: SeedKeyIndexEntry;
  pinnedHere: boolean;
  onTest: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  return (
    <Card bordered padding="$3" backgroundColor="$background">
      <YStack gap="$1">
        <Text fontWeight="700" fontSize="$3">
          {entry.name}
        </Text>
        <Paragraph theme="alt2" fontSize="$1">
          {scopeText(entry.applies)}
        </Paragraph>
        <Paragraph theme="alt2" fontSize="$1">
          {entry.seedBytes}-byte seed → {entry.keyBytes}-byte key ·{' '}
          {entry.vehicleKey ? (pinnedHere ? 'this car only' : 'another car only') : 'any car'} ·
          imported {new Date(entry.importedAt).toLocaleDateString()}
        </Paragraph>
        <XStack gap="$2" marginTop="$1">
          <Button
            size="$2"
            disabled={busy}
            onPress={onTest}
            accessibilityLabel={`Test in simulator: ${entry.name}`}
          >
            Test in simulator
          </Button>
          <Button
            size="$2"
            theme="red"
            onPress={onDelete}
            accessibilityLabel={`Delete ${entry.name}`}
          >
            Delete
          </Button>
        </XStack>
      </YStack>
    </Card>
  );
}

/** Settings → Data → **Security access plugins** (plan 23): import a `bolid.seedkey.v1` file you
 *  made for your own car (validated and compiled first; a file over the limits is refused with
 *  the reason), see what is installed, run one through the simulator, delete one. The app ships
 *  no seed→key routines and never fetches or derives one. */
export function SeedKeysSection() {
  const plugins = useSeedKeyStore((s) => s.plugins);
  const profile = useActiveProfile();
  const carKeys = useSeedKeyVehicleKeys();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [pin, setPin] = useState(false);

  const startImport = async () => {
    setNote(null);
    setRefusal(null);
    setPreview(null);
    setBusy(true);
    try {
      const mods = await loadSeedKeyModules();
      if (!mods) {
        setNote('File import is not available on this device.');
        return;
      }
      const picked = await pickSeedKeyFile(mods);
      if (picked.status === 'unavailable') {
        setNote('File import is not available in this build of the app.');
        return;
      }
      if (picked.status === 'cancelled') return;
      if (!picked.result.ok) {
        setRefusal({ error: picked.result.error, details: picked.result.details });
        return;
      }
      setPin(false);
      setPreview({
        plugin: picked.result.plugin,
        opCount: picked.result.opCount,
        steps: picked.result.steps,
        fileName: picked.name,
      });
    } finally {
      setBusy(false);
    }
  };

  const install = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const mods = await loadSeedKeyModules();
      const res = mods
        ? await installSeedKeyPlugin(mods, preview.plugin, pin ? { vehicleKey: carKeys[0] } : {})
        : { ok: false as const, error: 'File storage is not available on this device.' };
      setPreview(null);
      setNote(res.ok ? `Installed “${res.entry.name}”.` : res.error);
    } finally {
      setBusy(false);
    }
  };

  const test = async (entry: SeedKeyIndexEntry) => {
    setBusy(true);
    setNote(null);
    try {
      const mods = await loadSeedKeyModules();
      if (!mods) {
        setNote('Plugin files cannot be read on this device.');
        return;
      }
      const loaded = await readSeedKeyProgram(mods.FileSystem, entry);
      if (!loaded.ok) {
        setNote(loaded.problem);
        return;
      }
      setNote((await testSeedKeyPluginInSimulator(loaded.plugin)).message);
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = (entry: SeedKeyIndexEntry) =>
    Alert.alert(
      'Delete this plugin?',
      `${entry.name} is removed from this phone. Writes that needed it are refused again.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              await removeSeedKeyPlugin(await loadSeedKeyModules(), entry.id);
              setNote(`Deleted “${entry.name}”.`);
            })();
          },
        },
      ],
    );

  return (
    <YStack gap="$2" testID="seed-keys-section">
      <Text fontWeight="700" fontSize="$3">
        Security access plugins
      </Text>
      <Paragraph fontSize="$2">
        Some modules only accept a write after a security unlock: the module sends a number (the
        “seed”) and expects the matching answer (the “key”). The routine that turns one into the
        other belongs to the car maker. This app ships none and never downloads or works one out —
        you can install a routine you have for your own car as a small file.
      </Paragraph>
      <Paragraph theme="alt2" fontSize="$1">
        A plugin is a list of simple arithmetic steps, checked and run in a sandbox: it only sees
        the seed and only produces a key. Without a plugin, writes to a locked module are refused
        before anything is sent. Plugins stay on this phone and are not part of a backup.
      </Paragraph>
      <Button
        size="$3"
        disabled={busy}
        onPress={() => void startImport()}
        accessibilityLabel="Import a security access plugin from a file"
      >
        Import plugin
      </Button>
      {note ? (
        <Paragraph theme="alt2" fontSize="$1" testID="seed-key-note">
          {note}
        </Paragraph>
      ) : null}
      {refusal ? (
        <Card bordered padding="$3" backgroundColor="$background" testID="seed-key-refusal">
          <YStack gap="$1">
            <Text fontWeight="700">Can’t import this file</Text>
            <Paragraph fontSize="$2">{refusal.error}</Paragraph>
            {refusal.details.slice(0, 3).map((d) => (
              <Paragraph key={d} theme="alt2" fontSize="$1" fontFamily="monospace">
                {d}
              </Paragraph>
            ))}
            <Paragraph theme="alt2" fontSize="$1">
              Nothing was changed.
            </Paragraph>
            <Button size="$2" onPress={() => setRefusal(null)}>
              OK
            </Button>
          </YStack>
        </Card>
      ) : null}
      {preview ? (
        <Card bordered padding="$3" backgroundColor="$background" testID="seed-key-preview">
          <YStack gap="$1">
            <Text fontWeight="700">{preview.plugin.name}</Text>
            <Paragraph theme="alt2" fontSize="$1">
              {preview.fileName}
            </Paragraph>
            <Paragraph fontSize="$2">For {scopeText(preview.plugin.applies)}</Paragraph>
            <Paragraph fontSize="$2">
              {preview.plugin.seedBytes}-byte seed → {preview.plugin.keyBytes}-byte key ·{' '}
              {preview.opCount} steps written, {preview.steps} run
            </Paragraph>
            {preview.plugin.notes ? (
              <Paragraph theme="alt2" fontSize="$1">
                {preview.plugin.notes}
              </Paragraph>
            ) : null}
            <XStack alignItems="center" gap="$2">
              <Paragraph flex={1} fontSize="$2">
                Only for this car ({vehicleLabel(profile)})
              </Paragraph>
              <Switch
                size="$2"
                checked={pin}
                onCheckedChange={(v) => setPin(!!v)}
                accessibilityLabel="Only for this car"
              >
                <Switch.Thumb />
              </Switch>
            </XStack>
            <Paragraph theme="alt2" fontSize="$1">
              Install only a routine for your own car. A wrong key counts toward the module’s
              lockout.
            </Paragraph>
            <XStack gap="$2">
              <Button
                flex={1}
                size="$3"
                theme="green"
                disabled={busy}
                onPress={() => void install()}
              >
                Install
              </Button>
              <Button flex={1} size="$3" onPress={() => setPreview(null)}>
                Cancel
              </Button>
            </XStack>
          </YStack>
        </Card>
      ) : null}
      <Paragraph theme="alt2" fontSize="$2">
        Installed ({plugins.length})
      </Paragraph>
      {plugins.length === 0 ? (
        <Paragraph theme="alt2" fontSize="$1">
          No plugins installed. Writes to modules that need security access are refused.
        </Paragraph>
      ) : null}
      {plugins.map((p) => (
        <PluginRow
          key={p.id}
          entry={p}
          pinnedHere={!!p.vehicleKey && carKeys.includes(p.vehicleKey)}
          busy={busy}
          onTest={() => void test(p)}
          onDelete={() => confirmDelete(p)}
        />
      ))}
    </YStack>
  );
}
