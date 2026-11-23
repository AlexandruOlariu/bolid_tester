/** The read-only parts of an AI diagnosis report — the verdict banner, the finding cards (with the
 *  agent steps each finding rests on, plan 34a) and the uncited-findings notice — and
 *  `AiReportView`, which renders a whole saved report without the run / clear / follow-up controls.
 *  The Diagnose (AI) screen composes the banner and cards with its live actions; the History
 *  timeline (plan 16) re-opens a saved run's report with `AiReportView` (exported through the
 *  slice's `index.ts`), with the run's stored investigation trail when it has one (plan 34d). See
 *  docs/features/ai-diagnose.md. */
import React from 'react';
import { YStack, XStack, Card, Text, Paragraph } from 'tamagui';
import {
  Sparkles,
  Shield,
  ShieldCheck,
  TriangleAlert,
  CircleAlert,
  Eraser,
  RefreshCw,
  Search,
  Wrench,
  Activity,
} from 'lucide-react-native';
import { AGENT_BUDGET, vagCodeForDtc } from '@/shared/obd-core';
import type { AiReport, AiFinding, AiAction, DiagSeverity, OverallHealth } from '@/shared/obd-core';
import { GENERIC_GUIDE, matchFaultGuide, type FaultGuide } from '@/shared/vehicles/faultGuides';
// The fault guide's deep-link buttons, from the fault-codes public index (same buttons as on the
// Faults screen).
import { GuideLinks } from '@/features/fault-codes';
import { usePalette, type Tone, SectionTitle } from '@/shared/ui';
import { useTranslation } from '@/shared/i18n';
import { formatDateTime } from '@/shared/lib/format';
import type { TrailRow } from '@/shared/state/historyStore';
import { AgentTrail } from './AgentTrail';

const SEV_TONE: Record<DiagSeverity, Tone> = {
  ok: 'statusOk',
  info: 'statusInfo',
  warn: 'statusWarn',
  critical: 'statusError',
};

/** Verdict tone + icon; the labels are `aiDiagnose:overall.<overall>` and the severity chips
 *  `aiDiagnose:severity.<severity>` (plan 11). */
const OVERALL_META: Record<OverallHealth, { tone: Tone; Icon: typeof ShieldCheck }> = {
  ok: { tone: 'statusOk', Icon: ShieldCheck },
  attention: { tone: 'statusWarn', Icon: TriangleAlert },
  urgent: { tone: 'statusError', Icon: CircleAlert },
};

export function OverallBanner({ report }: { report: AiReport }) {
  const { t } = useTranslation('aiDiagnose');
  const palette = usePalette();
  const meta = OVERALL_META[report.overall];
  const color = palette[meta.tone];
  const { Icon } = meta;
  return (
    <Card bordered padding="$4" borderLeftWidth={4} borderLeftColor={color} gap="$2">
      <XStack alignItems="center" gap="$3">
        <Icon size={28} color={color} />
        <YStack flex={1}>
          <Text fontWeight="900" fontSize="$7" color={color} accessibilityRole="header">
            {t(`overall.${report.overall}`)}
          </Text>
          <XStack alignItems="center" gap="$2">
            {report.source === 'ai' ? (
              <Sparkles size={13} color={palette.muted} />
            ) : (
              <Shield size={13} color={palette.muted} />
            )}
            <Paragraph theme="alt2" fontSize="$1">
              {report.source === 'ai' ? t('source.ai') : t('source.rules')}
            </Paragraph>
          </XStack>
        </YStack>
      </XStack>
      <Paragraph fontSize="$4">{report.summary}</Paragraph>
    </Card>
  );
}

/** The curated guides (not the generic fallback) for a finding's codes, one per distinct guide. */
function findingGuides(profileId: string, codes: string[] | undefined): FaultGuide[] {
  const out: FaultGuide[] = [];
  for (const code of codes ?? []) {
    const g = matchFaultGuide(profileId, code, vagCodeForDtc(code) || undefined);
    if (g !== GENERIC_GUIDE && !out.includes(g)) out.push(g);
  }
  return out;
}

