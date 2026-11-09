import React from 'react';
import { YStack, Paragraph, H4, Button } from 'tamagui';
import { Screen, LabeledSwitch } from '@/shared/ui';
import { useNotificationsStore } from '../model/notificationsStore';
import { useNotifications } from '../hooks/useNotifications';
import { useNotificationPermission } from '../hooks/useNotificationPermission';
import type { NotifCategory } from '@/shared/obd-core';
import { useTranslation } from '@/shared/i18n';

/** The categories, in order; labels are `notifications:category.<key>` (plan 11). */
const CATEGORIES: NotifCategory[] = ['alert', 'connection', 'diagnostic', 'trip', 'maintenance'];

export function NotificationsScreen() {
  const { t } = useTranslation('notifications');
  useNotifications();
  const prefs = useNotificationsStore((s) => s.prefs);
  const { permission, request, canOpenSettings, openSettings } = useNotificationPermission();
  const toggleCategory = useNotificationsStore((s) => s.toggleCategory);
  const reminders = useNotificationsStore((s) => s.reminders);

  return (
    <Screen title={t('title')} subtitle={t('subtitle')}>
      {permission === 'granted' ? (
        <Paragraph theme="alt2">{t('enabled')}</Paragraph>
      ) : permission === 'denied' ? (
        canOpenSettings ? (
          <YStack gap="$2" testID="notifications-denied">
            <Paragraph theme="alt2">{t('denied')}</Paragraph>
            <Button theme="green" onPress={openSettings}>
              {t('openSettings')}
            </Button>
          </YStack>
        ) : (
          <Paragraph theme="alt2" testID="notifications-denied-web">
            {t('deniedWeb')}
          </Paragraph>
        )
      ) : (
        <Button theme="green" onPress={() => void request()}>
          {t('enable')}
        </Button>
      )}

      <YStack gap="$2">
        <H4>{t('categories')}</H4>
        {CATEGORIES.map((key) => (
          <LabeledSwitch
            key={key}
            label={t(`category.${key}`)}
            checked={prefs.categories[key]}
            onCheckedChange={() => toggleCategory(key)}
          />
        ))}
      </YStack>

      <YStack gap="$1">
        <H4>{t('reminders')}</H4>
        {reminders.length === 0 ? (
          <Paragraph theme="alt2">{t('noReminders')}</Paragraph>
        ) : (
          reminders.map((r) => <Paragraph key={r.id}>{r.title}</Paragraph>)
        )}
      </YStack>
    </Screen>
  );
}
