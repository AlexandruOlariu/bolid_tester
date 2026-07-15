import React, { useState } from 'react';
import { Alert } from 'react-native';
import { router } from 'expo-router';
import { YStack, XStack, Card, Text, Paragraph, Button, Spinner, Switch } from 'tamagui';
import { Share2, FileText } from 'lucide-react-native';
import { Screen, ValueCard } from '@/shared/ui';
import { useSessionStore } from '@/shared/state/sessionStore';
import { useVehicleStore } from '@/features/vehicle-select/model/vehicleStore';
import { getVehicleProfile, vehicleLabel } from '@/shared/vehicles';
import { matchFaultGuide } from '@/shared/vehicles/faultGuides';
import { formatDtcReport, buildDtcReportHtml, type DtcCheckReport } from '@/shared/lib/dtcReport';
import { vagCodeForDtc, type Dtc } from '@/shared/obd-core/obd/dtc';
import type { MonitorStatus } from '@/shared/obd-core/obd/readiness';
import { driveCyclePattern, DRIVE_CYCLE_DISCLAIMER } from '@/shared/obd-core';
import type { FreezeFrame } from '@/shared/obd-core/session/DiagnosticSession';
import { useDtcs } from '../hooks/useDtcs';
import { useDtcExport } from '../hooks/useDtcExport';
import { useCoachStore } from '../model/coachStore';

/** A single DTC with an expandable "Guide" (6b.7): the note, deep-links to related data / routine,
 *  and the captured freeze frame for this code. */
function DtcRow({
  code,
  description,
  profileId,
  freezeFrames,
}: {
  code: string;
  description: string;
  profileId: string;
  freezeFrames: FreezeFrame[];
}) {
  const [open, setOpen] = useState(false);
  const guide = matchFaultGuide(profileId, code, vagCodeForDtc(code) || undefined);
  const ff = guide.freezeFrame ? freezeFrames.find((f) => f.triggerDtc === code) : undefined;
  const hasLinks = Boolean(guide.relatedDids?.length) || Boolean(guide.routineId);

  return (
    <Card bordered padding="$3" gap="$2">
      <XStack justifyContent="space-between" alignItems="center">
        <Text fontWeight="800" color="$red10">
          {code}
        </Text>
        <Button size="$2" chromeless onPress={() => setOpen((v) => !v)}>
          {open ? 'Hide guide' : 'Guide'}
        </Button>
      </XStack>
      <Paragraph theme="alt2" fontSize="$2">
        {description}
      </Paragraph>

      {open ? (
        <YStack gap="$2" backgroundColor="$color2" padding="$2" borderRadius="$3">
          <Paragraph fontSize="$2">{guide.note}</Paragraph>
          {hasLinks ? (
            <XStack gap="$2" flexWrap="wrap">
              {guide.relatedDids?.length ? (
                <Button
                  size="$2"
                  theme="blue"
                  onPress={() =>
                    router.push(`/extended?dids=${encodeURIComponent(guide.relatedDids!.join(','))}`)
                  }
                >
                  Related data
                </Button>
              ) : null}
              {guide.routineId ? (
                <Button size="$2" theme="blue" onPress={() => router.push('/routines')}>
                  Open routine
                </Button>
              ) : null}
            </XStack>
          ) : null}
          {ff ? (
            <YStack gap="$1">
              <Text fontWeight="700" fontSize="$2">
                Freeze frame
              </Text>
              <XStack flexWrap="wrap" gap="$2">
                {ff.values.map((v) => (
                  <ValueCard key={v.pid} name={v.name} value={v.value} unit={v.unit} />
                ))}
              </XStack>
            </YStack>
          ) : guide.freezeFrame ? (
            <Paragraph theme="alt2" fontSize="$2">
              No freeze frame captured for this code.
            </Paragraph>
          ) : null}
        </YStack>
      ) : null}
    </Card>
  );
}

function Section({
  title,
  codes,
  profileId,
  freezeFrames,
}: {
  title: string;
  codes: Dtc[];
  profileId: string;
  freezeFrames: FreezeFrame[];
}) {
  return (
    <YStack gap="$2">
      <Text fontWeight="800" fontSize="$5">
        {title} ({codes.length})
      </Text>
      {codes.length === 0 ? (
        <Paragraph theme="alt2">None</Paragraph>
      ) : (
        codes.map((d) => (
          <DtcRow
            key={`${title}-${d.code}`}
            code={d.code}
            description={d.description}
            profileId={profileId}
            freezeFrames={freezeFrames}
          />
        ))
      )}
    </YStack>
  );
}

