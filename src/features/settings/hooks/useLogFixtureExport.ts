import { useCallback, useState } from 'react';
import { fixtureFromLog, LoggedIo } from '@/shared/obd-core';
import { logError } from '@/shared/state/errorLogStore';

/** Export the adapter I/O log as a replay fixture (JSON): every command paired with the response
 *  the real car gave. Drop the file into the repo's fixtures to turn a real-car session into a
 *  regression test / simulator scenario (see docs/simulator.md). Dependency-tolerant expo
 *  file-system/sharing, same pattern as the error-log export. */
export function useLogFixtureExport() {
  const [busy, setBusy] = useState(false);

  const exportFixture = useCallback(async (log: LoggedIo[], name: string): Promise<string | null> => {
    setBusy(true);
    try {
      const FileSystem = await import('expo-file-system' as string);
      const Sharing = await import('expo-sharing' as string);
      const dir = (FileSystem as { documentDirectory?: string }).documentDirectory ?? '';
      if (!dir) return null;

      const fixture = fixtureFromLog(log, name);
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const uri = `${dir}bolid-replay-${stamp}.json`;
      await FileSystem.writeAsStringAsync(uri, JSON.stringify(fixture, null, 2));
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'application/json' });
      }
      return uri;
    } catch (e) {
      logError({ source: 'settings/replay-export', error: e, severity: 'warning' });
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  return { exportFixture, busy };
}
