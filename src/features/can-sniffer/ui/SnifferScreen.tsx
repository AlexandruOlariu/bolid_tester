import React from 'react';
import { YStack, XStack, Paragraph, Button, Input } from 'tamagui';
import { Screen, HIT_SLOP } from '@/shared/ui';
import { MONITOR_UNAVAILABLE_MESSAGE } from '@/shared/obd-core';
import { useSnifferStore } from '../model/snifferStore';
import { useSniffer } from '../hooks/useSniffer';
import { useTranslation } from '@/shared/i18n';

const hex = (b: number[]) => b.map((x) => x.toString(16).padStart(2, '0').toUpperCase()).join(' ');

export function SnifferScreen() {
  const { t } = useTranslation('canSniffer');
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
      <Screen title={t('title')}>
        <Paragraph theme="alt2">{t('notConnected')}</Paragraph>
      </Screen>
    );
  }

  const canShare = !running && !exporting && capturedLines > 0;

  return (
    // `wide` (plan 21): the frame table uses the full tablet width.
    <Screen title={t('title')} subtitle={t('subtitle')} wide>
      <YStack gap="$1">
        <Paragraph theme="alt2" size="$2">
          {t('note')}
        </Paragraph>
        <Input
          size="$3"
          value={note}
          onChangeText={setNote}
          editable={!running}
          placeholder={t('notePlaceholder')}
          accessibilityLabel={t('noteA11y')}
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
          <Paragraph fontWeight="700">
            {t('unavailableTitle', { defaultValue: `${MONITOR_UNAVAILABLE_MESSAGE}.` })}
          </Paragraph>
          <Paragraph theme="alt2" size="$2">
            {t('unavailableBody')}
          </Paragraph>
        </YStack>
      ) : available ? (
        <Button theme={running ? 'red' : 'green'} onPress={() => (running ? stop() : start())}>
          {running ? t('stop', { count: totalFrames }) : t('start')}
        </Button>
      ) : (
        <Paragraph theme="alt2">{t('reconnect')}</Paragraph>
      )}
      {running || capturedLines > 0 ? (
        <Paragraph theme="alt2" size="$2">
          {t('counts', { captured: capturedLines, dropped })}
          {dropped > 0 ? ` ${t('droppedNote')}` : ''}
        </Paragraph>
      ) : null}
      {running || capturedLines > 0 ? (
        <YStack gap="$2">
          <XStack gap="$2">
            <Button
              flex={1}
              size="$3"
              hitSlop={HIT_SLOP}
              disabled={!canShare}
              opacity={canShare ? 1 : 0.5}
              onPress={() => void exportCsv()}
            >
              {t('shareCsv')}
            </Button>
            <Button
              flex={1}
              size="$3"
              hitSlop={HIT_SLOP}
              disabled={!canShare}
              opacity={canShare ? 1 : 0.5}
              onPress={() => void exportRaw()}
            >
              {t('shareRaw')}
            </Button>
          </XStack>
          <Paragraph theme="alt2" size="$2">
            {running ? t('stopToShare') : t('shareHelp')}
          </Paragraph>
          {lastExportUri && !running ? (
            <Paragraph theme="alt2" size="$1" fontFamily="$mono">
              {t('saved', { file: lastExportUri.split('/').pop() })}
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
              {t('count')}
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
          {t('help')}
        </Paragraph>
      )}
    </Screen>
  );
}