function ReadinessPanel({ readiness }: { readiness: MonitorStatus }) {
  const supported = readiness.monitors.filter((m) => m.supported);
  const complete = supported.filter((m) => m.complete).length;
  const notReady = supported.filter((m) => !m.complete);
  return (
    <Card bordered padding="$3" gap="$1">
      <XStack justifyContent="space-between" alignItems="center">
        <Text fontWeight="800">Readiness</Text>
        <Text fontWeight="800" color={readiness.milOn ? '$red10' : '$green10'}>
          MIL {readiness.milOn ? 'ON' : 'off'}
        </Text>
      </XStack>
      <Paragraph theme="alt2" fontSize="$2">
        {complete}/{supported.length} monitors complete · {readiness.ignition} ignition ·{' '}
        {readiness.dtcCount} DTC(s)
      </Paragraph>
      {notReady.length > 0 ? (
        <Paragraph theme="alt2" fontSize="$2">
          Not ready: {notReady.map((m) => m.name).join(', ')}
        </Paragraph>
      ) : null}
    </Card>
  );
}

/** Drive-cycle / readiness coach (6b.9): a toggle + per-incomplete-monitor drive pattern. Appears
 *  when monitors are incomplete (e.g. right after a code clear) or once the user has enabled it. The
 *  live-updating readiness comes from EngineHost's 30 s watcher via coachStore, falling back to the
 *  last manual read. */
function CoachPanel({ readiness }: { readiness: MonitorStatus | null }) {
  const enabled = useCoachStore((s) => s.enabled);
  const coachReadiness = useCoachStore((s) => s.readiness);
  const setEnabled = useCoachStore((s) => s.setEnabled);
  const reset = useCoachStore((s) => s.reset);

  const effective = coachReadiness ?? readiness;
  const incomplete = effective ? effective.monitors.filter((m) => m.supported && !m.complete) : [];
  if (!enabled && incomplete.length === 0) return null;

  return (
    <Card bordered padding="$3" gap="$2">
      <XStack justifyContent="space-between" alignItems="center">
        <YStack flex={1}>
          <Text fontWeight="800">Drive-cycle coach</Text>
          <Paragraph theme="alt2" fontSize="$2">
            {incomplete.length > 0
              ? `${incomplete.length} monitor(s) not ready`
              : 'All monitors ready'}
          </Paragraph>
        </YStack>
        <Switch checked={enabled} onCheckedChange={(v) => (v ? setEnabled(true) : reset())}>
          <Switch.Thumb />
        </Switch>
      </XStack>

      {enabled ? (
        <Paragraph theme="alt2" fontSize="$2">
          Checking readiness every 30 s while connected. You'll get a notification as each monitor
          completes, and once when all are ready.
        </Paragraph>
      ) : null}

      {incomplete.length > 0 ? (
        <YStack gap="$2">
          {incomplete.map((m) => {
            const p = driveCyclePattern(m.name);
            return (
              <YStack key={m.id} gap="$1" backgroundColor="$color2" padding="$2" borderRadius="$3">
                <Text fontWeight="700">{m.name}</Text>
                <Paragraph fontSize="$2">{p.summary}</Paragraph>
                {p.steps.map((s, i) => (
                  <Paragraph key={i} theme="alt2" fontSize="$2">
                    • {s}
                  </Paragraph>
                ))}
              </YStack>
            );
          })}
          <Paragraph theme="alt2" fontSize="$1">
            {DRIVE_CYCLE_DISCLAIMER}
          </Paragraph>
        </YStack>
      ) : enabled ? (
        <Paragraph color="$green10" fontWeight="700">
          All readiness monitors complete.
        </Paragraph>
      ) : null}
    </Card>
  );
}

function FreezeFrameView({ ff }: { ff: FreezeFrame }) {
  return (
    <YStack gap="$2">
      <Text fontWeight="800" fontSize="$5">
        Freeze frame
      </Text>
      <Paragraph theme="alt2" fontSize="$2">
        Captured when {ff.triggerDtc ?? 'a code'} set
      </Paragraph>
      <XStack flexWrap="wrap" gap="$2">
        {ff.values.map((v) => (
          <ValueCard key={v.pid} name={v.name} value={v.value} unit={v.unit} />
        ))}
      </XStack>
    </YStack>
  );
}

