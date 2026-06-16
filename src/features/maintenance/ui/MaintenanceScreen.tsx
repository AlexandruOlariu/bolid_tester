import React, { useState } from 'react';
import { YStack, XStack, Paragraph, H4, Text, Button, Card, Input } from 'tamagui';
import { Screen } from '@/shared/ui';
import type { DueInfo } from '@/shared/obd-core';
import { useMaintenance } from '../hooks/useMaintenance';

const STATUS_COLOR: Record<string, string> = {
  overdue: '#f85149',
  soon: '#d29922',
  ok: '#2bb673',
  unknown: '#8B949E',
};

function dueText(d: DueInfo): string {
  const parts: string[] = [];
  if (d.dueInKm != null) parts.push(d.dueInKm < 0 ? `${Math.abs(d.dueInKm)} km over` : `in ${d.dueInKm} km`);
  if (d.dueInDays != null) parts.push(d.dueInDays < 0 ? `${Math.abs(d.dueInDays)} d over` : `in ${d.dueInDays} d`);
  return parts.join(' · ') || 'no history yet';
}

export function MaintenanceScreen() {
  const { items, due, odoKm, setOdometer, addEntry } = useMaintenance();
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
    <Screen title="Maintenance log" subtitle="Odometer is entered by you — it isn't an OBD2 value.">
      <Card bordered padding="$3" gap="$2">
        <Paragraph theme="alt2" size="$2">
          Current odometer (km)
        </Paragraph>
        <XStack gap="$2" alignItems="center">
          <Input flex={1} value={odoText} onChangeText={setOdoText} keyboardType="numeric" placeholder="e.g. 215000" />
          <Button onPress={saveOdo}>Save</Button>
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
              <H4>{d.name}</H4>
              <Paragraph theme="alt2" size="$2">
                {dueText(d)}
              </Paragraph>
            </YStack>
            <Text color={STATUS_COLOR[d.status]} fontWeight="800">
              {d.status.toUpperCase()}
            </Text>
          </XStack>
        ))}
      </YStack>

      <Card bordered padding="$3" gap="$2">
        <Paragraph fontWeight="700">Log a service (at the odometer above)</Paragraph>
        <XStack flexWrap="wrap" gap="$2">
          {items.map((it) => (
            <Button
              key={it.id}
              size="$2"
              theme={selected === it.id ? 'blue' : undefined}
              onPress={() => setSelected(it.id)}
            >
              {it.name}
            </Button>
          ))}
        </XStack>
        <Button theme="green" onPress={logToday} disabled={!Number.isFinite(parsedOdo)}>
          Log “{items.find((i) => i.id === selected)?.name ?? '—'}” today
        </Button>
      </Card>
    </Screen>
  );
}
