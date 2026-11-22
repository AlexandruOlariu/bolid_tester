import React, { useState } from 'react';
import { YStack, XStack, Text, Paragraph, Button, Card } from 'tamagui';
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
import { appAlert, HIT_SLOP, AccessibleSwitch } from '@/shared/ui';
import { translate, useTranslation } from '@/shared/i18n';
import { formatDate } from '@/shared/lib/format';

const hex2 = (n: number) => `0x${n.toString(16).toUpperCase().padStart(2, '0')}`;

/** "Module 70E · level 0x03 · part numbers 1K0937…" — the plugin's scope in plain words. */
export function scopeText(applies: SeedKeyPluginV1['applies']): string {
  const parts = [
    applies.reqHeader ? translate('settings:seed.scopeModule', { id: applies.reqHeader }) : null,
    applies.address ? translate('settings:seed.scopeAddress', { id: applies.address }) : null,
    applies.partNumberPrefix
      ? translate('settings:seed.scopeParts', { prefix: applies.partNumberPrefix })
      : null,
  ].filter(Boolean);
  return `${parts.join(' · ')} · ${translate('settings:seed.scopeLevel', { level: hex2(applies.level) })}`;
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
  const { t } = useTranslation('settings');
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
          {t('seed.bytes', { seed: entry.seedBytes, key: entry.keyBytes })} ·{' '}
          {entry.vehicleKey
            ? pinnedHere
              ? t('seed.thisCar')
              : t('seed.otherCar')
            : t('seed.anyCar')}{' '}
          · {t('seed.imported', { date: formatDate(entry.importedAt) })}
        </Paragraph>
        <XStack gap="$2" marginTop="$1">
          <Button
            size="$3"
            hitSlop={HIT_SLOP}
            disabled={busy}
            onPress={onTest}
            accessibilityLabel={t('seed.testA11y', { name: entry.name })}
          >
            {t('seed.test')}
          </Button>
          <Button
            size="$3"
            hitSlop={HIT_SLOP}
            theme="red"
            onPress={onDelete}
            accessibilityLabel={t('packs.deleteA11y', { module: entry.name })}
          >
            {t('packs.delete')}
          </Button>
        </XStack>
      </YStack>
    </Card>
  );
}

/** Settings → **Security access plugins** (plan 23, its own page): import a `bolid.seedkey.v1` file you
 *  made for your own car (validated and compiled first; a file over the limits is refused with
 *  the reason), see what is installed, run one through the simulator, delete one. The app ships
 *  no seed→key routines and never fetches or derives one. */
export function SeedKeysSection() {
  const { t } = useTranslation('settings');
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
        setNote(t('seed.noImportDevice'));
        return;
      }
      const picked = await pickSeedKeyFile(mods);
      if (picked.status === 'unavailable') {
        setNote(t('seed.noImportBuild'));
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
        : { ok: false as const, error: t('seed.noStorage') };
      setPreview(null);
      setNote(res.ok ? t('seed.installed', { name: res.entry.name }) : res.error);
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
        setNote(t('seed.cannotRead'));
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
    appAlert(t('seed.deleteTitle'), t('seed.deleteBody', { name: entry.name }), [
      { text: t('common:actions.cancel'), style: 'cancel' },
      {
        text: t('packs.delete'),
        style: 'destructive',
        onPress: () => {
          void (async () => {
            await removeSeedKeyPlugin(await loadSeedKeyModules(), entry.id);
            setNote(t('seed.deleted', { name: entry.name }));
          })();
        },
      },
    ]);

  return (
    <YStack gap="$2" testID="seed-keys-section">
      <Paragraph fontSize="$2">{t('seed.help')}</Paragraph>
      <Paragraph theme="alt2" fontSize="$1">
        {t('seed.help2')}
      </Paragraph>
      <Button
        size="$3"
        hitSlop={HIT_SLOP}
        disabled={busy}
        onPress={() => void startImport()}
        accessibilityLabel={t('seed.importA11y')}
      >
        {t('seed.import')}
      </Button>
      {note ? (
        <Paragraph theme="alt2" fontSize="$1" testID="seed-key-note">
          {note}
        </Paragraph>
      ) : null}
      {refusal ? (
        <Card bordered padding="$3" backgroundColor="$background" testID="seed-key-refusal">
          <YStack gap="$1">
            <Text fontWeight="700">{t('common:importPreview.cantImport')}</Text>
            <Paragraph fontSize="$2">{refusal.error}</Paragraph>
            {refusal.details.slice(0, 3).map((d) => (
              <Paragraph key={d} theme="alt2" fontSize="$1" fontFamily="monospace">
                {d}
              </Paragraph>
            ))}
            <Paragraph theme="alt2" fontSize="$1">
              {t('common:importPreview.nothingChanged')}
            </Paragraph>
            <Button size="$3" hitSlop={HIT_SLOP} onPress={() => setRefusal(null)}>
              {t('common:actions.ok')}
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
            <Paragraph fontSize="$2">
              {t('seed.for', { scope: scopeText(preview.plugin.applies) })}
            </Paragraph>
            <Paragraph fontSize="$2">
              {t('seed.bytes', { seed: preview.plugin.seedBytes, key: preview.plugin.keyBytes })} ·{' '}
              {t('seed.steps', { written: preview.opCount, run: preview.steps })}
            </Paragraph>
            {preview.plugin.notes ? (
              <Paragraph theme="alt2" fontSize="$1">
                {preview.plugin.notes}
              </Paragraph>
            ) : null}
            <XStack alignItems="center" gap="$2">
              <Paragraph flex={1} fontSize="$2">
                {t('seed.onlyThisCar', { car: vehicleLabel(profile) })}
              </Paragraph>
              <AccessibleSwitch
                checked={pin}
                onCheckedChange={setPin}
                accessibilityLabel={t('seed.onlyThisCarA11y')}
              />
            </XStack>
            <Paragraph theme="alt2" fontSize="$1">
              {t('seed.warning')}
            </Paragraph>
            <XStack gap="$2">
              <Button
                flex={1}
                size="$3"
                hitSlop={HIT_SLOP}
                theme="green"
                disabled={busy}
                onPress={() => void install()}
              >
                {t('seed.install')}
              </Button>
              <Button flex={1} size="$3" hitSlop={HIT_SLOP} onPress={() => setPreview(null)}>
                {t('common:actions.cancel')}
              </Button>
            </XStack>
          </YStack>
        </Card>
      ) : null}
      <Paragraph theme="alt2" fontSize="$2">
        {t('seed.installedCount', { count: plugins.length })}
      </Paragraph>
      {plugins.length === 0 ? (
        <Paragraph theme="alt2" fontSize="$1">
          {t('seed.none')}
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
