import React, { useState } from 'react';
import { YStack, XStack, Card, Text, Paragraph, Button, Spinner } from 'tamagui';
import { useRouter } from 'expo-router';
import { Share2, FileText, FileStack } from 'lucide-react-native';
import {
  Screen,
  ValueCard,
  appAlert,
  SectionTitle,
  usePalette,
  HIT_SLOP,
  AccessibleSwitch,
} from '@/shared/ui';
import { useSessionStore } from '@/shared/state/sessionStore';
import { useActiveProfile } from '@/features/vehicle-select/api/activeProfile';
import { curatedProfileId, vehicleLabel } from '@/shared/vehicles';
import { matchFaultGuide } from '@/shared/vehicles/faultGuides';
import {
  formatDtcReport,
  buildDtcReportHtml,
  dtcCheckFromRead,
  type DtcCheckReport,
} from '@/shared/lib/dtcReport';
import { vagCodeForDtc, type Dtc } from '@/shared/obd-core/obd/dtc';
import type { MonitorStatus } from '@/shared/obd-core/obd/readiness';
import { driveCyclePattern, DRIVE_CYCLE_DISCLAIMER } from '@/shared/obd-core';
import type { FreezeFrame } from '@/shared/obd-core/session/DiagnosticSession';
import { useDtcs } from '../hooks/useDtcs';
import { useDtcExport } from '../hooks/useDtcExport';
import { useCoachStore } from '../model/coachStore';
import { DtcDetailSheet } from './DtcDetailSheet';
import { CodeFreezeFrame, GuideLinks } from './DtcGuideParts';
import { useTranslation } from '@/shared/i18n';

/** A single DTC: tap the code (or description) for the detail sheet; the inline **Guide** (6b.7)
 *  shows the note, deep-links to related data / routine and the captured freeze frame. */
