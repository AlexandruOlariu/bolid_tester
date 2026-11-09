import React, { useMemo, useState } from 'react';
import { Alert } from 'react-native';
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
} from 'lucide-react-native';
import { CardGrid, Screen } from '@/shared/ui';
import { checkForUpdate, fetchAndReload } from '../api/updates';
import {
  MORE_SECTIONS,
  entryKey,
  filterSections,
  type IconName,
  type MoreEntry,
} from '../model/sections';

const ACCENT = '#2bb673';

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
  'download-cloud': DownloadCloud,
};

function SectionHeader({ title, workshop }: { title: string; workshop: boolean }) {
  return (
    <Text
      fontWeight="800"
      fontSize="$2"
      color={ACCENT}
      letterSpacing={0.8}
      textTransform="uppercase"
      accessibilityRole="header"
    >
      {workshop ? `${title} 🧪` : title}
    </Text>
  );
}

function ExperimentalChip() {
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
      experimental
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
  const Icon = ICONS[entry.icon];
  const subtitle = busy ? 'Checking…' : entry.subtitle;
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
      accessibilityLabel={`${entry.title}. ${entry.subtitle}${entry.experimental ? '. Experimental' : ''}`}
      onPress={onPress}
    >
      {busy ? <Spinner /> : <Icon size={22} color={ACCENT} />}
      <YStack flex={1} gap="$1">
        <XStack alignItems="center" gap="$2" flexWrap="wrap">
          <H4>{entry.title}</H4>
          {entry.experimental ? <ExperimentalChip /> : null}
        </XStack>
        <Paragraph theme="alt2" size="$2">
          {subtitle}
        </Paragraph>
      </YStack>
      <Paragraph theme="alt2">›</Paragraph>
    </XStack>
  );
}

export function MoreScreen() {
  const router = useRouter();
  const [checking, setChecking] = useState(false);
  const [query, setQuery] = useState('');
  const sections = useMemo(() => filterSections(MORE_SECTIONS, query), [query]);

  const onCheckUpdates = async () => {
    setChecking(true);
    try {
      const result = await checkForUpdate();
      if (result === 'available') {
        Alert.alert('Update available', 'Download and restart now?', [
          { text: 'Later', style: 'cancel' },
          { text: 'Update', onPress: () => fetchAndReload() },
        ]);
      } else if (result === 'up-to-date') {
        Alert.alert('Up to date', 'You already have the latest version.');
      } else {
        Alert.alert('Updates unavailable', 'Over-the-air updates are not enabled in this build.');
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
    <Screen title="More" subtitle="Diagnostics, ownership & workshop tools">
      <Input
        value={query}
        onChangeText={setQuery}
        placeholder="Search tools…"
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="while-editing"
        accessibilityLabel="Search tools"
      />
      {sections.length === 0 ? (
        <Paragraph theme="alt2">No tools match “{query.trim()}”.</Paragraph>
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
