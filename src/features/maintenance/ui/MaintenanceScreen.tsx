import React, { useState } from 'react';
import { YStack, XStack, Paragraph, H4, Text, Button, Card, Input } from 'tamagui';
import { Screen, HIT_SLOP } from '@/shared/ui';
import type { DueInfo } from '@/shared/obd-core';
import { useMaintenance } from '../hooks/useMaintenance';
import { Trans, useTranslation, type TFunction } from '@/shared/i18n';

const STATUS_COLOR: Record<string, string> = {
  overdue: '$statusError',
  soon: '$statusWarn',
  ok: '$statusOk',
  unknown: '$muted',
};

function dueText(d: DueInfo, t: TFunction): string {
  const parts: string[] = [];
  if (d.dueInKm != null)
    parts.push(
      d.dueInKm < 0
        ? t('due.kmOver', { km: Math.abs(d.dueInKm) })
        : t('due.inKm', { km: d.dueInKm }),
    );
  if (d.dueInDays != null)
    parts.push(
      d.dueInDays < 0
        ? t('due.daysOver', { days: Math.abs(d.dueInDays) })
        : t('due.inDays', { days: d.dueInDays }),
    );
  return parts.join(' · ') || t('due.noHistory');
}

/** Each car keeps its own logbook (plan 06): the body is keyed by the active car, so switching cars
 *  also resets the odometer field to that car's value. */
export function MaintenanceScreen() {
  const m = useMaintenance();
  return <MaintenanceBody key={m.vehicleKey} {...m} />;
}

function MaintenanceBody({
  vehicleLabel,
  items,
  due,
  odoKm,
  setOdometer,
  addEntry,
}: ReturnType<typeof useMaintenance>) {
  const { t } = useTranslation('maintenance');
  const itemName = (id: string, name: string) => t(`item.${id}`, { defaultValue: name });
  const [odoText, setOdoText] = useState(odoKm != null ? String(odoKm) : '');
  const [selected, setSelected] = useState(items[0]?.id ?? '');

  const parsedOdo = parseInt(odoText.replace(/\D/g, ''), 10);
  const saveOdo = () => setOdometer(Number.isFinite(parsedOdo) ? parsedOdo : null);
  const logToday = () => {
    if (selected && Number.isFinite(parsedOdo)) {
      addEntry({ itemId: selected, date: Date.now(), odoKm: parsedOdo });
    }
  };

  return (
    <Screen title={t('title')} subtitle={t('subtitle')}>
      <Paragraph theme="alt2" size="$2">
        <Trans
          i18nKey="maintenance:logbookFor"
          values={{ car: vehicleLabel }}
          components={{ b: <Text fontWeight="800" /> }}
        />
      </Paragraph>
      <Card bordered padding="$3" gap="$2">
        <Paragraph theme="alt2" size="$2">
          {t('odometer')}
        </Paragraph>
        <XStack gap="$2" alignItems="center">
          <Input
            flex={1}
            value={odoText}
            onChangeText={setOdoText}
            keyboardType="numeric"
            placeholder={t('odometerPlaceholder')}
            accessibilityLabel={t('odometerA11y')}
          />
          <Button onPress={saveOdo}>{t('save')}</Button>
        </XStack>
      </Card>

      <YStack gap="$2">
        {due.map((d) => (
          <XStack
            key={d.itemId}
            justifyContent="space-between"
            alignItems="center"
            padding="$3"
            backgroundColor="$color2"
            borderRadius="$4"
          >
            <YStack flex={1}>
              <H4>{itemName(d.itemId, d.name)}</H4>
              <Paragraph theme="alt2" size="$2">
                {dueText(d, t)}
              </Paragraph>
            </YStack>
            <Text color={STATUS_COLOR[d.status]} fontWeight="800">
              {t(`status.${d.status}`, { defaultValue: d.status.toUpperCase() })}
            </Text>
          </XStack>
        ))}
      </YStack>

      <Card bordered padding="$3" gap="$2">
        <Paragraph fontWeight="700">{t('logService')}</Paragraph>
        <XStack flexWrap="wrap" gap="$2">
          {items.map((it) => (
            <Button
              key={it.id}
              size="$3"
              hitSlop={HIT_SLOP}
              theme={selected === it.id ? 'blue' : undefined}
              onPress={() => setSelected(it.id)}
            >
              {itemName(it.id, it.name)}
            </Button>
          ))}
        </XStack>
        <Button theme="green" onPress={logToday} disabled={!Number.isFinite(parsedOdo)}>
          {t('logToday', {
            name: (() => {
              const it = items.find((i) => i.id === selected);
              return it ? itemName(it.id, it.name) : '—';
            })(),
          })}
        </Button>
      </Card>
    </Screen>
  );
}
