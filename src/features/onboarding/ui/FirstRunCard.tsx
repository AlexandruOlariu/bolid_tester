import React, { useEffect, useRef } from 'react';
import { useRouter } from 'expo-router';
import { Button, Card, Paragraph, Text, XStack, YStack } from 'tamagui';
import { CheckCircle2, ChevronRight, Circle, X } from 'lucide-react-native';
import { useSessionStore } from '@/shared/state/sessionStore';
import { useVehicleStore } from '@/features/vehicle-select/model/vehicleStore';
import { useDtcStore } from '@/shared/state/dtcStore';
import { useOnboardingStore } from '@/shared/state/onboardingStore';
import {
  FIRST_RUN_GENERIC_OK_ID,
  FIRST_RUN_HINT_ID,
  firstRunComplete,
  firstRunSteps,
  type FirstRunInput,
} from '../model/firstRun';
import { HIT_SLOP, usePalette } from '@/shared/ui';

/** Three-step first-run guide on the Connect tab: pick car → connect → read faults. Dismissible like a
 *  `HintCard` (id `first-run`) and dismisses itself when it sees the last open step get done, so it
 *  never returns after a restart. Step state comes from the vehicle, session and DTC stores.
 *  Only that transition dismisses it: after Settings → **Show hints again** the card comes back even
 *  when every step is already done this session (all ticked), and stays until the user closes it. */
export function FirstRunCard() {
  const router = useRouter();
  const dismissed = useOnboardingStore((s) => s.dismissed);
  const dismiss = useOnboardingStore((s) => s.dismiss);
  const selectedProfileId = useVehicleStore((s) => s.selectedProfileId);
  const connectionStatus = useSessionStore((s) => s.status);
  const dtcLastReadAt = useDtcStore((s) => s.lastReadAt);

  const hidden = dismissed.includes(FIRST_RUN_HINT_ID);
  const input: FirstRunInput = {
    selectedProfileId,
    genericAccepted: dismissed.includes(FIRST_RUN_GENERIC_OK_ID),
    connectionStatus,
    dtcLastReadAt,
  };
  const complete = firstRunComplete(input);
  // Whether every step was already done on the previous render: auto-dismiss on the change to
  // complete only, not merely because the steps are done (see the doc comment).
  const wasComplete = useRef(complete);

  useEffect(() => {
    if (complete && !wasComplete.current && !hidden) dismiss(FIRST_RUN_HINT_ID);
    wasComplete.current = complete;
  }, [complete, hidden, dismiss]);

  const palette = usePalette();
  const doneColour = palette.accent;
  const todoColour = palette.muted;

  if (hidden) return null;
  const steps = firstRunSteps(input);

  return (
    <Card bordered padding="$3" backgroundColor="$blue2" borderColor="$blue7">
      <YStack gap="$2">
        <XStack alignItems="center" gap="$2">
          <Text flex={1} fontWeight="800" fontSize="$4">
            Getting started
          </Text>
          <XStack
            padding="$2"
            hitSlop={HIT_SLOP}
            pressStyle={{ opacity: 0.6 }}
            accessible
            accessibilityRole="button"
            accessibilityLabel="Dismiss the getting started guide"
            onPress={() => dismiss(FIRST_RUN_HINT_ID)}
          >
            <X size={18} color={todoColour} />
          </XStack>
        </XStack>
        {steps.map((step, n) => (
          <YStack key={step.id} gap="$1">
            <XStack
              gap="$2"
              alignItems="center"
              minHeight={44}
              pressStyle={{ opacity: 0.6 }}
              accessible
              accessibilityRole="button"
              accessibilityLabel={`Step ${n + 1}: ${step.title}${step.done ? ', done' : ''}`}
              onPress={() => router.push(step.route)}
            >
              {step.done ? (
                <CheckCircle2 size={20} color={doneColour} />
              ) : (
                <Circle size={20} color={todoColour} />
              )}
              <YStack flex={1}>
                <Text
                  fontWeight="700"
                  fontSize="$3"
                  textDecorationLine={step.done ? 'line-through' : 'none'}
                >
                  {n + 1}. {step.title}
                </Text>
                {!step.done ? (
                  <Paragraph theme="alt2" size="$2">
                    {step.hint}
                  </Paragraph>
                ) : null}
              </YStack>
              <ChevronRight size={18} color={todoColour} />
            </XStack>
            {step.id === 'vehicle' && !step.done ? (
              <XStack paddingLeft="$6">
                <Button
                  size="$3"
                  hitSlop={HIT_SLOP}
                  chromeless
                  onPress={() => dismiss(FIRST_RUN_GENERIC_OK_ID)}
                >
                  Use Auto / Generic
                </Button>
              </XStack>
            ) : null}
          </YStack>
        ))}
      </YStack>
    </Card>
  );
}
