import React from 'react';
import { useColorScheme } from 'react-native';
import { Tabs } from 'expo-router';
import { TamaguiProvider, Theme } from 'tamagui';
import config from '../../tamagui.config';
import { useSettingsStore } from '@/shared/state/settingsStore';

export default function RootLayout() {
  const system = useColorScheme();
  const pref = useSettingsStore((s) => s.theme);
  const theme = pref === 'system' ? (system ?? 'dark') : pref;

  return (
    <TamaguiProvider config={config} defaultTheme={theme}>
      <Theme name={theme}>
        <Tabs screenOptions={{ headerShown: true }}>
          <Tabs.Screen name="index" options={{ title: 'Connect' }} />
          <Tabs.Screen name="vehicle" options={{ title: 'Vehicle' }} />
          <Tabs.Screen name="dashboard" options={{ title: 'Live' }} />
          <Tabs.Screen name="faults" options={{ title: 'Faults' }} />
          <Tabs.Screen name="info" options={{ title: 'Info' }} />
          <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
          {/* Reachable from the Info screen; hidden from the tab bar. */}
          <Tabs.Screen name="extended" options={{ href: null, title: 'Extended PIDs' }} />
        </Tabs>
      </Theme>
    </TamaguiProvider>
  );
}
