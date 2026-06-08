import React from 'react';
import { useColorScheme } from 'react-native';
import { Tabs } from 'expo-router';
import { TamaguiProvider, Theme } from 'tamagui';
import {
  Bluetooth,
  BluetoothConnected,
  Car,
  Activity,
  AlertTriangle,
  Info,
  Settings2,
} from 'lucide-react-native';
import config from '../../tamagui.config';
import { useSettingsStore } from '@/shared/state/settingsStore';

const ACCENT   = '#2bb673';
const INACTIVE = '#8B949E';

const NAV = {
  dark:  { bg: '#0D1117', border: '#30363D', tint: '#E6EDF3' },
  light: { bg: '#FFFFFF', border: '#E2E8F0', tint: '#1A1A1A' },
};

export default function RootLayout() {
  const system = useColorScheme();
  const pref = useSettingsStore((s) => s.theme);
  const theme = pref === 'system' ? (system ?? 'dark') : pref;
  const nav = NAV[theme] ?? NAV.dark;

  return (
    <TamaguiProvider config={config} defaultTheme={theme}>
      <Theme name={theme}>
        <Tabs
          screenOptions={{
            headerShown: true,
            headerStyle: { backgroundColor: nav.bg },
            headerTintColor: nav.tint,
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
          {/* Reachable from the Info screen; hidden from the tab bar. */}
          <Tabs.Screen name="extended" options={{ href: null, title: 'Extended PIDs' }} />
        </Tabs>
      </Theme>
    </TamaguiProvider>
  );
}
