import React, { useState } from 'react';
import { YStack, XStack, Paragraph, H4, Button, Switch } from 'tamagui';
import { Screen } from '@/shared/ui';
import type { GuidedRoutine } from '@/shared/vehicles';
import { useRoutinesStore } from '../model/routinesStore';
import { useRoutines } from '../hooks/useRoutines';

function RoutineRow({ routine }: { routine: GuidedRoutine }) {
  const { start, stop } = useRoutines();
  const unlocked = useRoutinesStore((s) => s.unlocked);
  const activeId = useRoutinesStore((s) => s.activeId);
  const phase = useRoutinesStore((s) => s.phase);
  const liveValues = useRoutinesStore((s) => s.liveValues);
  const [confirming, setConfirming] = useState(false);

  const isActive = activeId === routine.id;
  const busy = activeId !== null;

  return (
    <YStack gap="$2" backgroundColor="$color2" padding="$3" borderRadius="$4">
      <H4>{routine.name}</H4>
      <Paragraph theme="alt2" size="$2">
        {routine.module} · {routine.kind === 'outputTest' ? 'output test (2F)' : 'basic setting (31)'} ·
        id {routine.id}
        {routine.vcdsGroup !== undefined ? ` · VCDS group ${routine.vcdsGroup}` : ''} · ⚠ experimental
      </Paragraph>
      <Paragraph size="$2">{routine.description}</Paragraph>
      {routine.unavailableReason ? (
        <Paragraph theme="alt1" size="$2">
          ⚠ {routine.unavailableReason}
        </Paragraph>
      ) : null}

      {isActive && phase === 'running' ? (
        <YStack gap="$2">
          {liveValues.map((v) => (
            <XStack key={v.name} justifyContent="space-between">
              <Paragraph theme="alt2" size="$2">
                {v.name}
              </Paragraph>
              <Paragraph size="$2">
                {v.value}
                {v.unit}
              </Paragraph>
            </XStack>
          ))}
          <Button theme="red" onPress={() => stop(routine)}>
            Stop {routine.kind === 'outputTest' ? '(return control to ECU)' : 'routine'}
          </Button>
        </YStack>
      ) : !confirming ? (
        <Button disabled={!unlocked || busy} onPress={() => setConfirming(true)}>
          {!unlocked
            ? 'Locked'
            : routine.unavailableReason
              ? 'Attempt anyway (unverified — not expected to work)'
              : 'Start…'}
        </Button>
      ) : (
        <YStack gap="$2" backgroundColor="$color1" padding="$2" borderRadius="$3">
          <Paragraph size="$2">
            The app will check the interlocks (engine/speed) live and refuse to start if they are
            not met. Confirm you have read the description above.
          </Paragraph>
          <XStack gap="$2">
            <Button
              flex={1}
              theme="red"
              onPress={() => {
                setConfirming(false);
                void start(routine);
              }}
            >
              Check interlocks & start
            </Button>
            <Button flex={1} onPress={() => setConfirming(false)}>
              Cancel
            </Button>
          </XStack>
        </YStack>
      )}
    </YStack>
  );
}

export function RoutinesScreen() {
  const { available, routines } = useRoutines();
  const unlocked = useRoutinesStore((s) => s.unlocked);
  const setUnlocked = useRoutinesStore((s) => s.setUnlocked);
  const phase = useRoutinesStore((s) => s.phase);
  const message = useRoutinesStore((s) => s.message);
  const interlockFailures = useRoutinesStore((s) => s.interlockFailures);

  if (!available) {
    return (
      <Screen title="Routines & output tests">
        <Paragraph theme="alt2">
          Guided routines are unavailable for this car / protocol. They are experimental,
          profile-driven and CAN-only — a generic ELM327 cannot run VAG basic settings on K-line
          cars (that needs KWP1281, which it cannot speak).
        </Paragraph>
      </Screen>
    );
  }

  return (
    <Screen
      title="Routines & output tests"
      subtitle="⚠ Experimental — actuates components / runs module routines. Read each description."
    >
      <XStack
        alignItems="center"
        justifyContent="space-between"
        backgroundColor="$color2"
        padding="$3"
        borderRadius="$4"
      >
        <YStack flex={1}>
          <H4>Unlock routines</H4>
          <Paragraph theme="alt2" size="$2">
            Off = browse only. Interlocks are enforced live before every start.
          </Paragraph>
        </YStack>
        <Switch checked={unlocked} onCheckedChange={(v) => setUnlocked(!!v)}>
          <Switch.Thumb />
        </Switch>
      </XStack>

      {message ? <Paragraph>{message}</Paragraph> : null}
      {phase === 'blocked' && interlockFailures.length ? (
        <YStack backgroundColor="$color2" padding="$3" borderRadius="$4" gap="$1">
          <H4>Blocked by interlocks</H4>
          {interlockFailures.map((f) => (
            <Paragraph key={f} size="$2">
              • {f}
            </Paragraph>
          ))}
        </YStack>
      ) : null}

      {routines.map((r) => (
        <RoutineRow key={r.id} routine={r} />
      ))}
    </Screen>
  );
}
