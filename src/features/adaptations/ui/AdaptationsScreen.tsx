import React, { useState } from 'react';
import { YStack, XStack, Paragraph, H4, Button, Switch, Input } from 'tamagui';
import { Screen } from '@/shared/ui';
import type { AdaptationChannel } from '@/shared/vehicles';
import { useAdaptationsStore } from '../model/adaptationsStore';
import { useAdaptations } from '../hooks/useAdaptations';

function ChannelRow({ ch }: { ch: AdaptationChannel }) {
  const { describe, read, write, restore, display } = useAdaptations();
  const unlocked = useAdaptationsStore((s) => s.unlocked);
  const running = useAdaptationsStore((s) => s.running);
  const raw = useAdaptationsStore((s) => s.values[ch.did]);
  const backups = useAdaptationsStore((s) => s.backups.filter((b) => b.did === ch.did));
  const [draft, setDraft] = useState<string>('');
  const [confirming, setConfirming] = useState(false);

  const current = display(ch, raw);
  const description = describe(ch);

  return (
    <YStack gap="$2" backgroundColor="$color2" padding="$3" borderRadius="$4">
      <XStack alignItems="center" gap="$2">
        <YStack flex={1}>
          <H4>{ch.name}</H4>
          <Paragraph theme="alt2" size="$2">
            {ch.module} · DID {ch.did}
            {ch.min !== undefined && ch.max !== undefined ? ` · ${ch.min}–${ch.max}${ch.unit ?? ''}` : ''}
          </Paragraph>
        </YStack>
        <Paragraph>{current !== null ? `${current}${ch.unit ?? ''}` : '—'}</Paragraph>
      </XStack>
      {description ? (
        <Paragraph theme="alt2" size="$2">
          {description}
        </Paragraph>
      ) : null}
      <Paragraph theme="alt2" size="$2">
        ⚠ Experimental / unverified channel — confirm behaviour on the real car.
      </Paragraph>
      <XStack gap="$2">
        <Button size="$3" disabled={running} onPress={() => read(ch)}>
          Read
        </Button>
        {ch.security ? (
          <Paragraph theme="alt2" size="$2" alignSelf="center">
            Security-locked (read-only)
          </Paragraph>
        ) : null}
      </XStack>
      {unlocked && !ch.security ? (
        <YStack gap="$2">
          <XStack gap="$2" alignItems="center">
            <Input
              flex={1}
              size="$3"
              keyboardType="numeric"
              placeholder={current !== null ? String(current) : 'new value'}
              value={draft}
              onChangeText={setDraft}
            />
            {!confirming ? (
              <Button
                size="$3"
                theme="red"
                disabled={running || raw === undefined || draft.trim() === ''}
                onPress={() => setConfirming(true)}
              >
                Write
              </Button>
            ) : null}
          </XStack>
          {raw === undefined ? (
            <Paragraph theme="alt2" size="$2">
              Read the current value first — writes always start from a fresh backup.
            </Paragraph>
          ) : null}
          {confirming ? (
            <YStack gap="$2" backgroundColor="$color1" padding="$2" borderRadius="$3">
              <Paragraph size="$2">
                Write {draft}
                {ch.unit ?? ''} to {ch.name} (was {current ?? '—'}
                {ch.unit ?? ''})? The old value is backed up and re-verified after writing.
              </Paragraph>
              <XStack gap="$2">
                <Button
                  flex={1}
                  size="$3"
                  theme="red"
                  disabled={running}
                  onPress={async () => {
                    setConfirming(false);
                    await write(ch, Number(draft));
                    setDraft('');
                  }}
                >
                  Confirm write
                </Button>
                <Button flex={1} size="$3" onPress={() => setConfirming(false)}>
                  Cancel
                </Button>
              </XStack>
            </YStack>
          ) : null}
          {backups.length ? (
            <Button
              size="$3"
              disabled={running}
              onPress={() => restore(ch, backups[0].raw)}
            >
              Restore backup ({new Date(backups[0].at).toLocaleTimeString()})
            </Button>
          ) : null}
          {ch.defaultRaw ? (
            <Button size="$3" disabled={running} onPress={() => restore(ch, ch.defaultRaw!)}>
              Restore known default
            </Button>
          ) : null}
        </YStack>
      ) : null}
    </YStack>
  );
}

export function AdaptationsScreen() {
  const { available, channels } = useAdaptations();
  const unlocked = useAdaptationsStore((s) => s.unlocked);
  const setUnlocked = useAdaptationsStore((s) => s.setUnlocked);
  const lastResult = useAdaptationsStore((s) => s.lastResult);

  if (!available) {
    return (
      <Screen title="Adaptations">
        <Paragraph theme="alt2">
          Adaptation channels are unavailable for this car / protocol. They are experimental,
          profile-driven and CAN-only — the current profile declares
          {channels.length ? ' channels but the link is not CAN.' : ' none.'}
        </Paragraph>
      </Screen>
    );
  }

  return (
    <Screen
      title="Adaptations"
      subtitle="⚠ Experimental — writes module adaptation values. Backup + verify on every write."
    >
      <XStack
        alignItems="center"
        justifyContent="space-between"
        backgroundColor="$color2"
        padding="$3"
        borderRadius="$4"
      >
        <YStack flex={1}>
          <H4>Unlock writes</H4>
          <Paragraph theme="alt2" size="$2">
            Off = read-only. Writes back up the old value and verify after writing.
          </Paragraph>
        </YStack>
        <Switch checked={unlocked} onCheckedChange={(v) => setUnlocked(!!v)}>
          <Switch.Thumb />
        </Switch>
      </XStack>
      {lastResult ? <Paragraph>{lastResult}</Paragraph> : null}
      {channels.map((ch) => (
        <ChannelRow key={ch.did} ch={ch} />
      ))}
    </Screen>
  );
}
