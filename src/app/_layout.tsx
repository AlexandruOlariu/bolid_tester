import React from 'react';
import { useColorScheme } from 'react-native';
import { Tabs } from 'expo-router';
import { TamaguiProvider, Theme, XStack, Text } from 'tamagui';
import {
  Bluetooth,
  BluetoothConnected,
  Car,
  Activity,
  AlertTriangle,
  Info,
  Settings2,
  LayoutGrid,
} from 'lucide-react-native';
import config from '../../tamagui.config';
import { useSettingsStore } from '@/shared/state/settingsStore';
import { installGlobalErrorHandlers } from '@/shared/state/errorLogStore';
import { AppLogo } from '@/shared/ui';

// Capture uncaught errors & unhandled rejections into the in-app error log, once, at app start.
installGlobalErrorHandlers();

const ACCENT   = '#2bb673';
const INACTIVE = '#8B949E';

const NAV = {
  dark:  { bg: '#0D1117', border: '#30363D', tint: '#E6EDF3' },
  light: { bg: '#FFFFFF', border: '#E2E8F0', tint: '#1A1A1A' },
};

export default function RootLayout() {
  const system = useColorScheme();
  const pref = useSettingsStore((s) => s.theme);
  const scheme: 'light' | 'dark' = pref === 'system' ? (system === 'light' ? 'light' : 'dark') : pref;
  const nav = NAV[scheme];

  return (
    <TamaguiProvider config={config} defaultTheme={scheme}>
      <Theme name={scheme}>
        <Tabs
          screenOptions={{
            headerShown: true,
            headerStyle: { backgroundColor: nav.bg },
            headerTintColor: nav.tint,
            headerTitle: ({ children }) => (
              <XStack alignItems="center" gap="$2" maxWidth={240}>
                <AppLogo size={28} />
                <Text color={nav.tint} fontWeight="800" fontSize={17} numberOfLines={1}>
                  {children}
                </Text>
              </XStack>
            ),
            headerTitleStyle: { fontWeight: '700' },
            headerShadowVisible: false,
            tabBarStyle: {
              backgroundColor: nav.bg,
              borderTopColor: nav.border,
              borderTopWidth: 1,
            },
            tabBarActiveTintColor: ACCENT,
            tabBarInactiveTintColor: INACTIVE,
            tabBarShowLabel: true,
            tabBarLabelStyle: { fontSize: 10, fontWeight: '600' },
          }}
        >
          <Tabs.Screen
            name="index"
            options={{
              title: 'Connect',
              tabBarIcon: ({ color, size, focused }) =>
                focused
                  ? <BluetoothConnected size={size} color={color} />
                  : <Bluetooth size={size} color={color} />,
            }}
          />
          <Tabs.Screen
            name="vehicle"
            options={{
              title: 'Vehicle',
              tabBarIcon: ({ color, size }) => <Car size={size} color={color} />,
            }}
          />
          <Tabs.Screen
            name="dashboard"
            options={{
              title: 'Live',
              tabBarIcon: ({ color, size }) => <Activity size={size} color={color} />,
            }}
          />
          <Tabs.Screen
            name="faults"
            options={{
              title: 'Faults',
              tabBarIcon: ({ color, size }) => <AlertTriangle size={size} color={color} />,
            }}
          />
          <Tabs.Screen
            name="info"
            options={{
              title: 'Info',
              tabBarIcon: ({ color, size }) => <Info size={size} color={color} />,
            }}
          />
          <Tabs.Screen
            name="settings"
            options={{
              title: 'Settings',
              tabBarIcon: ({ color, size }) => <Settings2 size={size} color={color} />,
            }}
          />
          <Tabs.Screen
            name="more"
            options={{
              title: 'More',
              tabBarIcon: ({ color, size }) => <LayoutGrid size={size} color={color} />,
            }}
          />
          {/* Reachable from the Info / More screens; hidden from the tab bar. */}
          <Tabs.Screen name="extended" options={{ href: null, title: 'Extended PIDs' }} />
          <Tabs.Screen name="ai-diagnose" options={{ href: null, title: 'Diagnose (AI)' }} />
          <Tabs.Screen name="history" options={{ href: null, title: 'History' }} />
          <Tabs.Screen name="charts" options={{ href: null, title: 'Charts' }} />
          <Tabs.Screen name="performance" options={{ href: null, title: 'Performance' }} />
          <Tabs.Screen name="trips" options={{ href: null, title: 'Trips' }} />
          <Tabs.Screen name="alerts" options={{ href: null, title: 'Alerts' }} />
          <Tabs.Screen name="sensors" options={{ href: null, title: 'Sensor tests' }} />
          <Tabs.Screen name="coding" options={{ href: null, title: 'Coding' }} />
          <Tabs.Screen name="notifications" options={{ href: null, title: 'Notifications' }} />
          <Tabs.Screen name="service-reset" options={{ href: null, title: 'Service reset' }} />
          <Tabs.Screen name="dpf" options={{ href: null, title: 'DPF / regen' }} />
          <Tabs.Screen name="inspection" options={{ href: null, title: 'Used-car inspection' }} />
          <Tabs.Screen name="battery" options={{ href: null, title: 'Battery & charging' }} />
          <Tabs.Screen name="vin-decode" options={{ href: null, title: 'VIN decoder' }} />
          <Tabs.Screen name="maintenance" options={{ href: null, title: 'Maintenance log' }} />
          <Tabs.Screen name="error-log" options={{ href: null, title: 'Error log' }} />
        </Tabs>
      </Theme>
    </TamaguiProvider>
  );
}
