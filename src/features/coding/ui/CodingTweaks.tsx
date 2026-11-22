import React, { useState } from 'react';
import { YStack, XStack, Paragraph, H4, Button } from 'tamagui';
import type { CodingPreset, CodingPresetState } from '@/shared/obd-core';
import { UnlockBadge, VerificationBadge, HIT_SLOP } from '@/shared/ui';
import { useUnlockStatus } from '@/shared/security';
import { useCodingStore } from '../model/codingStore';
import { useCoding } from '../hooks/useCoding';
import { useTranslation } from '@/shared/i18n';

/** Badge marks; the words are `coding:tweak.state.<state>` (plan 11). */
const stateBadge: Record<CodingPresetState, { mark: string; theme?: 'green' }> = {
  on: { mark: '●', theme: 'green' },
  off: { mark: '○' },
  unknown: { mark: '?' },
};

/** One curated tweak: current on/off/unknown state + one-tap enable/revert behind the coding gate. */
function TweakRow({ preset }: { preset: CodingPreset }) {
  const { t } = useTranslation('coding');
  const { moduleForPreset, presetState, applyTweak, read, partNumberFor } = useCoding();
  const unlocked = useCodingStore((s) => s.unlocked);
  const [pending, setPending] = useState<null | boolean>(null);
  const [busy, setBusy] = useState(false);

  const mod = moduleForPreset(preset);
  const state = presetState(preset);
  const badge = stateBadge[state];
  // A tweak is a write to its module: it needs that module's unlock (plan 23).
  const unlock = useUnlockStatus(mod?.security, {
    reqHeader: mod?.reqHeader ?? preset.reqHeader,
    partNumber: mod ? partNumberFor(mod) : undefined,
  });

  if (!mod) return null;

  const run = async (on: boolean) => {
    setBusy(true);
    setPending(null);
    try {
      await applyTweak(preset, on);
    } finally {
      setBusy(false);
    }
  };

  return (
    <YStack gap="$2" backgroundColor="$color1" borderRadius="$3" padding="$2">
      <XStack alignItems="center" gap="$2">
        <YStack flex={1}>
          <Paragraph>{preset.title}</Paragraph>
          <Paragraph theme="alt2" size="$2">
            {mod.module}
          </Paragraph>
        </YStack>
        <Paragraph
          size="$2"
          fontFamily="$mono"
          theme={badge.theme ? undefined : 'alt2'}
          color={badge.theme ? '$statusOk' : undefined}
        >
          {badge.mark} {t(`tweak.state.${state}`)}
        </Paragraph>
      </XStack>
      <Paragraph theme="alt2" size="$2">
        {preset.description}
      </Paragraph>
      <VerificationBadge item={preset} testID={`verify-tweak-${preset.id}`} />
      <UnlockBadge status={unlock} testID={`unlock-tweak-${preset.id}`} />

      {pending === null ? (
        <XStack gap="$2">
          <Button
            flex={1}
            size="$3"
            hitSlop={HIT_SLOP}
            theme="green"
            disabled={!unlocked || busy || state === 'on'}
            onPress={() => setPending(true)}
          >
            {state === 'on' ? t('tweak.enabled') : t('tweak.enable')}
          </Button>
          <Button
            flex={1}
            size="$3"
            hitSlop={HIT_SLOP}
            disabled={!unlocked || busy || state === 'off'}
            onPress={() => setPending(false)}
          >
            {state === 'off' ? t('tweak.disabled') : t('tweak.revert')}
          </Button>
          <Button size="$3" hitSlop={HIT_SLOP} disabled={busy} onPress={() => read(mod)}>
            {t('tweak.refresh')}
          </Button>
        </XStack>
      ) : (
        <YStack gap="$2" backgroundColor="$color2" padding="$2" borderRadius="$3">
          <Paragraph size="$2">
            {pending
              ? t('tweak.confirmEnable', { title: preset.title, module: mod.module })
              : t('tweak.confirmRevert', { title: preset.title, module: mod.module })}
          </Paragraph>
          <XStack gap="$2">
            <Button
              flex={1}
              size="$3"
              hitSlop={HIT_SLOP}
              theme="red"
              disabled={busy}
              onPress={() => run(pending)}
            >
              {busy ? t('tweak.writing') : t('tweak.confirm')}
            </Button>
            <Button
              flex={1}
              size="$3"
              hitSlop={HIT_SLOP}
              disabled={busy}
              onPress={() => setPending(null)}
            >
              {t('common:actions.cancel')}
            </Button>
          </XStack>
        </YStack>
      )}
      {!unlocked ? (
        <Paragraph theme="alt2" size="$2">
          {t('tweak.unlockFirst')}
        </Paragraph>
      ) : null}
    </YStack>
  );
}

/** One-tap coding presets ("tweaks") for the current profile — OBDeleven-style curated toggles,
 *  each compiled down to the existing gated coding write (backup-first + verify-after). */
export function CodingTweaks() {
  const { t } = useTranslation('coding');
  const { presets } = useCoding();
  if (!presets.length) return null;
  return (
    <YStack gap="$2" backgroundColor="$color2" borderRadius="$4" padding="$3">
      <H4>{t('tweak.title')}</H4>
      <Paragraph theme="alt2" size="$2">
        {t('tweak.help')}
      </Paragraph>
      {presets.map((p) => (
        <TweakRow key={p.id} preset={p} />
      ))}
    </YStack>
  );
}
