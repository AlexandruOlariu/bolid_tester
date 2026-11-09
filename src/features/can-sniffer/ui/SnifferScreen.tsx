import React from 'react';
import { YStack, XStack, Paragraph, Button, Input } from 'tamagui';
import { Screen } from '@/shared/ui';
import { MONITOR_UNAVAILABLE_MESSAGE } from '@/shared/obd-core';
import { useSnifferStore } from '../model/snifferStore';
import { useSniffer } from '../hooks/useSniffer';

const hex = (b: number[]) => b.map((x) => x.toString(16).padStart(2, '0').toUpperCase()).join(' ');

export function SnifferScreen() {
  const { available, canMonitor, start, stop, exportCsv, exportRaw, exporting } = useSniffer();
  const running = useSnifferStore((s) => s.running);
  const stats = useSnifferStore((s) => s.stats);
  const totalFrames = useSnifferStore((s) => s.totalFrames);
  const capturedLines = useSnifferStore((s) => s.capturedLines);
  const dropped = useSnifferStore((s) => s.dropped);
  const note = useSnifferStore((s) => s.note);
  const setNote = useSnifferStore((s) => s.setNote);
  const lastExportUri = useSnifferStore((s) => s.lastExportUri);

  // A finished capture stays shareable after the link drops (its header was frozen at Start);
  // only an empty screen collapses to "Not connected.".
  if (!available && (running || capturedLines === 0)) {
    return (
      <Screen title="Bus sniffer">
        <Paragraph theme="alt2">Not connected.</Paragraph>
      </Screen>
    );
  }

  const canShare = !running && !exporting && capturedLines > 0;

  return (
    // `wide` (plan 21): the frame table uses the full tablet width.
    <Screen
      title="Bus sniffer"
      subtitle="Raw adapter monitor (ATMA) — live polling pauses while sniffing"
      wide
    >
      <YStack gap="$1">
        <Paragraph theme="alt2" size="$2">
          Note (saved in the capture file)
        </Paragraph>
        <Input
          size="$3"
          value={note}
          onChangeText={setNote}
          editable={!running}
          placeholder="What is happening? e.g. VCDS Group 121 basic settings, engine idle"
          accessibilityLabel="Capture note"
        />
      </YStack>
      {available && !canMonitor ? (
        <YStack
          gap="$1"
          backgroundColor="$color2"
          borderRadius="$3"
          padding="$3"
          testID="sniffer-unavailable"
        >
          <Paragraph fontWeight="700">{MONITOR_UNAVAILABLE_MESSAGE}.</Paragraph>
          <Paragraph theme="alt2" size="$2">
            Classic Bluetooth adapters hand over each reply only when the adapter’s “&gt;” prompt
            arrives, and the bus monitor streams without one. Use a Bluetooth LE or Wi-Fi adapter to
            sniff the bus; every other screen works over this adapter.
          </Paragraph>
        </YStack>
      ) : available ? (
        <Button theme={running ? 'red' : 'green'} onPress={() => (running ? stop() : start())}>
          {running ? `Stop (${totalFrames} frames)` : 'Start monitoring'}
        </Button>
      ) : (
        <Paragraph theme="alt2">Not connected — reconnect to start a new run.</Paragraph>
      )}
      {running || capturedLines > 0 ? (
        <Paragraph theme="alt2" size="$2">
          {`captured ${capturedLines} · dropped ${dropped}`}
          {dropped > 0 ? ' (the oldest lines were discarded to keep memory bounded)' : ''}
        </Paragraph>
      ) : null}
      {running || capturedLines > 0 ? (
        <YStack gap="$2">
          <XStack gap="$2">
            <Button
              flex={1}
              size="$3"
              disabled={!canShare}
              opacity={canShare ? 1 : 0.5}
              onPress={() => void exportCsv()}
            >
              Share CSV
            </Button>
            <Button
              flex={1}
              size="$3"
              disabled={!canShare}
              opacity={canShare ? 1 : 0.5}
              onPress={() => void exportRaw()}
            >
              Share raw
            </Button>
          </XStack>
          <Paragraph theme="alt2" size="$2">
            {running
              ? 'Stop the monitor to share the capture.'
              : 'CSV has one row per frame (time since start, CAN id, byte count, bytes); raw is every adapter line exactly as printed. The file carries the car, adapter and note as they were at Start.'}
          </Paragraph>
          {lastExportUri && !running ? (
            <Paragraph theme="alt2" size="$1" fontFamily="$mono">
              Saved: {lastExportUri.split('/').pop()}
            </Paragraph>
          ) : null}
        </YStack>
      ) : null}
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
          Streams every frame the adapter hears (headers on). On K-line cars you will mostly see the
          periodic keep-alives; on CAN this is the live bus grouped by arbitration id. Every line is
          kept (up to 20 000) so the run can be shared after Stop.
        </Paragraph>
      )}
    </Screen>
  );
}
