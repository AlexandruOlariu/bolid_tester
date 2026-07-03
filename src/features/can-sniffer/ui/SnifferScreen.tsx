import React from 'react';
import { YStack, XStack, Paragraph, Button } from 'tamagui';
import { Screen } from '@/shared/ui';
import { useSnifferStore } from '../model/snifferStore';
import { useSniffer } from '../hooks/useSniffer';

const hex = (b: number[]) => b.map((x) => x.toString(16).padStart(2, '0').toUpperCase()).join(' ');

export function SnifferScreen() {
  const { available, start, stop } = useSniffer();
  const running = useSnifferStore((s) => s.running);
  const stats = useSnifferStore((s) => s.stats);
  const totalFrames = useSnifferStore((s) => s.totalFrames);

  if (!available) {
    return (
      <Screen title="Bus sniffer">
        <Paragraph theme="alt2">Not connected.</Paragraph>
      </Screen>
    );
  }

  return (
    <Screen
      title="Bus sniffer"
      subtitle="Raw adapter monitor (ATMA) — live polling pauses while sniffing"
    >
      <Button theme={running ? 'red' : 'green'} onPress={() => (running ? stop() : start())}>
        {running ? `Stop (${totalFrames} frames)` : 'Start monitoring'}
      </Button>
      {stats.length ? (
        <YStack gap="$2">
          <XStack gap="$2">
            <Paragraph flex={1} theme="alt2" size="$2">
              ID
            </Paragraph>
            <Paragraph width={60} theme="alt2" size="$2">
              count
            </Paragraph>
            <Paragraph width={60} theme="alt2" size="$2">
              /s
            </Paragraph>
          </XStack>
          {stats.map((s) => (
            <YStack key={s.id} backgroundColor="$color2" borderRadius="$3" padding="$2">
              <XStack gap="$2">
                <Paragraph flex={1} fontFamily="$mono">
                  {s.id}
                </Paragraph>
                <Paragraph width={60}>{s.count}</Paragraph>
                <Paragraph width={60}>{s.rate || '—'}</Paragraph>
              </XStack>
              <Paragraph theme="alt2" size="$2" fontFamily="$mono">
                {hex(s.lastBytes)}
              </Paragraph>
            </YStack>
          ))}
        </YStack>
      ) : (
        <Paragraph theme="alt2" size="$2">
          Streams every frame the adapter hears (headers on). On K-line cars you will mostly see
          the periodic keep-alives; on CAN this is the live bus grouped by arbitration id.
        </Paragraph>
      )}
    </Screen>
  );
}
