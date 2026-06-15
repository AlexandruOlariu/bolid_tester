import React from 'react';
import { YStack, XStack, Paragraph, H4 } from 'tamagui';
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
} from 'lucide-react-native';
import { Screen } from '@/shared/ui';

interface Entry {
  route: string;
  title: string;
  subtitle: string;
  Icon: typeof LineChart;
}

const ENTRIES: Entry[] = [
  { route: '/charts', title: 'Charts', subtitle: 'Live parameters over time', Icon: LineChart },
  { route: '/performance', title: 'Performance', subtitle: '0–100, ¼-mile, braking', Icon: Timer },
  { route: '/trips', title: 'Trips', subtitle: 'Record & export live data', Icon: RouteIcon },
  { route: '/alerts', title: 'Alerts', subtitle: 'Threshold warnings', Icon: Bell },
  { route: '/sensors', title: 'Sensor tests', subtitle: 'Mode 06 + module sensors', Icon: GaugeIcon },
  { route: '/service-reset', title: 'Service reset', subtitle: 'Reset the service interval', Icon: Wrench },
  { route: '/coding', title: 'Coding', subtitle: 'Experimental module coding', Icon: KeyRound },
  { route: '/notifications', title: 'Notifications', subtitle: 'Alerts & reminders', Icon: BellRing },
];

export function MoreScreen() {
  const router = useRouter();
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
      </YStack>
    </Screen>
  );
}