export function FindingCard({
  finding,
  profileId,
  onNavigate,
}: {
  finding: AiFinding;
  profileId: string;
  /** Called before a fault-guide button navigates away (a sheet closes itself with it). */
  onNavigate?: () => void;
}) {
  const { t } = useTranslation('aiDiagnose');
  const palette = usePalette();
  const color = palette[SEV_TONE[finding.severity]];
  const guides = findingGuides(profileId, finding.codes);
  return (
    <Card bordered padding="$3" borderLeftWidth={3} borderLeftColor={color} gap="$1">
      <XStack justifyContent="space-between" alignItems="center" gap="$2">
        <Text fontWeight="800" flex={1}>
          {finding.title}
        </Text>
        <Text fontWeight="800" fontSize="$1" color={color} letterSpacing={0.6}>
          {t(`severity.${finding.severity}`)}
        </Text>
      </XStack>
      {finding.unconfirmed ? (
        <Text
          alignSelf="flex-start"
          fontSize="$1"
          fontWeight="700"
          color={palette.muted}
          borderColor={palette.muted}
          borderWidth={1}
          borderRadius="$10"
          paddingHorizontal="$2"
          paddingVertical="$1"
        >
          {t('agent.unconfirmedTag')}
        </Text>
      ) : null}
      {finding.detail ? (
        <Paragraph theme="alt2" fontSize="$3">
          {finding.detail}
        </Paragraph>
      ) : null}
      {finding.codes && finding.codes.length > 0 ? (
        <XStack flexWrap="wrap" gap="$2" marginTop="$1">
          {finding.codes.map((c) => (
            <Text
              key={c}
              fontSize="$1"
              fontWeight="800"
              color={color}
              borderColor={color}
              borderWidth={1}
              borderRadius="$10"
              paddingHorizontal="$2"
              paddingVertical="$1"
            >
              {c}
            </Text>
          ))}
        </XStack>
      ) : null}
      {guides.map((g, i) => (
        <YStack
          key={`g-${i}`}
          gap="$2"
          marginTop="$1"
          backgroundColor="$color2"
          padding="$2"
          borderRadius="$3"
        >
          <Paragraph fontSize="$2">{t('knownCheck', { note: g.note })}</Paragraph>
          <GuideLinks guide={g} onNavigate={onNavigate} />
        </YStack>
      ))}
      {finding.likelyCauses && finding.likelyCauses.length > 0 ? (
        <Paragraph theme="alt2" fontSize="$2" marginTop="$1">
          {t('likelyCauses', { causes: finding.likelyCauses.join('; ') })}
        </Paragraph>
      ) : null}
      {finding.steps && finding.steps.length > 0 ? (
        <Paragraph theme="alt2" fontSize="$1" marginTop="$1">
          {t('agent.basedOn', { steps: finding.steps.join(', ') })}
        </Paragraph>
      ) : null}
    </Card>
  );
}

/** The agent's final report left out findings that cited no usable step (plan 34a). */
export function UncitedNotice({ report }: { report: AiReport }) {
  const { t } = useTranslation('aiDiagnose');
  if (!report.uncitedDropped) return null;
  return (
    <Card bordered padding="$3" borderLeftWidth={3} borderLeftColor="$statusInfo">
      <Paragraph fontSize="$2">
        {t('agent.uncitedDropped', { count: report.uncitedDropped })}
      </Paragraph>
    </Card>
  );
}

const noop = (): void => undefined;

/** Icon per recommended-action type (shared with the Diagnose screen's live action list). */
export const ACTION_ICON: Record<AiAction['type'], typeof Eraser> = {
  clear_dtcs: Eraser,
  recheck: RefreshCw,
  inspect: Search,
  service: Wrench,
  monitor: Activity,
};

/** A saved report, read-only: verdict, findings (with the car's fault guides), the recommended
 *  actions as a list (no buttons — the run is over), the run's investigation trail collapsed when
 *  one was stored (plan 34d; older runs have none and show no trail) and the disclaimer with the
 *  run time. A host that shows it in a sheet passes `onNavigate` to close the sheet before a
 *  fault-guide button ("Related data" / "Open routine") leaves the screen. */
export function AiReportView({
  report,
  profileId,
  ranAt,
  onNavigate,
  trail,
}: {
  report: AiReport;
  /** The car the report was made for (its fault guides). */
  profileId: string;
  ranAt: number | null;
  onNavigate?: () => void;
  /** The run's stored trail (History, plan 34d). */
  trail?: ReadonlyArray<TrailRow>;
}) {
  const { t } = useTranslation('aiDiagnose');
  const palette = usePalette();
  return (
    <YStack gap="$3">
      <OverallBanner report={report} />
      <UncitedNotice report={report} />
      {report.findings.length > 0 ? (
        <YStack gap="$2">
          <SectionTitle>{t('findings', { count: report.findings.length })}</SectionTitle>
          {report.findings.map((f, i) => (
            <FindingCard key={`f-${i}`} finding={f} profileId={profileId} onNavigate={onNavigate} />
          ))}
        </YStack>
      ) : (
        <Paragraph theme="alt2">{t('noIssues')}</Paragraph>
      )}
      {report.actions.length > 0 ? (
        <YStack gap="$2">
          <SectionTitle>{t('actions')}</SectionTitle>
          {report.actions.map((a, i) => {
            const Icon = ACTION_ICON[a.type] ?? Activity;
            return (
              <XStack key={`a-${i}`} alignItems="center" gap="$3">
                <Icon size={16} color={palette.muted} />
                <YStack flex={1}>
                  <Text fontWeight="700">{a.label}</Text>
                  {a.detail ? (
                    <Paragraph theme="alt2" fontSize="$2">
                      {a.detail}
                    </Paragraph>
                  ) : null}
                </YStack>
              </XStack>
            );
          })}
        </YStack>
      ) : null}
      {trail && trail.length > 0 ? (
        <AgentTrail
          trail={trail}
          running={false}
          stepsUsed={trail.length}
          maxSteps={AGENT_BUDGET.maxSteps}
          onStop={noop}
          collapsible
          initiallyExpanded={false}
        />
      ) : null}
      <Paragraph theme="alt2" fontSize="$1" marginTop="$2">
        {report.disclaimer}
        {ranAt ? ` · ${formatDateTime(ranAt)}` : ''}
      </Paragraph>
    </YStack>
  );
}
