import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, StyleSheet, Text } from 'react-native';
import { useTranslation } from '@/shared/i18n';
import { AppLogo } from './AppLogo';
import { useReducedMotion } from './useReducedMotion';
import palette from './palette.json';
import { useSettingsStore } from '@/shared/state/settingsStore';
import { useHistoryStore } from '@/shared/state/historyStore';
import { useGarageStore } from '@/shared/state/garageStore';
import { useVehicleStore } from '@/features/vehicle-select/model/vehicleStore';
import { useMaintenanceStore } from '@/features/maintenance/model/maintenanceStore';

/** Brand green screen with the title and subtitle in ink: 7.3:1 (white on the green was 2.6:1,
 *  plan 20). Both stay fully opaque — ink faded to half over the green drops to about 2.4:1. */
const BRAND = palette.brand.green;
const INK = palette.brand.ink;
/** Keep the splash up at least this long so the animation is actually seen, never a one-frame flash. */
const MIN_VISIBLE_MS = 1100;
const FADE_MS = 380;
/** The fade under Reduce motion: still a fade (not a jump cut), just short. */
const REDUCED_FADE_MS = 150;

/** The persisted (file-backed) zustand stores whose hydration means "the app's saved data is ready".
 *  Typed structurally so the heterogeneous store hooks line up without fighting their generics. */
interface Hydratable {
  persist: { hasHydrated: () => boolean; onFinishHydration: (fn: () => void) => () => void };
}
const PERSISTED = [
  useSettingsStore,
  useHistoryStore,
  useVehicleStore,
  useGarageStore,
  useMaintenanceStore,
] as unknown as Hydratable[];

/** True once every persisted store has finished rehydrating from disk. Resolves immediately on
 *  platforms without storage (e.g. web), where hydration completes synchronously. */
function useStoresHydrated(): boolean {
  const [hydrated, setHydrated] = useState(() => PERSISTED.every((s) => s.persist.hasHydrated()));
  useEffect(() => {
    if (hydrated) return;
    const check = () => {
      if (PERSISTED.every((s) => s.persist.hasHydrated())) setHydrated(true);
    };
    const unsubs = PERSISTED.map((s) => s.persist.onFinishHydration(check));
    check(); // in case a store hydrated between the initial state and subscribing
    return () => {
      for (const u of unsubs) u?.();
    };
  }, [hydrated]);
  return hydrated;
}

/** Animated branded launch screen. Overlays the whole app at startup and fades out once the persisted
 *  stores have hydrated AND a minimum display time has elapsed. Pure presentation plus a hydration
 *  gate — no navigation deps — so the root layout renders it as a sibling above the navigator. Uses
 *  React Native's built-in Animated (no extra native dependency). `ready` is an extra gate from the
 *  root layout: the UI language has been applied (plan 11), so the app never flashes English. */
export function AppSplash({ ready: languageReady = true }: { ready?: boolean } = {}) {
  const { t } = useTranslation();
  const hydrated = useStoresHydrated();
  const [minElapsed, setMinElapsed] = useState(false);
  const [gone, setGone] = useState(false);

  const fade = useRef(new Animated.Value(1)).current; // whole-overlay opacity
  const pulse = useRef(new Animated.Value(0)).current; // logo pulse, 0..1
  const reduceMotion = useReducedMotion();

  // Gentle, looping logo pulse while we wait — none under Reduce motion (plan 20).
  useEffect(() => {
    if (reduceMotion) {
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 750,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 750,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduceMotion]);

  // Minimum on-screen time.
  useEffect(() => {
    const t = setTimeout(() => setMinElapsed(true), MIN_VISIBLE_MS);
    return () => clearTimeout(t);
  }, []);

  // Fade out once everything is ready, then unmount.
  const ready = hydrated && minElapsed && languageReady;
  useEffect(() => {
    if (!ready) return;
    const anim = Animated.timing(fade, {
      toValue: 0,
      duration: reduceMotion ? REDUCED_FADE_MS : FADE_MS,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    });
    anim.start(({ finished }) => {
      if (finished) setGone(true);
    });
    return () => anim.stop();
  }, [ready, fade, reduceMotion]);

  if (gone) return null;

  const scale = reduceMotion
    ? 1
    : pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] });

  return (
    <Animated.View
      pointerEvents={ready ? 'none' : 'auto'}
      style={[StyleSheet.absoluteFill, styles.root, { opacity: fade }]}
      testID="app-splash"
      accessibilityElementsHidden={ready}
      importantForAccessibility={ready ? 'no-hide-descendants' : 'auto'}
    >
      <Animated.View style={[styles.badge, { transform: [{ scale }] }]}>
        <AppLogo size={96} />
      </Animated.View>

      <Text style={styles.title} maxFontSizeMultiplier={1.3} accessibilityRole="header">
        Bolid Tester
      </Text>
      {/* No words until the UI language is applied: i18next starts in English and the stored /
          device language lands a moment later, so a Romanian phone would otherwise read English
          first (plan 11). A non-breaking space keeps the line's height, so nothing shifts. */}
      <Text style={styles.subtitle} maxFontSizeMultiplier={1.3} testID="app-splash-subtitle">
        {languageReady ? t('splash.subtitle') : '\u00A0'}
      </Text>

      <ActivityIndicator
        color={INK}
        style={styles.spinner}
        accessibilityLabel={languageReady ? t('splash.loading') : undefined}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: BRAND,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    backgroundColor: INK,
    padding: 22,
    borderRadius: 28,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  title: {
    color: INK,
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: 0.5,
    marginTop: 22,
  },
  subtitle: {
    color: INK,
    fontSize: 14,
    fontWeight: '600',
    marginTop: 6,
  },
  spinner: {
    marginTop: 28,
  },
});
