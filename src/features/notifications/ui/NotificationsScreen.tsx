import React from 'react';
import { YStack, Paragraph, H4, Button } from 'tamagui';
import { Screen, LabeledSwitch } from '@/shared/ui';
import { useNotificationsStore } from '../model/notificationsStore';
import { useNotifications } from '../hooks/useNotifications';
import { useNotificationPermission } from '../hooks/useNotificationPermission';
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
  const { permission, request, canOpenSettings, openSettings } = useNotificationPermission();
  const toggleCategory = useNotificationsStore((s) => s.toggleCategory);
  const reminders = useNotificationsStore((s) => s.reminders);

  return (
    <Screen title="Notifications" subtitle="Local, on-device — no account required">
      {permission === 'granted' ? (
        <Paragraph theme="alt2">Notifications enabled.</Paragraph>
      ) : permission === 'denied' ? (
        canOpenSettings ? (
          <YStack gap="$2" testID="notifications-denied">
            <Paragraph theme="alt2">
              Notifications are turned off for Bolid Tester. The phone will not ask again — turn
              them on in the system settings.
            </Paragraph>
            <Button theme="green" onPress={openSettings}>
              Open settings
            </Button>
          </YStack>
        ) : (
          <Paragraph theme="alt2" testID="notifications-denied-web">
            Notifications are blocked or not available in this browser. Allow them in the browser’s
            site settings for this page. On iPhone, add Bolid Tester to the Home Screen first.
          </Paragraph>
        )
      ) : (
        <Button theme="green" onPress={() => void request()}>
          Enable notifications
        </Button>
      )}

      <YStack gap="$2">
        <H4>Categories</H4>
        {CATEGORIES.map((c) => (
          <LabeledSwitch
            key={c.key}
            label={c.label}
            checked={prefs.categories[c.key]}
            onCheckedChange={() => toggleCategory(c.key)}
          />
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