export function FaultCodesScreen() {
  const status = useSessionStore((s) => s.status);
  const info = useSessionStore((s) => s.info);
  const selectedProfileId = useVehicleStore((s) => s.selectedProfileId);
  const { stored, pending, permanent, readiness, freezeFrames, loading, error, refresh, clear } =
    useDtcs();
  const { exportReport, busy: exporting } = useDtcExport();

  // Snapshot the current read as the normalised report shape, shared by both the Markdown export and
  // the HTML "send to my mechanic" report. `protocol` is HTML-only (ignored by the Markdown renderer).
  const buildCheck = (): DtcCheckReport => {
    const profile = getVehicleProfile(selectedProfileId);
    const supported = readiness ? readiness.monitors.filter((m) => m.supported) : [];
    return {
      ts: Date.now(),
      vehicleLabel: vehicleLabel(profile),
      vin: info?.vin ?? null,
      protocol: info?.protocol ?? null,
      milOn: readiness ? readiness.milOn : null,
      stored,
      pending,
      permanent,
      monitorsComplete: readiness ? supported.filter((m) => m.complete).length : null,
      monitorsTotal: readiness ? supported.length : null,
      notReady: readiness ? supported.filter((m) => !m.complete).map((m) => m.name) : [],
      freezeFrame: freezeFrames[0]
        ? {
            triggerDtc: freezeFrames[0].triggerDtc,
            values: freezeFrames[0].values.map((v) => ({ name: v.name, value: v.value, unit: v.unit })),
          }
        : null,
      freezeFrames: freezeFrames.map((ff) => ({
        triggerDtc: ff.triggerDtc,
        values: ff.values.map((v) => ({ name: v.name, value: v.value, unit: v.unit })),
      })),
    };
  };

  const onExport = async () => {
    const body = formatDtcReport([buildCheck()], { title: 'Bolid Tester — fault codes' });
    const uri = await exportReport('bolid-fault-codes', body);
    if (!uri) Alert.alert('Export unavailable', 'Sharing is not available on this device.');
  };

  const onShareReport = async () => {
    const html = buildDtcReportHtml(buildCheck(), { title: 'Bolid Tester — diagnostic report' });
    const uri = await exportReport('bolid-diagnostic-report', html, {
      ext: 'html',
      mimeType: 'text/html',
      dialogTitle: 'Share diagnostic report',
    });
    if (!uri) Alert.alert('Share unavailable', 'Sharing is not available on this device.');
  };

  const confirmClear = () =>
    Alert.alert(
      'Clear fault codes?',
      'This erases stored codes and resets readiness monitors. Codes will return if the fault persists.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear', style: 'destructive', onPress: () => void clear() },
      ],
    );

  if (status !== 'connected') {
    return (
      <Screen title="Fault codes">
        <Paragraph theme="alt2">Not connected.</Paragraph>
      </Screen>
    );
  }

  return (
    <Screen title="Fault codes" onRefresh={refresh} refreshing={loading}>
      {error ? <Paragraph color="$red10">{error}</Paragraph> : null}
      {readiness ? <ReadinessPanel readiness={readiness} /> : null}
      <CoachPanel readiness={readiness} />
      <Section title="Stored" codes={stored} profileId={selectedProfileId} freezeFrames={freezeFrames} />
      <Section title="Pending" codes={pending} profileId={selectedProfileId} freezeFrames={freezeFrames} />
      <Section
        title="Permanent"
        codes={permanent}
        profileId={selectedProfileId}
        freezeFrames={freezeFrames}
      />
      {freezeFrames.map((ff) => (
        <FreezeFrameView key={ff.frame ?? ff.triggerDtc ?? 0} ff={ff} />
      ))}

      <XStack gap="$3" marginTop="$2">
        <Button flex={1} onPress={refresh} icon={loading ? () => <Spinner /> : undefined}>
          Re-read
        </Button>
        <Button flex={1} theme="red" onPress={confirmClear} disabled={loading}>
          Clear codes
        </Button>
      </XStack>
      <XStack gap="$3" marginTop="$2">
        <Button
          flex={1}
          onPress={onExport}
          disabled={exporting}
          icon={exporting ? () => <Spinner /> : () => <Share2 size={18} color="#2bb673" />}
        >
          Export report
        </Button>
        <Button
          flex={1}
          onPress={onShareReport}
          disabled={exporting}
          icon={exporting ? () => <Spinner /> : () => <FileText size={18} color="#2bb673" />}
        >
          Share report
        </Button>
      </XStack>
    </Screen>
  );
}
