/** How an AI diagnostic agent run starts (plan 34a): "What's wrong?" with a symptom field and
 *  **Investigate**, or **Check everything** (triage, then the agent looks over the whole car). The
 *  field stops at `MAX_SYMPTOM_CHARS` (300), the length the prompt clamps to. Investigate needs a
 *  typed symptom; neither starts while a run is going or without a connected car.
 *  See docs/features/ai-diagnose.md#agent. */
import React, { useState } from 'react';
import { Card, XStack, Input, Button } from 'tamagui';
import { Search, Stethoscope } from 'lucide-react-native';
import { MAX_SYMPTOM_CHARS } from '@/shared/obd-core';
import { SectionTitle } from '@/shared/ui';
import { useTranslation } from '@/shared/i18n';

export function AgentStartCard({
  busy,
  connected,
  onInvestigate,
  onCheckEverything,
}: {
  busy: boolean;
  connected: boolean;
  onInvestigate: (symptom: string) => void;
  onCheckEverything: () => void;
}) {
  const { t } = useTranslation('aiDiagnose');
  const [symptom, setSymptom] = useState('');
  const canStart = connected && !busy;
  const canInvestigate = canStart && symptom.trim() !== '';
  const investigate = () => {
    if (canInvestigate) onInvestigate(symptom.trim());
  };
  return (
    <Card bordered padding="$3" gap="$2">
      <SectionTitle>{t('agent.start.title')}</SectionTitle>
      <Input
        value={symptom}
        onChangeText={setSymptom}
        maxLength={MAX_SYMPTOM_CHARS}
        placeholder={t('agent.start.placeholder')}
        editable={!busy}
        onSubmitEditing={investigate}
        returnKeyType="go"
        accessibilityLabel={t('agent.start.inputA11y')}
      />
      <XStack gap="$2" flexWrap="wrap">
        <Button
          flex={1}
          theme="green"
          onPress={investigate}
          disabled={!canInvestigate}
          accessibilityState={{ disabled: !canInvestigate }}
          icon={<Search size={18} />}
        >
          {t('agent.start.investigate')}
        </Button>
        <Button
          flex={1}
          onPress={onCheckEverything}
          disabled={!canStart}
          accessibilityState={{ disabled: !canStart }}
          icon={<Stethoscope size={18} />}
        >
          {t('agent.start.checkEverything')}
        </Button>
      </XStack>
    </Card>
  );
}