function DtcRow({
  dtc,
  profileId,
  freezeFrames,
  onOpenDetail,
}: {
  dtc: Dtc;
  profileId: string;
  freezeFrames: FreezeFrame[];
  onOpenDetail: (dtc: Dtc) => void;
}) {
  const { t } = useTranslation('faultCodes');
  const [open, setOpen] = useState(false);
  const { code, description } = dtc;
  const guide = matchFaultGuide(profileId, code, vagCodeForDtc(code) || undefined);

  return (
    <Card bordered padding="$3" gap="$2">
      <XStack justifyContent="space-between" alignItems="center">
        <YStack
          flex={1}
          onPress={() => onOpenDetail(dtc)}
          pressStyle={{ opacity: 0.6 }}
          accessible
          accessibilityRole="button"
          accessibilityLabel={t('row.a11y', { code, description })}
        >
          <Text fontWeight="800" color="$statusError">
            {code}
          </Text>
          <Paragraph theme="alt2" fontSize="$2">
            {description}
          </Paragraph>
        </YStack>
        <Button size="$3" hitSlop={HIT_SLOP} chromeless onPress={() => setOpen((v) => !v)}>
          {open ? t('row.hideGuide') : t('row.guide')}
        </Button>
      </XStack>

      {open ? (
        <YStack gap="$2" backgroundColor="$color2" padding="$2" borderRadius="$3">
          <Paragraph fontSize="$2">{guide.note}</Paragraph>
          <GuideLinks guide={guide} />
          <CodeFreezeFrame code={code} guide={guide} freezeFrames={freezeFrames} />
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
  onOpenDetail,
}: {
  title: string;
  codes: Dtc[];
  profileId: string;
  freezeFrames: FreezeFrame[];
  onOpenDetail: (dtc: Dtc) => void;
}) {
  const { t } = useTranslation('faultCodes');
  return (
    <YStack gap="$2">
      <SectionTitle>
        {title} ({codes.length})
      </SectionTitle>
      {codes.length === 0 ? (
        <Paragraph theme="alt2">{t('section.none')}</Paragraph>
      ) : (
        codes.map((d) => (
          <DtcRow
            key={`${title}-${d.code}`}
            dtc={d}
            profileId={profileId}
            freezeFrames={freezeFrames}
            onOpenDetail={onOpenDetail}
          />
        ))
      )}
    </YStack>
  );
}

function ReadinessPanel({ readiness }: { readiness: MonitorStatus }) {
  const { t } = useTranslation('faultCodes');
  const supported = readiness.monitors.filter((m) => m.supported);
  const complete = supported.filter((m) => m.complete).length;
  const notReady = supported.filter((m) => !m.complete);
  return (
    // A polite live region (plan 20): a MIL that switches on, or a changed monitor count, is
    // announced without moving focus. Not on the 1 Hz live values — they would never stop talking.
    <Card
      bordered
      padding="$3"
      gap="$1"
      accessible
      accessibilityLabel={`${t('readiness.a11y', {
        mil: readiness.milOn ? t('readiness.milOnA11y') : t('readiness.milOffA11y'),
        complete,
        total: supported.length,
        count: readiness.dtcCount,
      })}${notReady.length > 0 ? ` ${t('readiness.notReadyA11y', { names: notReady.map((m) => m.name).join(', ') })}` : ''}`}
      accessibilityLiveRegion="polite"
      testID="readiness-panel"
    >
      {/* Wraps when the title and the MIL state don't fit one line (longer languages, large text). */}
      <XStack flexWrap="wrap" columnGap="$3" alignItems="center">
        <Text flexShrink={1} fontWeight="800">
          {t('readiness.title')}
        </Text>
        <Text
          marginLeft="auto"
          fontWeight="800"
          color={readiness.milOn ? '$statusError' : '$statusOk'}
        >
          {readiness.milOn ? t('readiness.milOn') : t('readiness.milOff')}
        </Text>
      </XStack>
      <Paragraph theme="alt2" fontSize="$2">
        {t('readiness.summary', {
          complete,
          total: supported.length,
          ignition: t(`readiness.ignitionType.${readiness.ignition}`),
          count: readiness.dtcCount,
        })}
      </Paragraph>
      {notReady.length > 0 ? (
        <Paragraph theme="alt2" fontSize="$2">
          {t('readiness.notReady', { names: notReady.map((m) => m.name).join(', ') })}
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
  const { t } = useTranslation('faultCodes');
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
          <Text fontWeight="800">{t('coach.title')}</Text>
          <Paragraph theme="alt2" fontSize="$2">
            {incomplete.length > 0
              ? t('coach.notReady', { count: incomplete.length })
              : t('coach.allReady')}
          </Paragraph>
        </YStack>
        <AccessibleSwitch
          checked={enabled}
          onCheckedChange={(v) => (v ? setEnabled(true) : reset())}
          accessibilityLabel={t('coach.title')}
        />
      </XStack>

      {enabled ? (
        <Paragraph theme="alt2" fontSize="$2">
          {t('coach.help')}
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
        <Paragraph color="$statusOk" fontWeight="700">
          {t('coach.complete')}
        </Paragraph>
      ) : null}
    </Card>
  );
}

function FreezeFrameView({ ff }: { ff: FreezeFrame }) {
  const { t } = useTranslation('faultCodes');
  return (
    <YStack gap="$2">
      <SectionTitle>{t('freezeFrame.title')}</SectionTitle>
      <Paragraph theme="alt2" fontSize="$2">
        {t('freezeFrame.captured', { code: ff.triggerDtc ?? t('freezeFrame.aCode') })}
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
  const { t } = useTranslation('faultCodes');
  const palette = usePalette();
  const status = useSessionStore((s) => s.status);
  const info = useSessionStore((s) => s.info);
  const profile = useActiveProfile();
  // Fault guides are curated per registry profile; a garage car uses its base profile's guides.
  const guideProfileId = curatedProfileId(profile);
  const { stored, pending, permanent, readiness, freezeFrames, loading, error, refresh, clear } =
    useDtcs();
  const { exportReport, busy: exporting } = useDtcExport();
  const [detail, setDetail] = useState<Dtc | null>(null);

  const deviceName = useSessionStore((s) => s.deviceName);
  const router = useRouter();
  // Snapshot the current read as the normalised report shape, shared by both the Markdown export and
  // the HTML "send to my mechanic" report (`dtcCheckFromRead`, also used by the vehicle report).
  const buildCheck = (): DtcCheckReport =>
    dtcCheckFromRead(
      { stored, pending, permanent, readiness, freezeFrames },
      info,
      vehicleLabel(profile),
      { adapter: deviceName },
    );

  const onExport = async () => {
    const body = formatDtcReport([buildCheck()], { title: 'Bolid Tester — fault codes' });
    const uri = await exportReport('bolid-fault-codes', body);
    if (!uri) appAlert(t('export.unavailable'), t('export.noSharing'));
  };

  const onShareReport = async () => {
    const html = buildDtcReportHtml(buildCheck(), { title: 'Bolid Tester — diagnostic report' });
    const uri = await exportReport('bolid-diagnostic-report', html, {
      ext: 'html',
      mimeType: 'text/html',
      dialogTitle: t('export.shareDialog'),
    });
    if (!uri) appAlert(t('export.shareUnavailable'), t('export.noSharing'));
  };

  const confirmClear = () =>
    appAlert(t('clear.title'), t('clear.body'), [
      { text: t('common:actions.cancel'), style: 'cancel' },
      { text: t('clear.confirm'), style: 'destructive', onPress: () => void clear() },
    ]);

  if (status !== 'connected') {
    return (
      <Screen title={t('title')}>
        <Paragraph theme="alt2">{t('notConnected')}</Paragraph>
      </Screen>
    );
  }

  return (
    <Screen title={t('title')} onRefresh={refresh} refreshing={loading}>
      {error ? <Paragraph color="$statusError">{error}</Paragraph> : null}
      {readiness ? <ReadinessPanel readiness={readiness} /> : null}
      <CoachPanel readiness={readiness} />
      <Section
        title={t('section.stored')}
        codes={stored}
        profileId={guideProfileId}
        freezeFrames={freezeFrames}
        onOpenDetail={setDetail}
      />
      <Section
        title={t('section.pending')}
        codes={pending}
        profileId={guideProfileId}
        freezeFrames={freezeFrames}
        onOpenDetail={setDetail}
      />
      <Section
        title={t('section.permanent')}
        codes={permanent}
        profileId={guideProfileId}
        freezeFrames={freezeFrames}
        onOpenDetail={setDetail}
      />
      {freezeFrames.map((ff) => (
        <FreezeFrameView key={ff.frame ?? ff.triggerDtc ?? 0} ff={ff} />
      ))}

      <XStack gap="$3" marginTop="$2">
        <Button flex={1} onPress={refresh} icon={loading ? () => <Spinner /> : undefined}>
          {t('actions.reread')}
        </Button>
        <Button flex={1} theme="red" onPress={confirmClear} disabled={loading}>
          {t('actions.clear')}
        </Button>
      </XStack>
      <XStack gap="$3" marginTop="$2">
        <Button
          flex={1}
          onPress={onExport}
          disabled={exporting}
          icon={exporting ? () => <Spinner /> : <Share2 size={18} color={palette.accent} />}
        >
          {t('actions.export')}
        </Button>
        <Button
          flex={1}
          onPress={onShareReport}
          disabled={exporting}
          icon={exporting ? () => <Spinner /> : <FileText size={18} color={palette.accent} />}
        >
          {t('actions.share')}
        </Button>
      </XStack>
      <Button
        marginTop="$2"
        onPress={() => router.push('/report')}
        icon={<FileStack size={18} color={palette.accent} />}
      >
        {t('actions.fullReport')}
      </Button>
      <DtcDetailSheet
        dtc={detail}
        profile={profile}
        freezeFrames={freezeFrames}
        onClose={() => setDetail(null)}
      />
    </Screen>
  );
}
