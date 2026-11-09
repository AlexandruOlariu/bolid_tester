import { useCallback, useState } from 'react';
import { Linking, Platform } from 'react-native';
import {
  bundleToJson,
  bundleToMarkdown,
  issueUrl,
  mailtoUrl,
  redactBundle,
  utf8ByteLength,
  type BundleInput,
  type FeedbackBundle,
} from '@/shared/lib/feedbackBundle';
import { APP_BUILD, APP_VERSION, FEEDBACK_EMAIL } from '@/shared/lib/appInfo';
import { fileStamp, saveTextFile } from '@/shared/lib/saveFile';
import { PROTOCOL_LABELS } from '@/shared/obd-core';
import { adapterLogOrigin, adapterLogSnapshot } from '@/shared/state/adapterLog';
import { getActiveProfile, getActiveUserVehicle } from '@/shared/state/activeProfile';
import { useErrorLogStore, logError } from '@/shared/state/errorLogStore';
import { useGarageStore } from '@/shared/state/garageStore';
import { useSessionStore } from '@/shared/state/sessionStore';
import { useSettingsStore } from '@/shared/state/settingsStore';
import { vehicleLabel } from '@/shared/vehicles';
import { translate } from '@/shared/i18n';

/** The last module scan as text (`formatAutoScanReport(scans[0])`), or null. Handed in by the route
 *  (`src/app/feedback.tsx`), because a feature never imports another feature's store. */
export type LastScanReport = () => string | null;

export interface FeedbackOptions {
  getLastScanReport?: LastScanReport;
}

function deviceLocale(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale || undefined;
  } catch {
    return undefined;
  }
}

/** Everything the bundle holds, read from the stores right now. */
export function collectBundleInput(
  description: string,
  keepIdentifiers: boolean,
  getLastScanReport?: LastScanReport,
): BundleInput {
  const session = useSessionStore.getState();
  const info = session.info;
  const profile = getActiveProfile();
  const userVehicle = getActiveUserVehicle();
  const origin = adapterLogOrigin();
  let lastScanReport: string | null = null;
  try {
    lastScanReport = getLastScanReport?.() ?? null;
  } catch (e) {
    logError({ source: 'feedback/scan-report', error: e, severity: 'warning' });
  }
  return {
    description,
    keepIdentifiers,
    app: {
      version: APP_VERSION,
      ...(APP_BUILD ? { build: APP_BUILD } : null),
      adapterSource: useSettingsStore.getState().adapterSource,
      platform: Platform.OS,
      osVersion: String(Platform.Version ?? ''),
      locale: deviceLocale(),
    },
    vehicle: {
      profileId: profile.id,
      name: vehicleLabel(profile),
      vin: info?.vin ?? userVehicle?.learned?.vin ?? null,
      ...(info ? { protocol: PROTOCOL_LABELS[info.protocol] ?? String(info.protocol) } : null),
      ...(info ? { supportedPidCount: info.supportedPids.length } : null),
    },
    adapter: {
      deviceId: session.deviceId,
      deviceName: session.deviceName,
      ...((info?.version ?? origin?.adapter)
        ? { version: info?.version ?? origin?.adapter }
        : null),
    },
    errors: useErrorLogStore.getState().errors,
    adapterLog: adapterLogSnapshot(),
    lastScanReport,
    // Every VIN the app knows, so one that only appears in a log line is masked too.
    extraVins: [origin?.vin, ...useGarageStore.getState().vehicles.map((v) => v.learned?.vin)],
  };
}

/** Build the redacted problem report from the stores and hand it to the share sheet, a prefilled
 *  GitHub issue or an email draft. Nothing is sent anywhere by the app itself: every route goes
 *  through an app the user picks. A GitHub issue is public, so its prefilled summary is always
 *  redacted, whatever the **Keep VIN and adapter address** switch says. */
export function useFeedbackBundle({ getLastScanReport }: FeedbackOptions = {}) {
  const [busy, setBusy] = useState(false);
  const [sizeBytes, setSizeBytes] = useState<number | null>(null);

  const build = useCallback(
    (description: string, keepIdentifiers: boolean): FeedbackBundle => {
      const bundle = redactBundle(
        collectBundleInput(description, keepIdentifiers, getLastScanReport),
      );
      setSizeBytes(utf8ByteLength(bundleToJson(bundle)));
      return bundle;
    },
    [getLastScanReport],
  );

  const share = useCallback(
    async (
      description: string,
      keepIdentifiers: boolean,
      format: 'json' | 'md',
    ): Promise<string | null> => {
      setBusy(true);
      try {
        const bundle = build(description, keepIdentifiers);
        const isJson = format === 'json';
        const saved = await saveTextFile(
          `bolid-feedback-${fileStamp(bundle.createdAt)}.${format}`,
          isJson
            ? bundleToJson(bundle)
            : bundleToMarkdown(bundle, {
                maxErrors: bundle.errors.length,
                maxLogLines: bundle.adapterLog.length,
              }),
          isJson ? 'application/json' : 'text/markdown',
          { dialogTitle: translate('common:share.problemReport') },
        );
        // saveTextFile returns null without throwing when the device has no document directory;
        // log it, so the screen's "See More → Error log" pointer always finds an entry.
        if (!saved) {
          logError({
            source: 'feedback/share',
            error: new Error('No app folder on this device: the problem report was not saved.'),
          });
        }
        return saved;
      } catch (e) {
        logError({ source: 'feedback/share', error: e });
        return null;
      } finally {
        setBusy(false);
      }
    },
    [build],
  );

  const shareJson = useCallback(
    (description: string, keepIdentifiers: boolean) => share(description, keepIdentifiers, 'json'),
    [share],
  );
  const shareMarkdown = useCallback(
    (description: string, keepIdentifiers: boolean) => share(description, keepIdentifiers, 'md'),
    [share],
  );

  /** Build the URL and open it; a failure in either step is logged under `source` and returns
   *  false, so the screen always shows a note. */
  const open = useCallback(async (makeUrl: () => string, source: string): Promise<boolean> => {
    setBusy(true);
    try {
      await Linking.openURL(makeUrl());
      return true;
    } catch (e) {
      logError({ source, error: e });
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  /** Open the browser on a new GitHub issue, prefilled with the (always redacted) summary. */
  const openIssue = useCallback(
    (description: string) => open(() => issueUrl(build(description, false)), 'feedback/open-issue'),
    [build, open],
  );

  /** Open an email draft to `FEEDBACK_EMAIL`; false (nothing opened) when none is configured. */
  const email = useCallback(
    async (description: string, keepIdentifiers: boolean): Promise<boolean> => {
      if (!FEEDBACK_EMAIL) return false;
      const to = FEEDBACK_EMAIL;
      return open(() => mailtoUrl(build(description, keepIdentifiers), to), 'feedback/email');
    },
    [build, open],
  );

  return {
    build,
    shareJson,
    shareMarkdown,
    openIssue,
    email,
    emailAvailable: FEEDBACK_EMAIL !== null,
    busy,
    sizeBytes,
  };
}
