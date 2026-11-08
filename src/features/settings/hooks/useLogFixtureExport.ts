import { useCallback, useState } from 'react';
import { saveReplayFixture } from '../api/replayFixtureFile';
import type { ReplayExportInput } from '../model/replayExport';

/** Export the adapter I/O log as a replay fixture (JSON): every command paired with the response
 *  the car gave (`pairs`), the commands whose answer changed (`sequences`) and a `meta` block naming
 *  the vehicle and the flow. Drop the file into `src/shared/obd-core/transport/fixtures/<vehicleId>/`
 *  to turn a real-car session into a CI regression test (see docs/simulator.md → "Replay
 *  fixtures"). The write + share is `api/replayFixtureFile.ts`; this hook only tracks `busy`.
 *  Resolves with the saved file name, or null when nothing was written (logged). */
export function useLogFixtureExport() {
  const [busy, setBusy] = useState(false);

  const exportFixture = useCallback(async (input: ReplayExportInput): Promise<string | null> => {
    setBusy(true);
    try {
      return await saveReplayFixture(input);
    } finally {
      setBusy(false);
    }
  }, []);

  return { exportFixture, busy };
}
