import React from 'react';
import { Platform, useColorScheme, View } from 'react-native';
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
import { setSettingsPlatform, useSettingsStore } from '@/shared/state/settingsStore';
import { installGlobalErrorHandlers } from '@/shared/state/errorLogStore';
import { CrashReportingHost } from '@/shared/telemetry/useCrashReporting';
import {
  AlertDialog,
  AppLogo,
  RootErrorBoundary,
  Toast,
  useLayoutClass,
  usesSideRail,
} from '@/shared/ui';
import { AppSplash } from '@/shared/ui/AppSplash';
import { EngineHost } from '@/features/engine-host';
import { SimulatorBanner } from '@/features/connection';

// Capture uncaught errors & unhandled rejections into the in-app error log, once, at app start.
installGlobalErrorHandlers();
// Tell the settings store its platform, so a stored source this platform cannot use (Classic
// Bluetooth off Android, plan 27; Wi-Fi in the browser, plan 28) falls back to Bluetooth LE —
// before or after the settings file hydrates.
setSettingsPlatform(Platform.OS);

const ACCENT = '#2bb673';
const INACTIVE = '#8B949E';

const NAV = {
  dark: { bg: '#0D1117', border: '#30363D', tint: '#E6EDF3' },
  light: { bg: '#FFFFFF', border: '#E2E8F0', tint: '#1A1A1A' },
};

export default function RootLayout() {
  const system = useColorScheme();
  const pref = useSettingsStore((s) => s.theme);
  const scheme: 'light' | 'dark' =
    pref === 'system' ? (system === 'light' ? 'light' : 'dark') : pref;
  const nav = NAV[scheme];
  // Plan 21: on a tablet (expanded, or medium + landscape) tall enough for all seven rail items the
  // tab bar becomes a left side rail ('material' variant, labels under the icons); the header stays on
  // top. A phone on its side is too short for the non-scrolling rail and keeps the bottom bar.
  const rail = usesSideRail(useLayoutClass());

  return (
    <TamaguiProvider config={config} defaultTheme={scheme}>
      <Theme name={scheme}>
        <View style={{ flex: 1 }}>
          {/* Opt-in crash reports (plan 31): off by default, a no-op without a DSN; follows Settings →
              Privacy and adds the screen / connection-status breadcrumbs. Headless, and a separate
              component so its per-navigation re-render (usePathname) stays out of this layout. */}
          <CrashReportingHost />
          {/* Root render-error boundary (F9): themed fallback + Retry so one bad screen can't crash the
            app. Inside the Theme so the fallback is themed; wraps the navigator (and EngineHost). */}
          <RootErrorBoundary>
            {/* Headless: owns the poll loop, alerts, notifications and trip sampling app-wide. */}
            <EngineHost />
            {/* `screenLayout` wraps every route (hidden ones included) below its header, so the amber
                "Simulator mode" strip shows on every screen without clashing with the status bar.
                It lives here, not inside `Screen`, so no route can miss it. */}
            <Tabs
              screenLayout={({ children }) => (
                <View style={{ flex: 1 }}>
                  <SimulatorBanner />
                  {children}
                </View>
              )}
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
                tabBarPosition: rail ? 'left' : 'bottom',
                tabBarVariant: rail ? 'material' : 'uikit',
                tabBarStyle: rail
                  ? {
                      backgroundColor: nav.bg,
                      borderRightColor: nav.border,
                      borderRightWidth: 1,
                    }
                  : {
                      backgroundColor: nav.bg,
                      borderTopColor: nav.border,
                      borderTopWidth: 1,
                    },
                tabBarActiveTintColor: ACCENT,
                tabBarInactiveTintColor: INACTIVE,
                tabBarShowLabel: true,
                // Labels under the icons on the rail; the phone bar keeps the platform default.
                ...(rail ? { tabBarLabelPosition: 'below-icon' as const } : null),
                tabBarLabelStyle: { fontSize: 10, fontWeight: '600' },
              }}
            >
              <Tabs.Screen
                name="index"
                options={{
                  title: 'Connect',
                  tabBarIcon: ({ color, size, focused }) =>
                    focused ? (
                      <BluetoothConnected size={size} color={color} />
                    ) : (
                      <Bluetooth size={size} color={color} />
                    ),
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
              <Tabs.Screen name="report" options={{ href: null, title: 'Vehicle report' }} />
              <Tabs.Screen name="charts" options={{ href: null, title: 'Charts' }} />
              <Tabs.Screen name="performance" options={{ href: null, title: 'Performance' }} />
              <Tabs.Screen name="trips" options={{ href: null, title: 'Trips' }} />
              <Tabs.Screen name="trip-detail" options={{ href: null, title: 'Trip' }} />
              <Tabs.Screen name="alerts" options={{ href: null, title: 'Alerts' }} />
              <Tabs.Screen name="sensors" options={{ href: null, title: 'Sensor tests' }} />
              <Tabs.Screen name="coding" options={{ href: null, title: 'Coding' }} />
              <Tabs.Screen name="notifications" options={{ href: null, title: 'Notifications' }} />
              <Tabs.Screen name="service-reset" options={{ href: null, title: 'Service reset' }} />
              <Tabs.Screen name="dpf" options={{ href: null, title: 'DPF / regen' }} />
              <Tabs.Screen
                name="inspection"
                options={{ href: null, title: 'Used-car inspection' }}
              />
              <Tabs.Screen name="battery" options={{ href: null, title: 'Battery & charging' }} />
              <Tabs.Screen name="vin-decode" options={{ href: null, title: 'VIN decoder' }} />
              <Tabs.Screen name="maintenance" options={{ href: null, title: 'Maintenance log' }} />
              <Tabs.Screen name="error-log" options={{ href: null, title: 'Error log' }} />
              <Tabs.Screen name="feedback" options={{ href: null, title: 'Report a problem' }} />
              <Tabs.Screen name="backup" options={{ href: null, title: 'Backup & restore' }} />
              <Tabs.Screen name="module-scan" options={{ href: null, title: 'Module scan' }} />
              <Tabs.Screen name="adaptations" options={{ href: null, title: 'Adaptations' }} />
              <Tabs.Screen
                name="routines"
                options={{ href: null, title: 'Routines & output tests' }}
              />
              <Tabs.Screen name="sniffer" options={{ href: null, title: 'Bus sniffer' }} />
              <Tabs.Screen
                name="adapter-health"
                options={{ href: null, title: 'Adapter health' }}
              />
            </Tabs>
            {/* Short messages such as "Not available on web yet" (plan 28). */}
            <Toast />
            {/* The browser's Alert.alert (react-native-web's is a no-op); nothing on the phone. */}
            <AlertDialog />
            <AppSplash />
          </RootErrorBoundary>
        </View>
      </Theme>
    </TamaguiProvider>
  );
}
