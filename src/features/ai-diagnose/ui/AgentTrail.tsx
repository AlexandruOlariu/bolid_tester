/** The trail of an AI diagnostic agent run (plan 34a): one row per step (status icon, the
 *  translated label, the model's one-line "why" and the digest it read behind "Show data"). While
 *  the run is going the header shows the step in progress against the budget with **Stop**, which
 *  stays visible for the whole run; after the run the header collapses and expands the rows.
 *  See docs/features/ai-diagnose.md#agent. */
import React, { useState } from 'react';
import { Card, XStack, YStack, Text, Paragraph, Button } from 'tamagui';
import { Check, ChevronDown, ChevronUp, Square, TriangleAlert, X } from 'lucide-react-native';
import type { AgentStep } from '@/shared/obd-core';
import { HIT_SLOP, SectionTitle, usePalette, type Tone } from '@/shared/ui';
import { useTranslation } from '@/shared/i18n';

/** ✓ ok, ⚠ error, ✕ the driver could not / the step was refused. */
const STATUS_META: Record<AgentStep['status'], { Icon: typeof Check; tone: Tone }> = {
  ok: { Icon: Check, tone: 'statusOk' },
  error: { Icon: TriangleAlert, tone: 'statusWarn' },
  cant: { Icon: X, tone: 'statusError' },
  refused: { Icon: X, tone: 'statusError' },
};

function StepRow({ step }: { step: AgentStep }) {
  const { t } = useTranslation('aiDiagnose');
  const palette = usePalette();
  const [showData, setShowData] = useState(false);
  const { Icon, tone } = STATUS_META[step.status];
  return (
    <XStack gap="$2" alignItems="flex-start" testID="agent-step">
      <YStack paddingTop="$1">
        <Icon size={16} color={palette[tone]} />
      </YStack>
      <YStack flex={1} gap="$1">
        <Text fontWeight="700">{t(step.label.key, step.label.values ?? {})}</Text>
        {step.why ? (
          <Paragraph theme="alt2" fontSize="$2">
            {step.why}
          </Paragraph>
        ) : null}
        {step.digest ? (
          <>
            <Button
              size="$3"
              chromeless
              alignSelf="flex-start"
              hitSlop={HIT_SLOP}
              paddingHorizontal={0}
              onPress={() => setShowData((v) => !v)}
              accessibilityState={{ expanded: showData }}
            >
              {showData ? t('agent.trail.hideData') : t('agent.trail.showData')}
            </Button>
            {showData ? (
              <Paragraph
                fontSize="$1"
                fontFamily="$mono"
                backgroundColor="$color2"
                padding="$2"
                borderRadius="$3"
                selectable
              >
                {step.digest}
              </Paragraph>
            ) : null}
          </>
        ) : null}
      </YStack>
    </XStack>
  );
}

export function AgentTrail({
  trail,
  running,
  stepsUsed,
  maxSteps,
  onStop,
  collapsible,
}: {
  trail: AgentStep[];
  running: boolean;
  stepsUsed: number;
  maxSteps: number;
  onStop: () => void;
  /** After the run: the header toggles the rows. */
  collapsible: boolean;
}) {
  const { t } = useTranslation('aiDiagnose');
  const palette = usePalette();
  const [expanded, setExpanded] = useState(true);
  const open = running || !collapsible || expanded;
  // The step in progress: triage is step 1, so a run that has used n steps is working on n + 1.
  const current = Math.min(stepsUsed + 1, maxSteps);
  return (
    <Card bordered padding="$3" gap="$2">
      {running ? (
        <XStack alignItems="center" gap="$2">
          <SectionTitle flex={1}>
            {t('agent.trail.progress', { n: current, max: maxSteps })}
          </SectionTitle>
          <Button
            size="$3"
            theme="red"
            hitSlop={HIT_SLOP}
            onPress={onStop}
            icon={<Square size={14} />}
            accessibilityLabel={t('agent.trail.stopA11y')}
          >
            {t('agent.trail.stop')}
          </Button>
        </XStack>
      ) : collapsible ? (
        <Button
          chromeless
          justifyContent="space-between"
          paddingHorizontal={0}
          onPress={() => setExpanded((v) => !v)}
          accessibilityState={{ expanded }}
          iconAfter={
            expanded ? (
              <ChevronUp size={18} color={palette.muted} />
            ) : (
              <ChevronDown size={18} color={palette.muted} />
            )
          }
        >
          {t('agent.trail.title', { count: trail.length })}
        </Button>
      ) : (
        <SectionTitle>{t('agent.trail.title', { count: trail.length })}</SectionTitle>
      )}
      {open ? trail.map((s) => <StepRow key={`step-${s.id}`} step={s} />) : null}
    </Card>
  );
}
