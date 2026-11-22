import React from 'react';
import { Platform, useColorScheme, View } from 'react-native';
import { Tabs } from 'expo-router';
import { useTranslation } from '@/shared/i18n';
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
import palette from '@/shared/ui/palette.json';
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
import { useLanguageSync } from '@/shared/i18n/useLanguageSync';
import { EngineHost } from '@/features/engine-host';
import { SimulatorBanner } from '@/features/connection';

// Capture uncaught errors & unhandled rejections into the in-app error log, once, at app start.
installGlobalErrorHandlers();
// Tell the settings store its platform, so a stored source this platform cannot use (Classic
// Bluetooth off Android, plan 27; Wi-Fi in the browser, plan 28) falls back to Bluetooth LE —
// before or after the settings file hydrates.
setSettingsPlatform(Platform.OS);

/** Header and tab-bar colours per scheme, from palette.json (plan 20): React Navigation sits
 *  outside the Tamagui theme, so it reads the palette directly. The tab tints are the theme's accent
 *  (active) and muted (inactive) tokens — both AA on the bar in light and dark. */
function navColours(scheme: 'light' | 'dark') {
  const t = palette.themes[scheme];
  return {
    bg: t.chrome.background,
    border: t.chrome.border,
    tint: t.chrome.text,
    active: t.text.accent,
    inactive: t.text.muted,
  };
}

