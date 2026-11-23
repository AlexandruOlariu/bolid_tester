/** The trail of an AI diagnostic agent run (plan 34a): one row per step (status icon, the
 *  translated label, the model's one-line "why" and the digest it read behind "Show data"). While
 *  the run is going the header shows the step in progress against the budget with **Stop**, which
 *  stays visible for the whole run; after the run the header collapses and expands the rows.
 *  History re-opens a saved run's stored trail (`TrailRow`s, plan 34d) collapsed and read-only.
 *  See docs/features/ai-diagnose.md#agent. */
import React, { useState } from 'react';
import { Card, XStack, YStack, Text, Paragraph, Button } from 'tamagui';
import { Check, ChevronDown, ChevronUp, Square, TriangleAlert, X } from 'lucide-react-native';
import type { AgentStep } from '@/shared/obd-core';
import type { TrailRow } from '@/shared/state/historyStore';
import { HIT_SLOP, SectionTitle, usePalette, type Tone } from '@/shared/ui';
import { useTranslation } from '@/shared/i18n';

/** ✓ ok, ⚠ error, ✕ the driver could not / the step was refused. */
const STATUS_META: Record<AgentStep['status'], { Icon: typeof Check; tone: Tone }> = {
  ok: { Icon: Check, tone: 'statusOk' },
  error: { Icon: TriangleAlert, tone: 'statusWarn' },
  cant: { Icon: X, tone: 'statusError' },
  refused: { Icon: X, tone: 'statusError' },
};

type Translate = ReturnType<typeof useTranslation>['t'];

/** The step's translated label. `open_skill` / `run_skill` labels carry the skill's id as `name`
 *  (`used_car_check`); it is shown by its translated name (`agent.skillName.<id>`), falling back to
 *  the id with spaces for a skill without one. */
export function stepLabel(t: Translate, label: TrailRow['label']): string {
  const values = label.values ?? {};
  const name = values.name;
  if (typeof name !== 'string') return t(label.key, values);
  const shown = t(`aiDiagnose:agent.skillName.${name}`, { defaultValue: name.replace(/_/g, ' ') });
  return t(label.key, { ...values, name: shown });
}

function StepRow({ step }: { step: TrailRow }) {
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
        <Text fontWeight="700">{stepLabel(t, step.label)}</Text>
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
  initiallyExpanded = true,
}: {
  trail: ReadonlyArray<TrailRow>;
  running: boolean;
  stepsUsed: number;
  maxSteps: number;
  onStop: () => void;
  /** After the run: the header toggles the rows. */
  collapsible: boolean;
  /** Whether a collapsible trail starts with its rows shown (History starts it collapsed). */
  initiallyExpanded?: boolean;
}) {
  const { t } = useTranslation('aiDiagnose');
  const palette = usePalette();
  const [expanded, setExpanded] = useState(initiallyExpanded);
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
