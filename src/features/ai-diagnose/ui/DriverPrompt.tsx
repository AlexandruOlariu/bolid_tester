/** The driver prompt of an AI diagnostic agent run (plan 34a): one instruction from the fixed list
 *  (`DRIVER_INSTRUCTIONS`), the reminder that the car must stay stationary, and **Done** /
 *  **Can't** — plus one button per answer choice when the instruction asks a question (each choice
 *  reads `aiDiagnose:agent.driverChoice.<value>`). The run waits for the answer; the stationary
 *  check and the timeout live in the agent loop. See docs/features/ai-diagnose.md#agent. */
import React from 'react';
import { Card, XStack, Text, Paragraph, Button } from 'tamagui';
import { Car } from 'lucide-react-native';
import { DRIVER_INSTRUCTIONS } from '@/shared/obd-core';
import type { DriverInstructionId, DriverReply } from '@/shared/obd-core';
import { usePalette } from '@/shared/ui';
import { useTranslation } from '@/shared/i18n';

export function DriverPrompt({
  id,
  onAnswer,
}: {
  id: DriverInstructionId;
  onAnswer: (reply: DriverReply) => void;
}) {
  const { t } = useTranslation('aiDiagnose');
  const palette = usePalette();
  const instruction = DRIVER_INSTRUCTIONS[id];
  return (
    <Card
      bordered
      padding="$3"
      gap="$2"
      borderLeftWidth={3}
      borderLeftColor="$statusInfo"
      testID="driver-prompt"
    >
      <XStack alignItems="center" gap="$2">
        <Car size={20} color={palette.statusInfo} />
        <Text flex={1} fontWeight="800" fontSize="$5" accessibilityRole="header">
          {t(instruction.labelKey)}
        </Text>
      </XStack>
      <Paragraph theme="alt2" fontSize="$2">
        {t('agent.driverPrompt.stationary')}
      </Paragraph>
      <XStack gap="$2" flexWrap="wrap">
        {(instruction.choices ?? []).map((value) => (
          <Button
            key={value}
            flex={1}
            theme="blue"
            onPress={() => onAnswer({ kind: 'choice', value })}
          >
            {t(`agent.driverChoice.${value}`)}
          </Button>
        ))}
        <Button flex={1} theme="green" onPress={() => onAnswer({ kind: 'done' })}>
          {t('agent.driverPrompt.done')}
        </Button>
        <Button flex={1} onPress={() => onAnswer({ kind: 'cant' })}>
          {t('agent.driverPrompt.cant')}
        </Button>
      </XStack>
    </Card>
  );
}
