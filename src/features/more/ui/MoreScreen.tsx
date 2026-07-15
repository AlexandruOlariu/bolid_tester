import React, { useState } from 'react';
import { Alert } from 'react-native';
import { YStack, XStack, Paragraph, H4, Spinner } from 'tamagui';
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
} from 'lucide-react-native';
import { Screen } from '@/shared/ui';
import { checkForUpdate, fetchAndReload } from '../api/updates';

interface Entry {
  route: string;
  title: string;
  subtitle: string;
  Icon: typeof LineChart;
}

const ENTRIES: Entry[] = [
  { route: '/ai-diagnose', title: 'Diagnose (AI)', subtitle: 'One-tap AI health check', Icon: Stethoscope },
  { route: '/history', title: 'History', subtitle: 'Past diagnoses & fault-code checks', Icon: History },
  { route: '/inspection', title: 'Used-car inspection', subtitle: 'Pre-purchase health check', Icon: ClipboardCheck },
  { route: '/dpf', title: 'DPF / regen', subtitle: 'Diesel soot & regeneration', Icon: Wind },
  { route: '/battery', title: 'Battery & charging', subtitle: 'Voltage, cranking, alternator', Icon: BatteryCharging },
  { route: '/adapter-health', title: 'Adapter health', subtitle: 'Grade your ELM327: firmware, latency', Icon: HeartPulse },
  { route: '/vin-decode', title: 'VIN decoder', subtitle: 'Decode the VIN offline', Icon: ScanLine },
  { route: '/maintenance', title: 'Maintenance log', subtitle: 'Service history & due items', Icon: CalendarClock },
  { route: '/charts', title: 'Charts', subtitle: 'Live parameters over time', Icon: LineChart },
  { route: '/performance', title: 'Performance', subtitle: '0–100, ¼-mile, braking', Icon: Timer },
  { route: '/trips', title: 'Trips', subtitle: 'Record & export live data', Icon: RouteIcon },
  { route: '/alerts', title: 'Alerts', subtitle: 'Threshold warnings', Icon: Bell },
  { route: '/sensor-readings', title: 'Sensor readings', subtitle: 'Live sensors, grouped', Icon: GaugeIcon },
  { route: '/sensors', title: 'Sensor tests', subtitle: 'Mode 06 + module sensors', Icon: GaugeIcon },
  { route: '/module-scan', title: 'Module scan', subtitle: 'VCDS-style auto-scan: all modules', Icon: Network },
  { route: '/service-reset', title: 'Service reset', subtitle: 'Reset the service interval', Icon: Wrench },
  { route: '/coding', title: 'Coding', subtitle: 'Experimental module coding', Icon: KeyRound },
  { route: '/adaptations', title: 'Adaptations', subtitle: 'Channel read/write with backup', Icon: SlidersHorizontal },
  { route: '/routines', title: 'Routines & output tests', subtitle: 'Basic settings, actuator tests, DPF regen', Icon: Zap },
  { route: '/notifications', title: 'Notifications', subtitle: 'Alerts & reminders', Icon: BellRing },
  { route: '/sniffer', title: 'Bus sniffer', subtitle: 'Raw CAN/K-line monitor (ATMA)', Icon: Radio },
  { route: '/error-log', title: 'Error log', subtitle: 'Saved errors to export & fix later', Icon: Bug },
];

export function MoreScreen() {
  const router = useRouter();
  const [checking, setChecking] = useState(false);

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

  return (
    <Screen title="More" subtitle="Diagnostics, performance & tools">
      <YStack gap="$2">
        {ENTRIES.map(({ route, title, subtitle, Icon }) => (
          <XStack
            key={route}
            alignItems="center"
            gap="$3"
            padding="$3"
            backgroundColor="$color2"
            borderRadius="$4"
            pressStyle={{ backgroundColor: '$color4' }}
            accessibilityRole="button"
            accessibilityLabel={`${title}. ${subtitle}`}
            onPress={() => router.push(route)}
          >
            <Icon size={22} color="#2bb673" />
            <YStack flex={1}>
              <H4>{title}</H4>
              <Paragraph theme="alt2" size="$2">
                {subtitle}
              </Paragraph>
            </YStack>
            <Paragraph theme="alt2">›</Paragraph>
          </XStack>
        ))}

        <XStack
          alignItems="center"
          gap="$3"
          padding="$3"
          backgroundColor="$color2"
          borderRadius="$4"
          pressStyle={{ backgroundColor: '$color4' }}
          accessibilityRole="button"
          accessibilityLabel="Check for updates. Over-the-air app updates"
          onPress={checking ? undefined : onCheckUpdates}
        >
          {checking ? <Spinner /> : <DownloadCloud size={22} color="#2bb673" />}
          <YStack flex={1}>
            <H4>Check for updates</H4>
            <Paragraph theme="alt2" size="$2">
              {checking ? 'Checking…' : 'Over-the-air app updates'}
            </Paragraph>
          </YStack>
          <Paragraph theme="alt2">›</Paragraph>
        </XStack>
      </YStack>
    </Screen>
  );
}
