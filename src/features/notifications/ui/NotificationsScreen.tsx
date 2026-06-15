import React from 'react';
import { YStack, XStack, Paragraph, H4, Switch, Button } from 'tamagui';
import { Screen } from '@/shared/ui';
import { requestNotificationPermission } from '@/shared/notify';
import { useNotificationsStore } from '../model/notificationsStore';
import { useNotifications } from '../hooks/useNotifications';
import type { NotifCategory } from '@/shared/obd-core';

const CATEGORIES: { key: NotifCategory; label: string }[] = [
  { key: 'alert', label: 'Threshold alerts' },
  { key: 'connection', label: 'Connection events' },
  { key: 'diagnostic', label: 'Diagnostic events (MIL, new codes)' },
  { key: 'trip', label: 'Trip recorded' },
  { key: 'maintenance', label: 'Maintenance reminders' },
];

export function NotificationsScreen() {
  useNotifications();
  const prefs = useNotificationsStore((s) => s.prefs);
  const permission = useNotificationsStore((s) => s.permission);
  const setPermission = useNotificationsStore((s) => s.setPermission);
  const toggleCategory = useNotificationsStore((s) => s.toggleCategory);
  const reminders = useNotificationsStore((s) => s.reminders);

  return (
    <Screen title="Notifications" subtitle="Local, on-device — no account required">
      {permission !== 'granted' ? (
        <Button
          theme="green"
          onPress={async () => setPermission((await requestNotificationPermission()) ? 'granted' : 'denied')}
        >
          Enable notifications
        </Button>
      ) : (
        <Paragraph theme="alt2">Notifications enabled.</Paragraph>
      )}

      <YStack gap="$2">
        <H4>Categories</H4>
        {CATEGORIES.map((c) => (
          <XStack key={c.key} justifyContent="space-between" alignItems="center">
            <Paragraph flex={1}>{c.label}</Paragraph>
            <Switch checked={prefs.categories[c.key]} onCheckedChange={() => toggleCategory(c.key)}>
              <Switch.Thumb />
            </Switch>
          </XStack>
        ))}
      </YStack>

      <YStack gap="$1">
        <H4>Maintenance reminders</H4>
        {reminders.length === 0 ? (
          <Paragraph theme="alt2">
            None yet. Date reminders fire even with the app closed; mileage uses values you enter
            (odometer isn’t a standard OBD2 PID).
          </Paragraph>
        ) : (
          reminders.map((r) => <Paragraph key={r.id}>{r.title}</Paragraph>)
        )}
      </YStack>
    </Screen>
  );
}
