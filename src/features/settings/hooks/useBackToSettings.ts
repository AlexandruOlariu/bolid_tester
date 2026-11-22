import { useCallback } from 'react';
import { BackHandler, Platform } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

/** Android's back button on a Settings page (AI assistant, Privacy, Label packs, …) returns to the
 *  Settings hub. The pages are hidden tabs, and a tab navigator's back otherwise jumps to its first
 *  route (Connect), not to where the page was opened from. Only while the page is focused. */
export function useBackToSettings(): void {
  const router = useRouter();
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'android') return undefined;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        router.navigate('/settings');
        return true;
      });
      return () => sub.remove();
    }, [router]),
  );
}
