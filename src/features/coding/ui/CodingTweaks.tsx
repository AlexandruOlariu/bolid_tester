import React, { useState } from 'react';
import { YStack, XStack, Paragraph, H4, Button } from 'tamagui';
import type { CodingPreset, CodingPresetState } from '@/shared/obd-core';
import { useCodingStore } from '../model/codingStore';
import { useCoding } from '../hooks/useCoding';

const stateBadge: Record<CodingPresetState, { label: string; theme?: 'green' }> = {
  on: { label: '● on', theme: 'green' },
  off: { label: '○ off' },
  unknown: { label: '? unknown' },
};

/** One curated tweak: current on/off/unknown state + one-tap enable/revert behind the coding gate. */
function TweakRow({ preset }: { preset: CodingPreset }) {
  const { moduleForPreset, presetState, applyTweak, read } = useCoding();
  const unlocked = useCodingStore((s) => s.unlocked);
  const [pending, setPending] = useState<null | boolean>(null);
  const [busy, setBusy] = useState(false);

  const mod = moduleForPreset(preset);
  const state = presetState(preset);
  const badge = stateBadge[state];

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
        <Paragraph size="$2" fontFamily="$mono" theme={badge.theme ? undefined : 'alt2'} color={badge.theme ? '$green10' : undefined}>
          {badge.label}
        </Paragraph>
      </XStack>
      <Paragraph theme="alt2" size="$2">
        {preset.description}
      </Paragraph>

      {pending === null ? (
        <XStack gap="$2">
          <Button
            flex={1}
            size="$2"
            theme="green"
            disabled={!unlocked || busy || state === 'on'}
            onPress={() => setPending(true)}
          >
            {state === 'on' ? 'Enabled' : 'Enable'}
          </Button>
          <Button
            flex={1}
            size="$2"
            disabled={!unlocked || busy || state === 'off'}
            onPress={() => setPending(false)}
          >
            {state === 'off' ? 'Disabled' : 'Revert'}
          </Button>
          <Button size="$2" disabled={busy} onPress={() => read(mod)}>
            Refresh
          </Button>
        </XStack>
      ) : (
        <YStack gap="$2" backgroundColor="$color2" padding="$2" borderRadius="$3">
          <Paragraph size="$2">
            {pending ? 'Enable' : 'Revert'} “{preset.title}” on {mod.module}? The current coding is
            read + backed up, then written and re-verified.
          </Paragraph>
          <XStack gap="$2">
            <Button flex={1} size="$3" theme="red" disabled={busy} onPress={() => run(pending)}>
              {busy ? 'Writing…' : 'Confirm'}
            </Button>
            <Button flex={1} size="$3" disabled={busy} onPress={() => setPending(null)}>
              Cancel
            </Button>
          </XStack>
        </YStack>
      )}
      {!unlocked ? (
        <Paragraph theme="alt2" size="$2">
          Unlock writing above to apply tweaks.
        </Paragraph>
      ) : null}
    </YStack>
  );
}

/** One-tap coding presets ("tweaks") for the current profile — OBDeleven-style curated toggles,
 *  each compiled down to the existing gated coding write (backup-first + verify-after). */
export function CodingTweaks() {
  const { presets } = useCoding();
  if (!presets.length) return null;
  return (
    <YStack gap="$2" backgroundColor="$color2" borderRadius="$4" padding="$3">
      <H4>Tweaks</H4>
      <Paragraph theme="alt2" size="$2">
        Curated, reversible one-tap changes. Each reads + backs up the live coding, then writes and
        re-verifies through the same guarded path. Experimental — confirm on the real car.
      </Paragraph>
      {presets.map((p) => (
        <TweakRow key={p.id} preset={p} />
      ))}
    </YStack>
  );
}