export default function RootLayout() {
  const system = useColorScheme();
  const pref = useSettingsStore((s) => s.theme);
  const scheme: 'light' | 'dark' =
    pref === 'system' ? (system === 'light' ? 'light' : 'dark') : pref;
  const nav = navColours(scheme);
  // Plan 21: on a tablet (expanded, or medium + landscape) tall enough for all seven rail items the
  // tab bar becomes a left side rail ('material' variant, labels under the icons); the header stays on
  // top. A phone on its side is too short for the non-scrolling rail and keeps the bottom bar.
  const rail = usesSideRail(useLayoutClass());
  // Plan 11: the UI language follows Settings → Language (default: the device). The splash stays up
  // until the stored choice is applied, so a Romanian phone never shows an English frame; `t`
  // re-renders the tab and header titles when the language changes.
  const languageReady = useLanguageSync();
  const { t } = useTranslation();

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
                    <Text
                      color={nav.tint}
                      fontWeight="800"
                      fontSize={17}
                      numberOfLines={1}
                      maxFontSizeMultiplier={1.5}
                      accessibilityRole="header"
                    >
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
                tabBarActiveTintColor: nav.active,
                tabBarInactiveTintColor: nav.inactive,
                tabBarShowLabel: true,
                // Labels under the icons on the rail; the phone bar keeps the platform default.
                ...(rail ? { tabBarLabelPosition: 'below-icon' as const } : null),
                // Labels follow the OS font size (plan 20), capped at 1.5× so the bar keeps its height.
                // React Navigation's own label takes no `maxFontSizeMultiplier`, so the label is
                // rendered here. A function label replaces the navigator's styled one entirely
                // (`tabBarLabelStyle` / `tabBarAllowFontScaling` no longer apply), so this one also
                // carries its layout: the spacing from the icon when it sits beside it (iPad, a
                // landscape phone) — React Navigation's `labelBeside*` margins — and none beneath.
                tabBarLabel: ({ children, color, position }) => (
                  <Text
                    color={color}
                    fontSize={11}
                    fontWeight="600"
                    numberOfLines={1}
                    maxFontSizeMultiplier={1.5}
                    {...(position === 'beside-icon'
                      ? { marginStart: rail ? 12 : 5, marginEnd: 12, lineHeight: 24 }
                      : null)}
                  >
                    {children}
                  </Text>
                ),
              }}
            >
              <Tabs.Screen
                name="index"
                options={{
                  title: t('nav.connect'),
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
                  title: t('nav.vehicle'),
                  tabBarIcon: ({ color, size }) => <Car size={size} color={color} />,
                }}
              />
              <Tabs.Screen
                name="dashboard"
                options={{
                  title: t('nav.live'),
                  tabBarIcon: ({ color, size }) => <Activity size={size} color={color} />,
                }}
              />
              <Tabs.Screen
                name="faults"
                options={{
                  title: t('nav.faults'),
                  tabBarIcon: ({ color, size }) => <AlertTriangle size={size} color={color} />,
                }}
              />
              <Tabs.Screen
                name="info"
                options={{
                  title: t('nav.info'),
                  tabBarIcon: ({ color, size }) => <Info size={size} color={color} />,
                }}
              />
              <Tabs.Screen
                name="settings"
                options={{
                  title: t('nav.settings'),
                  tabBarIcon: ({ color, size }) => <Settings2 size={size} color={color} />,
                }}
              />
              <Tabs.Screen
                name="more"
                options={{
                  title: t('nav.more'),
                  tabBarIcon: ({ color, size }) => <LayoutGrid size={size} color={color} />,
                }}
              />
              {/* Reachable from the Info / More screens; hidden from the tab bar. */}
              <Tabs.Screen name="extended" options={{ href: null, title: t('nav.extended') }} />
              <Tabs.Screen
                name="ai-diagnose"
                options={{ href: null, title: t('nav.aiDiagnose') }}
              />
              <Tabs.Screen name="history" options={{ href: null, title: t('nav.history') }} />
              <Tabs.Screen name="report" options={{ href: null, title: t('nav.report') }} />
              <Tabs.Screen name="charts" options={{ href: null, title: t('nav.charts') }} />
              <Tabs.Screen
                name="performance"
                options={{ href: null, title: t('nav.performance') }}
              />
              <Tabs.Screen name="trips" options={{ href: null, title: t('nav.trips') }} />
              <Tabs.Screen
                name="trip-detail"
                options={{ href: null, title: t('nav.tripDetail') }}
              />
              <Tabs.Screen name="alerts" options={{ href: null, title: t('nav.alerts') }} />
              <Tabs.Screen name="sensors" options={{ href: null, title: t('nav.sensors') }} />
              <Tabs.Screen name="coding" options={{ href: null, title: t('nav.coding') }} />
              <Tabs.Screen
                name="notifications"
                options={{ href: null, title: t('nav.notifications') }}
              />
              <Tabs.Screen
                name="service-reset"
                options={{ href: null, title: t('nav.serviceReset') }}
              />
              <Tabs.Screen name="dpf" options={{ href: null, title: t('nav.dpf') }} />
              <Tabs.Screen name="inspection" options={{ href: null, title: t('nav.inspection') }} />
              <Tabs.Screen name="battery" options={{ href: null, title: t('nav.battery') }} />
              <Tabs.Screen name="vin-decode" options={{ href: null, title: t('nav.vinDecode') }} />
              <Tabs.Screen
                name="maintenance"
                options={{ href: null, title: t('nav.maintenance') }}
              />
              <Tabs.Screen name="error-log" options={{ href: null, title: t('nav.errorLog') }} />
              <Tabs.Screen name="feedback" options={{ href: null, title: t('nav.feedback') }} />
              <Tabs.Screen name="licenses" options={{ href: null, title: t('nav.licenses') }} />
              <Tabs.Screen name="backup" options={{ href: null, title: t('nav.backup') }} />
              <Tabs.Screen
                name="module-scan"
                options={{ href: null, title: t('nav.moduleScan') }}
              />
              <Tabs.Screen
                name="adaptations"
                options={{ href: null, title: t('nav.adaptations') }}
              />
              <Tabs.Screen name="routines" options={{ href: null, title: t('nav.routines') }} />
              <Tabs.Screen name="sniffer" options={{ href: null, title: t('nav.sniffer') }} />
              <Tabs.Screen
                name="adapter-health"
                options={{ href: null, title: t('nav.adapterHealth') }}
              />
            </Tabs>
            {/* Short messages such as "Not available on web yet" (plan 28). */}
            <Toast />
            {/* The browser's Alert.alert (react-native-web's is a no-op); nothing on the phone. */}
            <AlertDialog />
            <AppSplash ready={languageReady} />
          </RootErrorBoundary>
        </View>
      </Theme>
    </TamaguiProvider>
  );
}
