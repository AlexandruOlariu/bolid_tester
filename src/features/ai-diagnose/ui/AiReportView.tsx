/** The read-only parts of an AI diagnosis report — the verdict banner and the finding cards — and
 *  `AiReportView`, which renders a whole saved report without the run / clear / follow-up controls.
 *  The Diagnose (AI) screen composes the banner and cards with its live actions; the History
 *  timeline (plan 16) re-opens a saved run's report with `AiReportView` (exported through the
 *  slice's `index.ts`). See docs/features/ai-diagnose.md. */
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
import { vagCodeForDtc } from '@/shared/obd-core';
import type { AiReport, AiFinding, AiAction, DiagSeverity, OverallHealth } from '@/shared/obd-core';
import { GENERIC_GUIDE, matchFaultGuide, type FaultGuide } from '@/shared/vehicles/faultGuides';
// The fault guide's deep-link buttons, from the fault-codes public index (same buttons as on the
// Faults screen).
import { GuideLinks } from '@/features/fault-codes';
import { usePalette, type Tone, SectionTitle } from '@/shared/ui';

const SEV_TONE: Record<DiagSeverity, Tone> = {
  ok: 'statusOk',
  info: 'statusInfo',
  warn: 'statusWarn',
  critical: 'statusError',
};

const SEV_LABEL: Record<DiagSeverity, string> = {
  ok: 'OK',
  info: 'INFO',
  warn: 'ATTENTION',
  critical: 'CRITICAL',
};

const OVERALL_META: Record<OverallHealth, { tone: Tone; Icon: typeof ShieldCheck; label: string }> =
  {
    ok: { tone: 'statusOk', Icon: ShieldCheck, label: 'Looks healthy' },
    attention: { tone: 'statusWarn', Icon: TriangleAlert, label: 'Needs attention' },
    urgent: { tone: 'statusError', Icon: CircleAlert, label: 'Urgent' },
  };

export function OverallBanner({ report }: { report: AiReport }) {
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
            {meta.label}
          </Text>
          <XStack alignItems="center" gap="$2">
            {report.source === 'ai' ? (
              <Sparkles size={13} color={palette.muted} />
            ) : (
              <Shield size={13} color={palette.muted} />
            )}
            <Paragraph theme="alt2" fontSize="$1">
              {report.source === 'ai' ? 'AI analysis' : 'On-device rule-based analysis'}
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
  const color = usePalette()[SEV_TONE[finding.severity]];
  const guides = findingGuides(profileId, finding.codes);
  return (
    <Card bordered padding="$3" borderLeftWidth={3} borderLeftColor={color} gap="$1">
      <XStack justifyContent="space-between" alignItems="center" gap="$2">
        <Text fontWeight="800" flex={1}>
          {finding.title}
        </Text>
        <Text fontWeight="800" fontSize="$1" color={color} letterSpacing={0.6}>
          {SEV_LABEL[finding.severity]}
        </Text>
      </XStack>
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
          <Paragraph fontSize="$2">Known check for this car: {g.note}</Paragraph>
          <GuideLinks guide={g} onNavigate={onNavigate} />
        </YStack>
      ))}
      {finding.likelyCauses && finding.likelyCauses.length > 0 ? (
        <Paragraph theme="alt2" fontSize="$2" marginTop="$1">
          Likely causes: {finding.likelyCauses.join('; ')}.
        </Paragraph>
      ) : null}
    </Card>
  );
}

/** Icon per recommended-action type (shared with the Diagnose screen's live action list). */
export const ACTION_ICON: Record<AiAction['type'], typeof Eraser> = {
  clear_dtcs: Eraser,
  recheck: RefreshCw,
  inspect: Search,
  service: Wrench,
  monitor: Activity,
};

/** A saved report, read-only: verdict, findings (with the car's fault guides), the recommended
 *  actions as a list (no buttons — the run is over) and the disclaimer with the run time. A host
 *  that shows it in a sheet passes `onNavigate` to close the sheet before a fault-guide button
 *  ("Related data" / "Open routine") leaves the screen. */
export function AiReportView({
  report,
  profileId,
  ranAt,
  onNavigate,
}: {
  report: AiReport;
  /** The car the report was made for (its fault guides). */
  profileId: string;
  ranAt: number | null;
  onNavigate?: () => void;
}) {
  const palette = usePalette();
  return (
    <YStack gap="$3">
      <OverallBanner report={report} />
      {report.findings.length > 0 ? (
        <YStack gap="$2">
          <SectionTitle>Findings ({report.findings.length})</SectionTitle>
          {report.findings.map((f, i) => (
            <FindingCard key={`f-${i}`} finding={f} profileId={profileId} onNavigate={onNavigate} />
          ))}
        </YStack>
      ) : (
        <Paragraph theme="alt2">No specific issues were flagged.</Paragraph>
      )}
      {report.actions.length > 0 ? (
        <YStack gap="$2">
          <SectionTitle>Recommended actions</SectionTitle>
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
      <Paragraph theme="alt2" fontSize="$1" marginTop="$2">
        {report.disclaimer}
        {ranAt ? ` · ${new Date(ranAt).toLocaleString()}` : ''}
      </Paragraph>
    </YStack>
  );
}
