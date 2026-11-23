import React, { useEffect, useRef, useState } from 'react';
import { useIsFocused, useLocalSearchParams, useNavigation } from 'expo-router';
import { YStack, XStack, Card, Text, Paragraph, Button, Spinner, Input } from 'tamagui';
import { Eraser, RefreshCw, Activity, MessageCircle, Send } from 'lucide-react-native';
import { Screen, appAlert, SectionTitle, HIT_SLOP, usePalette } from '@/shared/ui';
import { useSessionStore } from '@/shared/state/sessionStore';
import { describeDtc, followUpSuggestions } from '@/shared/obd-core';
import type {
  AgentContribution,
  AiChatMessage,
  AiReport,
  AiAction,
  DtcMake,
} from '@/shared/obd-core';
import { ACTION_ICON, OverallBanner, FindingCard, UncitedNotice } from './AiReportView';
import { AgentStartCard } from './AgentStartCard';
import { AgentTrail } from './AgentTrail';
import { DriverPrompt } from './DriverPrompt';
import { useAiDiagnose, type DriverAnswerListener } from '../hooks/useAiDiagnose';
import { useTranslation } from '@/shared/i18n';
import { formatTime } from '@/shared/lib/format';

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
 *  as alternating bubbles; the answers read the run's trail (plan 34a). Disabled for an on-device
 *  (rule-based) report. */
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
  const { t } = useTranslation('aiDiagnose');
  const [draft, setDraft] = useState('');
  const palette = usePalette();
  const disabled = report.source === 'local';
  const send = (q: string) => {
    if (!q.trim() || asking || disabled) return;
    onAsk(q);
    setDraft('');
  };
  return (
    <Card bordered padding="$3" gap="$2">
      <XStack alignItems="center" gap="$2">
        <MessageCircle size={18} color={palette.muted} />
        <SectionTitle flex={1}>{t('followUp.title')}</SectionTitle>
        {conversation.length > 0 ? (
          <Button
            size="$3"
            hitSlop={HIT_SLOP}
            chromeless
            onPress={onClear}
            accessibilityLabel={t('followUp.clearA11y')}
          >
            {t('followUp.clear')}
          </Button>
        ) : null}
      </XStack>
      {disabled ? (
        <Paragraph theme="alt2" fontSize="$2">
          {t('followUp.needsProvider')}
        </Paragraph>
      ) : (
        <>
          <XStack flexWrap="wrap" gap="$2">
            {followUpSuggestions(report, focusCode).map((q) => (
              <Button
                key={q}
                size="$3"
                hitSlop={HIT_SLOP}
                theme="blue"
                disabled={asking}
                onPress={() => send(q)}
              >
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
                {t('followUp.asking')}
              </Paragraph>
            </XStack>
          ) : null}
          {askError ? (
            <Paragraph color="$statusError" fontSize="$2">
              {askError}
            </Paragraph>
          ) : null}
          <XStack gap="$2" alignItems="center">
            <Input
              flex={1}
              value={draft}
              onChangeText={setDraft}
              placeholder={t('followUp.placeholder')}
              editable={!asking}
              onSubmitEditing={() => send(draft)}
              returnKeyType="send"
              accessibilityLabel={t('followUp.inputA11y')}
            />
            <Button
              theme="green"
              disabled={asking || !draft.trim()}
              onPress={() => send(draft)}
              icon={<Send size={16} />}
              accessibilityLabel={t('followUp.sendA11y')}
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
  const { t } = useTranslation('aiDiagnose');
  const palette = usePalette();
  if (actions.length === 0) return null;
  return (
    <YStack gap="$2">
      <SectionTitle>{t('actions')}</SectionTitle>
      {actions.map((a, i) => {
        const Icon = ACTION_ICON[a.type] ?? Activity;
        if (a.type === 'clear_dtcs')
          return (
            <Button key={`a-${i}`} theme="red" onPress={onClear} icon={<Eraser size={18} />}>
              {a.label || t('clearCodes')}
            </Button>
          );
        if (a.type === 'recheck')
          return (
            <Button key={`a-${i}`} onPress={onRecheck} icon={() => <RefreshCw size={18} />}>
              {a.label || t('rerun')}
            </Button>
          );
        return (
          <Card key={`a-${i}`} bordered padding="$3">
            <XStack alignItems="center" gap="$3">
              <Icon size={18} color={palette.muted} />
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
  const { t } = useTranslation('aiDiagnose');
  return (
    <YStack gap="$3">
      <OverallBanner report={report} />

      {notice ? (
        <Card bordered padding="$3" borderLeftWidth={3} borderLeftColor="$statusWarn">
          <Paragraph fontSize="$2">{notice}</Paragraph>
        </Card>
      ) : null}

      <UncitedNotice report={report} />

      {report.findings.length > 0 ? (
        <YStack gap="$2">
          <SectionTitle>{t('findings', { count: report.findings.length })}</SectionTitle>
          {report.findings.map((f, i) => (
            <FindingCard key={`f-${i}`} finding={f} profileId={profileId} />
          ))}
        </YStack>
      ) : (
        <Paragraph theme="alt2">{t('noIssues')}</Paragraph>
      )}

      <ActionsView actions={report.actions} onClear={onClear} onRecheck={onRecheck} />

      {followUp}

      <Paragraph theme="alt2" fontSize="$1" marginTop="$2">
        {report.disclaimer}
        {ranAt ? ` · ${formatTime(ranAt, true)}` : ''}
      </Paragraph>
    </YStack>
  );
}

/** Shown when the run is focused on one fault code (fault-codes detail sheet → "Explain with AI"). */
function FocusCard({ code, make }: { code: string; make?: DtcMake }) {
  const { t } = useTranslation('aiDiagnose');
  return (
    <Card bordered padding="$3" borderLeftWidth={3} borderLeftColor="$statusInfo" gap="$1">
      <Text fontWeight="800">{t('focus.title', { code })}</Text>
      <Paragraph theme="alt2" fontSize="$2">
        {describeDtc(code, make)}
      </Paragraph>
      <Paragraph theme="alt2" fontSize="$1">
        {t('focus.help')}
      </Paragraph>
    </Card>
  );
}

/** No feature contributions: the agent runs with the core tools only. */
const NO_CONTRIBUTIONS: AgentContribution[] = [];

/** The AI diagnose screen (plans 11, 19, 34a): describe a symptom and **Investigate**, or **Check
 *  everything**; the agent run's trail with **Stop** and the driver prompt; then the cited report
 *  with Re-run (the last request again), Clear codes (its confirmation, then a triage-only re-read)
 *  and follow-up questions over the trail. `contributions`: the agent tools and skills the app
 *  layer composes (`src/app/ai-diagnose.tsx`). `onDriverAnswer`: called after each answer to the
 *  driver prompt (plan 34c: the route starts the simulator's rev hold on "hold 2500 rpm"). */
export function AiDiagnoseScreen({
  contributions = NO_CONTRIBUTIONS,
  onDriverAnswer,
}: {
  contributions?: AgentContribution[];
  onDriverAnswer?: DriverAnswerListener;
}) {
  const { t } = useTranslation('aiDiagnose');
  const status = useSessionStore((s) => s.status);
  const {
    phase,
    progress,
    report,
    notice,
    error,
    ranAt,
    focusCode,
    request,
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
    trail,
    stepsUsed,
    maxSteps,
    driver,
    investigate,
    checkEverything,
    rerun,
    stop,
    answerDriver,
  } = useAiDiagnose(contributions, onDriverAnswer);
  const params = useLocalSearchParams<{ focus?: string | string[] }>();
  const rawFocus = Array.isArray(params.focus) ? params.focus[0] : params.focus;
  const focusParam = rawFocus?.trim().toUpperCase() || undefined;
  // The triage-only re-read after Clear codes is not an agent run: no Stop, no step counter.
  const [clearing, setClearing] = useState(false);
  const connected = status === 'connected';
  const running = busy && !clearing;

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
    if (!isFocused || !connected || busy || autoRanFor.current === focusParam) return;
    autoRanFor.current = focusParam;
    void run({ focusCode: focusParam });
    navigation.setParams({ focus: undefined });
  }, [focusParam, isFocused, connected, busy, run, navigation]);

  const shownFocus = focusParam ?? focusCode ?? undefined;

  const confirmClear = () =>
    appAlert(t('clear.title'), t('clear.body'), [
      { text: t('common:actions.cancel'), style: 'cancel' },
      {
        text: t('clear.confirm'),
        style: 'destructive',
        onPress: () => {
          setClearing(true);
          void clearCodes().finally(() => setClearing(false));
        },
      },
    ]);

  return (
    <Screen title={t('title')} subtitle={t('subtitle')}>
      {!connected ? (
        <Card bordered padding="$3" borderLeftWidth={3} borderLeftColor="$statusWarn">
          <Paragraph fontSize="$3">{t('notConnected')}</Paragraph>
        </Card>
      ) : null}

      {shownFocus ? <FocusCard code={shownFocus} make={make} /> : null}

      <AgentStartCard
        busy={busy}
        connected={connected}
        onInvestigate={(symptom) => void investigate(symptom)}
        onCheckEverything={() => void checkEverything()}
      />

      {running || trail.length > 0 ? (
        <AgentTrail
          trail={trail}
          running={running}
          stepsUsed={stepsUsed}
          maxSteps={maxSteps}
          onStop={stop}
          collapsible={!running}
        />
      ) : null}

      {running && driver ? <DriverPrompt id={driver} onAnswer={answerDriver} /> : null}

      {busy && !driver ? (
        <XStack alignItems="center" gap="$3" paddingVertical="$2">
          <Spinner />
          <Paragraph theme="alt2">{progress ?? t('working')}</Paragraph>
        </XStack>
      ) : null}

      {error ? (
        <Card bordered padding="$3" borderLeftWidth={3} borderLeftColor="$statusError">
          <Paragraph color="$statusError">{error}</Paragraph>
        </Card>
      ) : null}

      {report && !busy ? (
        <>
          {request ? (
            <Button
              onPress={() => void rerun()}
              disabled={!connected}
              accessibilityState={{ disabled: !connected }}
              icon={<RefreshCw size={18} />}
            >
              {t('rerun')}
            </Button>
          ) : null}
          <ReportView
            report={report}
            notice={notice}
            ranAt={ranAt}
            profileId={guideProfileId}
            onClear={confirmClear}
            onRecheck={() => void rerun()}
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
        </>
      ) : null}

      {!report && !busy && connected && phase === 'idle' ? (
        <Paragraph theme="alt2" fontSize="$3">
          {t('intro')}
        </Paragraph>
      ) : null}
    </Screen>
  );
}
