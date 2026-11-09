import React, { useEffect, useRef, useState } from 'react';
import { useIsFocused, useLocalSearchParams, useNavigation } from 'expo-router';
import { YStack, XStack, Card, Text, Paragraph, Button, Spinner, Input } from 'tamagui';
import { Stethoscope, Eraser, RefreshCw, Activity, MessageCircle, Send } from 'lucide-react-native';
import { Screen, appAlert } from '@/shared/ui';
import { useSessionStore } from '@/shared/state/sessionStore';
import { describeDtc, followUpSuggestions } from '@/shared/obd-core';
import type { AiChatMessage, AiReport, AiAction, DtcMake } from '@/shared/obd-core';
import { ACTION_ICON, OverallBanner, FindingCard } from './AiReportView';
import { useAiDiagnose } from '../hooks/useAiDiagnose';

function Bubble({ message }: { message: AiChatMessage }) {
  const mine = message.role === 'user';
  return (
    <XStack justifyContent={mine ? 'flex-end' : 'flex-start'}>
      <YStack
        maxWidth="88%"
        padding="$2"
        borderRadius="$4"
        backgroundColor={mine ? '$green5' : '$color3'}
        testID={mine ? 'followup-question' : 'followup-answer'}
      >
        <Text fontSize="$3" selectable>
          {message.content}
        </Text>
      </YStack>
    </XStack>
  );
}

/** "Ask about this report" (plan 19): suggestion chips, a free-text question and the conversation
 *  as alternating bubbles. Disabled for an on-device (rule-based) report. */
function FollowUpCard({
  report,
  focusCode,
  conversation,
  asking,
  askError,
  onAsk,
  onClear,
}: {
  report: AiReport;
  focusCode: string | null;
  conversation: AiChatMessage[];
  asking: boolean;
  askError: string | null;
  onAsk: (question: string) => void;
  onClear: () => void;
}) {
  const [draft, setDraft] = useState('');
  const disabled = report.source === 'local';
  const send = (q: string) => {
    if (!q.trim() || asking || disabled) return;
    onAsk(q);
    setDraft('');
  };
  return (
    <Card bordered padding="$3" gap="$2">
      <XStack alignItems="center" gap="$2">
        <MessageCircle size={18} color="#8B949E" />
        <Text fontWeight="800" fontSize="$5" flex={1}>
          Ask about this report
        </Text>
        {conversation.length > 0 ? (
          <Button
            size="$2"
            chromeless
            onPress={onClear}
            accessibilityLabel="Clear the conversation"
          >
            Clear
          </Button>
        ) : null}
      </XStack>
      {disabled ? (
        <Paragraph theme="alt2" fontSize="$2">
          Follow-up questions need an AI provider. This report came from the on-device rules; set up
          a provider in Settings → AI assistant and re-run the diagnosis.
        </Paragraph>
      ) : (
        <>
          <XStack flexWrap="wrap" gap="$2">
            {followUpSuggestions(report, focusCode).map((q) => (
              <Button key={q} size="$2" theme="blue" disabled={asking} onPress={() => send(q)}>
                {q}
              </Button>
            ))}
          </XStack>
          {conversation.map((m, i) => (
            <Bubble key={`m-${i}`} message={m} />
          ))}
          {asking ? (
            <XStack alignItems="center" gap="$2">
              <Spinner />
              <Paragraph theme="alt2" fontSize="$2">
                Asking the AI…
              </Paragraph>
            </XStack>
          ) : null}
          {askError ? (
            <Paragraph color="$red10" fontSize="$2">
              {askError}
            </Paragraph>
          ) : null}
          <XStack gap="$2" alignItems="center">
            <Input
              flex={1}
              value={draft}
              onChangeText={setDraft}
              placeholder="Ask a question about this report"
              editable={!asking}
              onSubmitEditing={() => send(draft)}
              returnKeyType="send"
              accessibilityLabel="Follow-up question"
            />
            <Button
              theme="green"
              disabled={asking || !draft.trim()}
              onPress={() => send(draft)}
              icon={() => <Send size={16} color="#fff" />}
              accessibilityLabel="Send the question"
            />
          </XStack>
        </>
      )}
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
  profileId,
  onClear,
  onRecheck,
  followUp,
}: {
  report: AiReport;
  notice: string | null;
  ranAt: number | null;
  profileId: string;
  onClear: () => void;
  onRecheck: () => void;
  followUp: React.ReactNode;
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
            <FindingCard key={`f-${i}`} finding={f} profileId={profileId} />
          ))}
        </YStack>
      ) : (
        <Paragraph theme="alt2">No specific issues were flagged.</Paragraph>
      )}

      <ActionsView actions={report.actions} onClear={onClear} onRecheck={onRecheck} />

      {followUp}

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
  const {
    phase,
    progress,
    report,
    notice,
    error,
    ranAt,
    focusCode,
    make,
    guideProfileId,
    busy,
    run,
    clearCodes,
    conversation,
    asking,
    askError,
    ask,
    clearConversation,
  } = useAiDiagnose();
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
    appAlert(
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
          profileId={guideProfileId}
          onClear={confirmClear}
          onRecheck={recheck}
          followUp={
            <FollowUpCard
              report={report}
              focusCode={focusCode}
              conversation={conversation}
              asking={asking}
              askError={askError}
              onAsk={(q) => void ask(q)}
              onClear={clearConversation}
            />
          }
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
