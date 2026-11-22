import React from 'react';
import { YStack, XStack, Paragraph, Text, Card, Separator, Input } from 'tamagui';
import { Screen } from '@/shared/ui';
import { useVinDecode } from '../hooks/useVinDecode';
import { useTranslation } from '@/shared/i18n';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <XStack justifyContent="space-between" paddingVertical="$1.5">
      <Paragraph theme="alt2">{label}</Paragraph>
      <Text fontWeight="700" flexShrink={1} textAlign="right">
        {value}
      </Text>
    </XStack>
  );
}

export function VinDecodeScreen() {
  const { t } = useTranslation('vinDecode');
  const { sessionVin, manual, setManual, decoded } = useVinDecode();

  const checkDigit = decoded
    ? decoded.checkDigit.applicable
      ? decoded.checkDigit.valid
        ? t('check.valid')
        : t('check.invalid', { expected: decoded.checkDigit.expected })
      : t('check.na')
    : '';

  return (
    <Screen title={t('title')} subtitle={t('subtitle')}>
      <YStack gap="$1">
        <Paragraph theme="alt2" size="$2">
          {sessionVin ? t('labelFromCar') : t('labelType')}
        </Paragraph>
        <Input
          value={manual}
          onChangeText={setManual}
          placeholder={sessionVin ?? t('placeholder')}
          autoCapitalize="characters"
          autoCorrect={false}
          accessibilityLabel={t('inputA11y')}
        />
      </YStack>

      {decoded && decoded.validFormat ? (
        <Card bordered padding="$3">
          <Row label="VIN" value={decoded.vin} />
          <Separator />
          <Row label={t('manufacturer')} value={decoded.manufacturer} />
          <Separator />
          <Row label={t('country')} value={`${decoded.country} (${decoded.region})`} />
          <Separator />
          <Row
            label={t('modelYear')}
            value={decoded.modelYear != null ? String(decoded.modelYear) : t('unknown')}
          />
          <Separator />
          <Row label="WMI" value={decoded.wmi} />
          <Separator />
          <Row label={t('plantSerial')} value={`${decoded.plantCode} / ${decoded.serial}`} />
          <Separator />
          <Row label={t('checkDigit')} value={checkDigit} />
        </Card>
      ) : decoded ? (
        <Paragraph theme="alt2">{t('invalid')}</Paragraph>
      ) : (
        <Paragraph theme="alt2">{t('none')}</Paragraph>
      )}
    </Screen>
  );
}
