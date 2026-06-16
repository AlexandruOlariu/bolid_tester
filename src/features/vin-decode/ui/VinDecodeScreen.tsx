import React from 'react';
import { YStack, XStack, Paragraph, Text, Card, Separator, Input } from 'tamagui';
import { Screen } from '@/shared/ui';
import { useVinDecode } from '../hooks/useVinDecode';

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
  const { sessionVin, manual, setManual, decoded } = useVinDecode();

  const checkDigit = decoded
    ? decoded.checkDigit.applicable
      ? decoded.checkDigit.valid
        ? 'valid'
        : `invalid (≠ ${decoded.checkDigit.expected})`
      : 'n/a (non-US VIN)'
    : '';

  return (
    <Screen title="VIN decoder" subtitle="Offline WMI / country / year / check digit.">
      <YStack gap="$1">
        <Paragraph theme="alt2" size="$2">
          VIN {sessionVin ? '(from the car — or type another)' : '(type a 17-char VIN)'}
        </Paragraph>
        <Input
          value={manual}
          onChangeText={setManual}
          placeholder={sessionVin ?? 'e.g. WVWZZZ1KZ9W903398'}
          autoCapitalize="characters"
          autoCorrect={false}
        />
      </YStack>

      {decoded && decoded.validFormat ? (
        <Card bordered padding="$3">
          <Row label="VIN" value={decoded.vin} />
          <Separator />
          <Row label="Manufacturer" value={decoded.manufacturer} />
          <Separator />
          <Row label="Country" value={`${decoded.country} (${decoded.region})`} />
          <Separator />
          <Row label="Model year" value={decoded.modelYear != null ? String(decoded.modelYear) : 'unknown'} />
          <Separator />
          <Row label="WMI" value={decoded.wmi} />
          <Separator />
          <Row label="Plant / serial" value={`${decoded.plantCode} / ${decoded.serial}`} />
          <Separator />
          <Row label="Check digit" value={checkDigit} />
        </Card>
      ) : decoded ? (
        <Paragraph theme="alt2">Not a valid 17-character VIN (the letters I, O and Q are never used).</Paragraph>
      ) : (
        <Paragraph theme="alt2">No VIN yet — connect to a car or type a VIN above.</Paragraph>
      )}
    </Screen>
  );
}
