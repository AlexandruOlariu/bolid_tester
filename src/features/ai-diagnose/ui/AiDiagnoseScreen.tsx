import React, { useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import { useIsFocused, useLocalSearchParams, useNavigation } from 'expo-router';
import { YStack, XStack, Card, Text, Paragraph, Button, Spinner } from 'tamagui';
import {
  Stethoscope,
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
import { Screen } from '@/shared/ui';
import { useSessionStore } from '@/shared/state/sessionStore';
import { describeDtc } from '@/shared/obd-core';
import type {
  AiReport,
  AiFinding,
  AiAction,
  DiagSeverity,
  DtcMake,
  OverallHealth,
} from '@/shared/obd-core';
import { useAiDiagnose } from '../hooks/useAiDiagnose';

const SEV_COLOR: Record<DiagSeverity, string> = {
  ok: '#2bb673',
  info: '#388bfd',
  warn: '#d29922',
  critical: '#f85149',
};

const SEV_LABEL: Record<DiagSeverity, string> = {
  ok: 'OK',
  info: 'INFO',
  warn: 'ATTENTION',
  critical: 'CRITICAL',
};

const OVERALL_META: Record<
  OverallHealth,
  { color: string; Icon: typeof ShieldCheck; label: string }
> = {
  ok: { color: '#2bb673', Icon: ShieldCheck, label: 'Looks healthy' },
  attention: { color: '#d29922', Icon: TriangleAlert, label: 'Needs attention' },
  urgent: { color: '#f85149', Icon: CircleAlert, label: 'Urgent' },
};

const ACTION_ICON: Record<AiAction['type'], typeof Eraser> = {
  clear_dtcs: Eraser,
  recheck: RefreshCw,
  inspect: Search,
  service: Wrench,
  monitor: Activity,
};

function OverallBanner({ report }: { report: AiReport }) {
  const meta = OVERALL_META[report.overall];
  const { Icon } = meta;
  return (
    <Card bordered padding="$4" borderLeftWidth={4} borderLeftColor={meta.color} gap="$2">
      <XStack alignItems="center" gap="$3">
        <Icon size={28} color={meta.color} />
        <YStack flex={1}>
          <Text fontWeight="900" fontSize="$7" color={meta.color}>
            {meta.label}
          </Text>
          <XStack alignItems="center" gap="$2">
            {report.source === 'ai' ? (
              <Sparkles size={13} color="#8B949E" />
            ) : (
              <Shield size={13} color="#8B949E" />
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

function FindingCard({ finding }: { finding: AiFinding }) {
  const color = SEV_COLOR[finding.severity];
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
      {finding.likelyCauses && finding.likelyCauses.length > 0 ? (
        <Paragraph theme="alt2" fontSize="$2" marginTop="$1">
          Likely causes: {finding.likelyCauses.join('; ')}.
        </Paragraph>
      ) : null}
    </Card>
  );
}

function ActionsView({
  actions,
  onClear,
  onRecheck,
}: {
  actions: AiAction[];
  onClear: () => void;
  onRecheck: () => void;
}) {
  if (actions.length === 0) return null;
  return (
    <YStack gap="$2">
      <Text fontWeight="800" fontSize="$5">
        Recommended actions
      </Text>
      {actions.map((a, i) => {
        const Icon = ACTION_ICON[a.type] ?? Activity;
        if (a.type === 'clear_dtcs')
          return (
            <Button
              key={`a-${i}`}
              theme="red"
              onPress={onClear}
              icon={() => <Eraser size={18} color="#fff" />}
            >
              {a.label || 'Clear fault codes'}
            </Button>
          );
        if (a.type === 'recheck')
          return (
            <Button key={`a-${i}`} onPress={onRecheck} icon={() => <RefreshCw size={18} />}>
              {a.label || 'Re-run diagnosis'}
            </Button>
          );
        return (
          <Card key={`a-${i}`} bordered padding="$3">
            <XStack alignItems="center" gap="$3">
              <Icon size={18} color="#8B949E" />
              <YStack flex={1}>
                <Text fontWeight="700">{a.label}</Text>
                {a.detail ? (
                  <Paragraph theme="alt2" fontSize="$2">
                    {a.detail}
                  </Paragraph>
                ) : null}
              </YStack>
            </XStack>
          </Card>
        );
      })}
    </YStack>
  );
}

function ReportView({
  report,
  notice,
  ranAt,
  onClear,
  onRecheck,
}: {
  report: AiReport;
  notice: string | null;
  ranAt: number | null;
  onClear: () => void;
  onRecheck: () => void;
}) {
  return (
    <YStack gap="$3">
      <OverallBanner report={report} />

      {notice ? (
        <Card bordered padding="$3" borderLeftWidth={3} borderLeftColor="#d29922">
          <Paragraph fontSize="$2">{notice}</Paragraph>
        </Card>
      ) : null}

      {report.findings.length > 0 ? (
        <YStack gap="$2">
          <Text fontWeight="800" fontSize="$5">
            Findings ({report.findings.length})
          </Text>
          {report.findings.map((f, i) => (
            <FindingCard key={`f-${i}`} finding={f} />
          ))}
        </YStack>
      ) : (
        <Paragraph theme="alt2">No specific issues were flagged.</Paragraph>
      )}

      <ActionsView actions={report.actions} onClear={onClear} onRecheck={onRecheck} />

      <Paragraph theme="alt2" fontSize="$1" marginTop="$2">
        {report.disclaimer}
        {ranAt ? ` · ${new Date(ranAt).toLocaleTimeString()}` : ''}
      </Paragraph>
    </YStack>
  );
}

/** Shown when the run is focused on one fault code (fault-codes detail sheet → "Explain with AI"). */
function FocusCard({ code, make }: { code: string; make?: DtcMake }) {
  return (
    <Card bordered padding="$3" borderLeftWidth={3} borderLeftColor="#388bfd" gap="$1">
      <Text fontWeight="800">Focused on fault code {code}</Text>
      <Paragraph theme="alt2" fontSize="$2">
        {describeDtc(code, make)}
      </Paragraph>
      <Paragraph theme="alt2" fontSize="$1">
        The report explains this code first: what it means, likely causes and what to check.
      </Paragraph>
    </Card>
  );
}

export function AiDiagnoseScreen() {
  const status = useSessionStore((s) => s.status);
  const { phase, progress, report, notice, error, ranAt, focusCode, make, busy, run, clearCodes } =
    useAiDiagnose();
  const params = useLocalSearchParams<{ focus?: string | string[] }>();
  const rawFocus = Array.isArray(params.focus) ? params.focus[0] : params.focus;
  const focusParam = rawFocus?.trim().toUpperCase() || undefined;

  // Arriving from "Explain with AI": run once for the focused code as soon as we are connected
  // AND this screen is in front, then consume the param. The screen is a (hidden) tab that stays
  // mounted, so without the focus gate a reconnect on another tab would start the run in the
  // background. The param is cleared on THIS route (`navigation.setParams`, not the global
  // `router.setParams`, which acts on whichever route is focused) — that is what lets a later
  // "Explain with AI" on the same code run again; the guard only stops a double run before the
  // cleared param arrives.
  const navigation = useNavigation<{ setParams(params: { focus?: string }): void }>();
  const isFocused = useIsFocused();
  const autoRanFor = useRef<string | null>(null);
  useEffect(() => {
    if (!focusParam) {
      autoRanFor.current = null;
      return;
    }
    if (!isFocused || status !== 'connected' || busy || autoRanFor.current === focusParam) return;
    autoRanFor.current = focusParam;
    void run({ focusCode: focusParam });
    navigation.setParams({ focus: undefined });
  }, [focusParam, isFocused, status, busy, run, navigation]);

  const shownFocus = focusParam ?? focusCode ?? undefined;
  // The main button always runs a full diagnosis; Recheck repeats the report's own run (focused
  // when the report was).
  const runFull = () => void run();
  const recheck = () => void run({ focusCode: focusCode ?? undefined });

  const confirmClear = () =>
    Alert.alert(
      'Clear fault codes?',
      'This erases stored/pending codes and resets readiness monitors. Codes will return if the fault persists.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear', style: 'destructive', onPress: () => void clearCodes() },
      ],
    );

  return (
    <Screen title="Diagnose (AI)" subtitle="One-tap health check of your car">
      {status !== 'connected' ? (
        <Card bordered padding="$3" borderLeftWidth={3} borderLeftColor="#d29922">
          <Paragraph fontSize="$3">
            Not connected. Pair your adapter on the Connect tab (or switch to the Simulator in
            Settings) to run a diagnosis.
          </Paragraph>
        </Card>
      ) : null}

      {shownFocus ? <FocusCard code={shownFocus} make={make} /> : null}

      <Button
        theme="green"
        size="$5"
        onPress={runFull}
        disabled={busy || status !== 'connected'}
        icon={busy ? () => <Spinner /> : () => <Stethoscope size={20} color="#fff" />}
      >
        {shownFocus ? 'Run full diagnosis' : report ? 'Re-run diagnosis' : 'Run diagnosis'}
      </Button>

      {busy ? (
        <XStack alignItems="center" gap="$3" paddingVertical="$2">
          <Spinner />
          <Paragraph theme="alt2">{progress ?? 'Working…'}</Paragraph>
        </XStack>
      ) : null}

      {error ? (
        <Card bordered padding="$3" borderLeftWidth={3} borderLeftColor="#f85149">
          <Paragraph color="$red10">{error}</Paragraph>
        </Card>
      ) : null}

      {report && !busy ? (
        <ReportView
          report={report}
          notice={notice}
          ranAt={ranAt}
          onClear={confirmClear}
          onRecheck={recheck}
        />
      ) : null}

      {!report && !busy && status === 'connected' && phase === 'idle' ? (
        <Paragraph theme="alt2" fontSize="$3">
          Tap “Run diagnosis” to read your car’s fault codes, readiness and live data and get a
          plain-language health report.
        </Paragraph>
      ) : null}
    </Screen>
  );
}
