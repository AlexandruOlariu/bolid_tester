import React from 'react';
import { useRouter } from 'expo-router';
import { YStack, XStack, Card, Text, Paragraph, Separator, Button } from 'tamagui';
import { Screen } from '@/shared/ui';
import { useSessionStore } from '@/shared/state/sessionStore';
import { useVehicleInfo } from '../hooks/useVehicleInfo';
import { useTranslation } from '@/shared/i18n';
import { formatFixed } from '@/shared/lib/format';

/** Label left, value right; at large font sizes a long value (VIN, protocol) wraps onto its own
 *  line instead of running off the card (plan 20). */
function Row({ label, value }: { label: string; value: string }) {
  return (
    <XStack flexWrap="wrap" columnGap="$3" paddingVertical="$1.5">
      <Paragraph theme="alt2">{label}</Paragraph>
      <Text flexShrink={1} marginLeft="auto" textAlign="right" fontWeight="700">
        {value}
      </Text>
    </XStack>
  );
}

export function VehicleInfoScreen() {
  const { t } = useTranslation('vehicleInfo');
  const router = useRouter();
  const status = useSessionStore((s) => s.status);
  const { info, deviceName, protocolLabel } = useVehicleInfo();

  if (status !== 'connected' || !info) {
    return (
      <Screen title={t('title')}>
        <Paragraph theme="alt2">{t('notConnected')}</Paragraph>
        <Button theme="blue" onPress={() => router.push('/report')}>
          {t('fullReport')}
        </Button>
      </Screen>
    );
  }

  return (
    <Screen title={t('title')}>
      <Card bordered padding="$3">
        <Row label="VIN" value={info.vin ?? t('notAvailable')} />
        <Separator />
        <Row label={t('calibrationId')} value={info.calibrationId ?? t('notAvailable')} />
        <Separator />
        <Row label={t('protocol')} value={protocolLabel} />
        <Separator />
        <Row label={t('adapter')} value={deviceName ?? '—'} />
        <Separator />
        <Row label={t('elmVersion')} value={info.version || '—'} />
        <Separator />
        <Row
          label={t('voltage')}
          value={info.voltage != null ? `${formatFixed(info.voltage, 1)} V` : '—'}
        />
        <Separator />
        <Row label={t('supportedPids')} value={String(info.supportedPids.length)} />
      </Card>

      <YStack gap="$1">
        <Text fontWeight="700">{t('supportedMode01')}</Text>
        <Paragraph theme="alt2" fontSize="$2">
          {info.supportedPids.join('  ')}
        </Paragraph>
      </YStack>

      <Button theme="blue" onPress={() => router.push('/extended')}>
        {t('extended')}
      </Button>

      <Button theme="blue" onPress={() => router.push('/vin-decode')}>
        {t('decodeVin')}
      </Button>

      <Button theme="green" onPress={() => router.push('/report')}>
        {t('fullReport')}
      </Button>
    </Screen>
  );
}
