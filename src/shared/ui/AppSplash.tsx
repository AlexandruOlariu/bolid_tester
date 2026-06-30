import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { AppLogo } from './AppLogo';
import { useSettingsStore } from '@/shared/state/settingsStore';
import { useHistoryStore } from '@/shared/state/historyStore';
import { useVehicleStore } from '@/features/vehicle-select/model/vehicleStore';
import { useMaintenanceStore } from '@/features/maintenance/model/maintenanceStore';

const BRAND = '#2bb673';
const BADGE = '#0D1117';
/** Keep the splash up at least this long so the animation is actually seen, never a one-frame flash. */
const MIN_VISIBLE_MS = 1100;
const FADE_MS = 380;

/** The persisted (file-backed) zustand stores whose hydration means "the app's saved data is ready".
 *  Typed structurally so the heterogeneous store hooks line up without fighting their generics. */
interface Hydratable {
  persist: { hasHydrated: () => boolean; onFinishHydration: (fn: () => void) => () => void };
}
const PERSISTED = [
  useSettingsStore,
  useHistoryStore,
  useVehicleStore,
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
 *  React Native's built-in Animated (no extra native dependency). */
export function AppSplash() {
  const hydrated = useStoresHydrated();
  const [minElapsed, setMinElapsed] = useState(false);
  const [gone, setGone] = useState(false);

  const fade = useRef(new Animated.Value(1)).current; // whole-overlay opacity
  const pulse = useRef(new Animated.Value(0)).current; // logo pulse, 0..1

  // Gentle, looping logo pulse while we wait.
  useEffect(() => {
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
  }, [pulse]);

  // Minimum on-screen time.
  useEffect(() => {
    const t = setTimeout(() => setMinElapsed(true), MIN_VISIBLE_MS);
    return () => clearTimeout(t);
  }, []);

  // Fade out once everything is ready, then unmount.
  const ready = hydrated && minElapsed;
  useEffect(() => {
    if (!ready) return;
    const anim = Animated.timing(fade, {
      toValue: 0,
      duration: FADE_MS,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    });
    anim.start(({ finished }) => {
      if (finished) setGone(true);
    });
    return () => anim.stop();
  }, [ready, fade]);

  if (gone) return null;

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] });
  const subtitleOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0.85] });

  return (
    <Animated.View
      pointerEvents={ready ? 'none' : 'auto'}
      style={[StyleSheet.absoluteFill, styles.root, { opacity: fade }]}
    >
      <Animated.View style={[styles.badge, { transform: [{ scale }] }]}>
        <AppLogo size={96} />
      </Animated.View>

      <Text style={styles.title}>Bolid Tester</Text>
      <Animated.Text style={[styles.subtitle, { opacity: subtitleOpacity }]}>
        OBD2 diagnostics
      </Animated.Text>

      <ActivityIndicator color="#FFFFFF" style={styles.spinner} />
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
    backgroundColor: BADGE,
    padding: 22,
    borderRadius: 28,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: 0.5,
    marginTop: 22,
  },
  subtitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
    marginTop: 6,
  },
  spinner: {
    marginTop: 28,
  },
});
