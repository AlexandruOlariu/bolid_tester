import React, { useMemo, useState } from 'react';
import { YStack, XStack, Paragraph, H4, Spinner, Text, Input } from 'tamagui';
import { useRouter } from 'expo-router';
import {
  LineChart,
  Timer,
  Route as RouteIcon,
  Bell,
  BellRing,
  Gauge as GaugeIcon,
  Wrench,
  KeyRound,
  Stethoscope,
  History,
  Wind,
  ClipboardCheck,
  BatteryCharging,
  ScanLine,
  CalendarClock,
  Bug,
  Network,
  SlidersHorizontal,
  Zap,
  Radio,
  HeartPulse,
  DownloadCloud,
  FileStack,
  Archive,
  MessageSquareWarning,
} from 'lucide-react-native';
import { CardGrid, Screen, appAlert, usePalette } from '@/shared/ui';
import { checkForUpdate, fetchAndReload } from '../api/updates';
import {
  MORE_SECTIONS,
  entryKey,
  filterSections,
  localizeSections,
  type IconName,
  type MoreEntry,
} from '../model/sections';
import { useTranslation } from '@/shared/i18n';

/** The lucide icon for each `IconName` (kept here so the model stays icon-free and node-testable). */
const ICONS: Record<IconName, typeof LineChart> = {
  stethoscope: Stethoscope,
  'clipboard-check': ClipboardCheck,
  history: History,
  'file-stack': FileStack,
  gauge: GaugeIcon,
  'line-chart': LineChart,
  timer: Timer,
  route: RouteIcon,
  bell: Bell,
  'calendar-clock': CalendarClock,
  'battery-charging': BatteryCharging,
  wind: Wind,
  'scan-line': ScanLine,
  'bell-ring': BellRing,
  network: Network,
  sliders: SlidersHorizontal,
  zap: Zap,
  'key-round': KeyRound,
  wrench: Wrench,
  radio: Radio,
  'heart-pulse': HeartPulse,
  archive: Archive,
  bug: Bug,
  'message-square-warning': MessageSquareWarning,
  'download-cloud': DownloadCloud,
};

function SectionHeader({ title, workshop }: { title: string; workshop: boolean }) {
  return (
    <Text
      fontWeight="800"
      fontSize="$2"
      color="$accent"
      letterSpacing={0.8}
      textTransform="uppercase"
      accessibilityRole="header"
    >
      {workshop ? `${title} 🧪` : title}
    </Text>
  );
}

function ExperimentalChip() {
  const { t } = useTranslation('more');
  return (
    <Text
      fontSize="$1"
      fontWeight="700"
      color="$yellow11"
      backgroundColor="$yellow3"
      borderColor="$yellow7"
      borderWidth={1}
      borderRadius="$2"
      paddingHorizontal="$1.5"
      paddingVertical={1}
    >
      {t('experimental')}
    </Text>
  );
}

function EntryRow({
  entry,
  busy,
  onPress,
}: {
  entry: MoreEntry;
  busy: boolean;
  onPress: (() => void) | undefined;
}) {
  const { t } = useTranslation('more');
  const Icon = ICONS[entry.icon];
  const palette = usePalette();
  const subtitle = busy ? t('checking') : entry.subtitle;
  return (
    <XStack
      alignItems="center"
      gap="$3"
      padding="$3"
      backgroundColor="$color2"
      borderRadius="$4"
      pressStyle={{ backgroundColor: '$color4' }}
      accessible
      accessibilityRole="button"
      accessibilityLabel={`${entry.title}. ${entry.subtitle}${entry.experimental ? `. ${t('experimentalA11y')}` : ''}`}
      onPress={onPress}
    >
      {busy ? <Spinner /> : <Icon size={22} color={palette.accent} />}
      <YStack flex={1} gap="$1">
        <XStack alignItems="center" gap="$2" flexWrap="wrap">
          <H4>{entry.title}</H4>
          {entry.experimental ? <ExperimentalChip /> : null}
        </XStack>
        <Paragraph theme="alt2" size="$2">
          {subtitle}
        </Paragraph>
      </YStack>
      <Paragraph theme="alt2" accessibilityElementsHidden importantForAccessibility="no">
        ›
      </Paragraph>
    </XStack>
  );
}

export function MoreScreen() {
  const { t } = useTranslation('more');
  const router = useRouter();
  const [checking, setChecking] = useState(false);
  const [query, setQuery] = useState('');
  const localized = useMemo(
    () => localizeSections(MORE_SECTIONS, (key, english) => t(key, { defaultValue: english })),
    [t],
  );
  const sections = useMemo(() => filterSections(localized, query), [localized, query]);

  const onCheckUpdates = async () => {
    setChecking(true);
    try {
      const result = await checkForUpdate();
      if (result === 'available') {
        appAlert(t('updates.availableTitle'), t('updates.availableBody'), [
          { text: t('updates.later'), style: 'cancel' },
          { text: t('updates.update'), onPress: () => fetchAndReload() },
        ]);
      } else if (result === 'up-to-date') {
        appAlert(t('updates.upToDateTitle'), t('updates.upToDateBody'));
      } else {
        appAlert(t('updates.unavailableTitle'), t('updates.unavailableBody'));
      }
    } finally {
      setChecking(false);
    }
  };

  const pressFor = (entry: MoreEntry): (() => void) | undefined => {
    if (entry.action === 'check-updates') return checking ? undefined : onCheckUpdates;
    const route = entry.route;
    return route ? () => router.push(route) : undefined;
  };

  return (
    <Screen title={t('title')} subtitle={t('subtitle')}>
      <Input
        value={query}
        onChangeText={setQuery}
        placeholder={t('searchPlaceholder')}
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="while-editing"
        accessibilityLabel={t('searchA11y')}
      />
      {sections.length === 0 ? (
        <Paragraph theme="alt2">{t('noMatch', { query: query.trim() })}</Paragraph>
      ) : null}
      {sections.map((section) => (
        <YStack key={section.id} gap="$2" testID={`more-section-${section.id}`}>
          <SectionHeader title={section.title} workshop={section.id === 'workshop'} />
          {section.blurb ? (
            <Paragraph theme="alt2" fontSize="$2">
              {section.blurb}
            </Paragraph>
          ) : null}
          {/* Two columns on a tablet / landscape phone (plan 21). */}
          <CardGrid testID={`more-grid-${section.id}`}>
            {section.entries.map((entry) => (
              <EntryRow
                key={entryKey(entry)}
                entry={entry}
                busy={entry.action === 'check-updates' && checking}
                onPress={pressFor(entry)}
              />
            ))}
          </CardGrid>
        </YStack>
      ))}
    </Screen>
  );
}
