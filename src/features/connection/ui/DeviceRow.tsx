import React from 'react';
import { XStack, YStack, Text, Button, Paragraph, Stack } from 'tamagui';
import { HIT_SLOP } from '@/shared/ui';
import {
  communitySummary,
  knownAdapterChip,
  matchKnownAdapter,
  type KnownAdapter,
} from '@/shared/adapters';
import type { ScannedDevice } from '../model/scanStore';
import { Panel } from '../styles/connection.styles';
import { useTranslation } from '@/shared/i18n';

interface DeviceRowProps {
  device: ScannedDevice;
  onConnect: () => void;
  disabled?: boolean;
}

/** Semantic fills with `$onFill` text (plan 20, the StatusBadge pattern). */
const CHIP_COLORS: Record<KnownAdapter['typicalGrade'], string> = {
  good: '$statusOk',
  ok: '$statusWarn',
  poor: '$statusError',
};

/** "known good" / "known ok" / "known poor" — the community compatibility matrix's typical grade for
 *  this advertised name (plan 29, `@/shared/adapters`). */
function KnownAdapterChip({ known }: { known: KnownAdapter }) {
  const { t } = useTranslation('connection');
  return (
    <Stack
      testID="known-adapter-chip"
      backgroundColor={CHIP_COLORS[known.typicalGrade]}
      borderRadius="$10"
      paddingHorizontal="$2"
      paddingVertical={2}
      alignSelf="flex-start"
      accessible
      accessibilityRole="text"
      accessibilityLabel={t('device.knownA11y', { summary: communitySummary(known) })}
    >
      <Text fontSize="$1" color="$onFill" fontWeight="700">
        {t(`device.known.${known.typicalGrade}`, { defaultValue: knownAdapterChip(known) })}
      </Text>
    </Stack>
  );
}

export function DeviceRow({ device, onConnect, disabled }: DeviceRowProps) {
  const { t } = useTranslation('connection');
  const known = matchKnownAdapter(device.name);
  return (
    <Panel>
      <XStack justifyContent="space-between" alignItems="center" gap="$2">
        <YStack flex={1}>
          <Text fontWeight="700" numberOfLines={1}>
            {device.name ?? t('device.unnamed')}
            {device.isLikelyAdapter ? '  ⭐' : ''}
          </Text>
          <Paragraph theme="alt2" fontSize="$2" numberOfLines={1}>
            {device.id}
            {device.rssi != null ? ` · ${device.rssi} dBm` : ''}
          </Paragraph>
          {known ? <KnownAdapterChip known={known} /> : null}
        </YStack>
        <Button
          size="$3"
          hitSlop={HIT_SLOP}
          theme="green"
          onPress={onConnect}
          disabled={disabled}
          accessibilityLabel={t('device.connectTo', { name: device.name ?? device.id })}
        >
          {t('ble.connect')}
        </Button>
      </XStack>
    </Panel>
  );
}
