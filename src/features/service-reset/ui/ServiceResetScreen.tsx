import React, { useState } from 'react';
import { YStack, XStack, Paragraph, H4, Button } from 'tamagui';
import { Screen } from '@/shared/ui';
import { useServiceResetStore } from '../model/serviceResetStore';
import { useServiceReset } from '../hooks/useServiceReset';

export function ServiceResetScreen() {
  const { available, descriptor, run } = useServiceReset();
  const running = useServiceResetStore((s) => s.running);
  const lastResult = useServiceResetStore((s) => s.lastResult);
  const [confirming, setConfirming] = useState(false);

  if (!available || !descriptor) {
    return (
      <Screen title="Service reset">
        <Paragraph theme="alt2">
          Service-interval reset is unavailable for this car / protocol. It is experimental and
          profile-gated — it needs a CAN (UDS) link, or a K-line (KWP2000) link for cars that use it.
        </Paragraph>
      </Screen>
    );
  }

  return (
    <Screen
      title="Service reset"
      subtitle="⚠ Experimental — writes to the instrument cluster. Confirm on the dash afterwards."
    >
      <YStack gap="$2" backgroundColor="$color2" padding="$3" borderRadius="$4">
        <H4>{descriptor.module}</H4>
        <Paragraph theme="alt2" size="$2">
          Method: {descriptor.method}
          {descriptor.routineId ? ` · routine ${descriptor.routineId}` : ''} · header{' '}
          {descriptor.reqHeader}
        </Paragraph>
      </YStack>

      {lastResult ? <Paragraph>{lastResult}</Paragraph> : null}

      {descriptor.manualProcedure && descriptor.manualProcedure.length > 0 ? (
        <YStack gap="$2" backgroundColor="$color2" padding="$3" borderRadius="$4">
          <H4>Manual procedure</H4>
          <Paragraph theme="alt2" size="$2">
            The reliable reset for this car. Use it if the OBD reset above does not complete.
          </Paragraph>
          {descriptor.manualProcedure.map((step, i) => (
            <Paragraph key={i} size="$2">
              {i + 1}. {step}
            </Paragraph>
          ))}
        </YStack>
      ) : null}

      {!confirming ? (
        <Button theme="red" onPress={() => setConfirming(true)} disabled={running}>
          Reset service interval
        </Button>
      ) : (
        <XStack gap="$2">
          <Button
            flex={1}
            theme="red"
            disabled={running}
            onPress={async () => {
              setConfirming(false);
              await run();
            }}
          >
            {running ? 'Resetting…' : 'Confirm reset'}
          </Button>
          <Button flex={1} onPress={() => setConfirming(false)} disabled={running}>
            Cancel
          </Button>
        </XStack>
      )}
    </Screen>
  );
}
