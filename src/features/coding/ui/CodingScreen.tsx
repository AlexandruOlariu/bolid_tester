import React, { useState } from 'react';
import { YStack, XStack, Paragraph, H4, Button, Switch } from 'tamagui';
import { Screen } from '@/shared/ui';
import { bytesToHexString } from '@/shared/obd-core';
import type { CodingModule } from '@/shared/vehicles';
import { useCodingStore } from '../model/codingStore';
import { useCoding } from '../hooks/useCoding';

function ModuleEditor({ mod }: { mod: CodingModule }) {
  const { read, write, toggleBit } = useCoding();
  const current = useCodingStore((s) => s.current[mod.module]) ?? mod.sampleCoding;
  const [original, setOriginal] = useState<number[] | null>(null);

  return (
    <YStack gap="$2" backgroundColor="$color2" padding="$3" borderRadius="$4">
      <H4>{mod.module}</H4>
      <XStack gap="$2">
        <Button size="$2" onPress={async () => setOriginal((await read(mod)) ?? current)}>
          Read + backup
        </Button>
      </XStack>
      <Paragraph theme="alt2" size="$2">
        Coding: {bytesToHexString(current)}
      </Paragraph>
      {mod.schema.map((f) =>
        f.bit !== undefined ? (
          <XStack key={f.name} justifyContent="space-between" alignItems="center">
            <Paragraph flex={1}>{f.name}</Paragraph>
            <Switch
              checked={((current[f.byte] ?? 0) >> f.bit!) % 2 === 1}
              onCheckedChange={() => toggleBit(mod, current, f.byte, f.bit!)}
            >
              <Switch.Thumb />
            </Switch>
          </XStack>
        ) : null,
      )}
      {original ? (
        <Paragraph theme="alt2" size="$2">
          Before: {bytesToHexString(original)} → After: {bytesToHexString(current)}
        </Paragraph>
      ) : null}
      <Button theme="red" onPress={() => void write(mod, current)}>
        Write coding (experimental)
      </Button>
    </YStack>
  );
}

export function CodingScreen() {
  const { available, modules } = useCoding();
  const unlocked = useCodingStore((s) => s.unlocked);
  const setUnlocked = useCodingStore((s) => s.setUnlocked);
  const lastResult = useCodingStore((s) => s.lastResult);

  if (!available) {
    return (
      <Screen title="Coding">
        <Paragraph theme="alt2">
          Coding is unavailable for this car / protocol. It is experimental, CAN-only, and
          profile-gated.
        </Paragraph>
      </Screen>
    );
  }

  return (
    <Screen title="Coding" subtitle="⚠ Experimental — writes can disable functions. Your car, your risk.">
      <XStack justifyContent="space-between" alignItems="center">
        <Paragraph flex={1}>Unlock writing</Paragraph>
        <Switch checked={unlocked} onCheckedChange={(v) => setUnlocked(!!v)}>
          <Switch.Thumb />
        </Switch>
      </XStack>
      {lastResult ? <Paragraph theme="alt2">{lastResult}</Paragraph> : null}
      {modules.map((m) => (
        <ModuleEditor key={m.module} mod={m} />
      ))}
    </Screen>
  );
}
