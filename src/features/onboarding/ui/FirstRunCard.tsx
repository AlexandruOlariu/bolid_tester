import React, { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { Button, Card, Paragraph, Text, XStack, YStack } from 'tamagui';
import { CheckCircle2, ChevronRight, Circle, X } from 'lucide-react-native';
import { useSessionStore } from '@/shared/state/sessionStore';
import { useVehicleStore } from '@/features/vehicle-select/model/vehicleStore';
import { useDtcStore } from '@/shared/state/dtcStore';
import { useOnboardingStore } from '../model/onboardingStore';
import {
  FIRST_RUN_GENERIC_OK_ID,
  FIRST_RUN_HINT_ID,
  firstRunComplete,
  firstRunSteps,
  type FirstRunInput,
} from '../model/firstRun';

const DONE = '#2bb673';
const TODO = '#8B949E';

/** Three-step first-run guide on the Connect tab: pick car → connect → read faults. Dismissible like a
 *  `HintCard` (id `first-run`) and dismisses itself the first time every step is done, so it never
 *  returns after a restart. Step state comes from the vehicle, session and DTC stores. */
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

  useEffect(() => {
    if (complete && !hidden) dismiss(FIRST_RUN_HINT_ID);
  }, [complete, hidden, dismiss]);

  if (hidden || complete) return null;
  const steps = firstRunSteps(input);

  return (
    <Card bordered padding="$3" backgroundColor="$blue2" borderColor="$blue7">
      <YStack gap="$2">
        <XStack alignItems="center" gap="$2">
          <Text flex={1} fontWeight="800" fontSize="$4">
            Getting started
          </Text>
          <XStack
            padding="$1"
            pressStyle={{ opacity: 0.6 }}
            accessibilityRole="button"
            accessibilityLabel="Dismiss the getting started guide"
            onPress={() => dismiss(FIRST_RUN_HINT_ID)}
          >
            <X size={18} color={TODO} />
          </XStack>
        </XStack>
        {steps.map((step, n) => (
          <YStack key={step.id} gap="$1">
            <XStack
              gap="$2"
              alignItems="center"
              pressStyle={{ opacity: 0.6 }}
              accessibilityRole="button"
              accessibilityLabel={`Step ${n + 1}: ${step.title}${step.done ? ', done' : ''}`}
              onPress={() => router.push(step.route)}
            >
              {step.done ? (
                <CheckCircle2 size={20} color={DONE} />
              ) : (
                <Circle size={20} color={TODO} />
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
              <ChevronRight size={18} color={TODO} />
            </XStack>
            {step.id === 'vehicle' && !step.done ? (
              <XStack paddingLeft="$6">
                <Button size="$2" chromeless onPress={() => dismiss(FIRST_RUN_GENERIC_OK_ID)}>
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
