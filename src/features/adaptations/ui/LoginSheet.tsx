import React, { useState } from 'react';
import { Sheet, YStack, XStack, Text, Paragraph, Button, Input } from 'tamagui';
import { HIT_SLOP } from '@/shared/ui';
import { Check } from 'lucide-react-native';
import { formatLoginCode, parseLoginCode, parseWorkshopCode } from '@/shared/obd-core';
import type { AdaptationChannel, LoginCodeEntry } from '@/shared/vehicles';
import type { LoginInput } from '../hooks/useAdaptations';

/** The KWP login entry (plan 22) shown before a write to a channel that needs a module login —
 *  the five-digit code VCDS asks for in "Login – 11". Pre-filled from the code book; the code is
 *  masked with a reveal toggle. "Remember for this car" stores it in the car's code book once the
 *  module accepted it; otherwise the code is used for this one write and forgotten. See
 *  docs/features/adaptations.md → "Login sheet". */
export function LoginSheet({
  channel,
  prefill,
  prefillNote,
  onSubmit,
  onClose,
}: {
  /** Open while non-null. */
  channel: AdaptationChannel | null;
  prefill: LoginCodeEntry | null;
  /** Where the pre-filled code came from, when not this car's code book. */
  prefillNote?: string;
  onSubmit: (input: LoginInput) => void;
  onClose: () => void;
}) {
  return (
    <Sheet
      modal
      open={channel !== null}
      onOpenChange={(o: boolean) => {
        if (!o) onClose();
      }}
      snapPoints={[70]}
      dismissOnSnapToBottom
    >
      <Sheet.Overlay />
      <Sheet.Handle />
      <Sheet.Frame padding="$4">
        <Sheet.ScrollView>
          {channel ? (
            <LoginForm
              key={channel.did}
              channel={channel}
              prefill={prefill}
              prefillNote={prefillNote}
              onSubmit={onSubmit}
              onCancel={onClose}
            />
          ) : null}
        </Sheet.ScrollView>
      </Sheet.Frame>
    </Sheet>
  );
}

export const LOGIN_CODE_ERROR = 'Enter the login code: up to five digits, 0 to 65535.';
export const WSC_ERROR = 'The workshop code is up to five digits, or leave it empty.';

export function LoginForm({
  channel,
  prefill,
  prefillNote,
  onSubmit,
  onCancel,
}: {
  channel: AdaptationChannel;
  prefill: LoginCodeEntry | null;
  prefillNote?: string;
  onSubmit: (input: LoginInput) => void;
  onCancel: () => void;
}) {
  const [code, setCode] = useState(prefill ? formatLoginCode(prefill.code) : '');
  const [wsc, setWsc] = useState(prefill?.wsc ? String(prefill.wsc) : '');
  const [reveal, setReveal] = useState(false);
  const [remember, setRemember] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const parsedCode = parseLoginCode(code);
  const parsedWsc = parseWorkshopCode(wsc);

  const submit = () => {
    if (parsedCode === null || parsedWsc === null) {
      setShowErrors(true);
      return;
    }
    onSubmit({ code: parsedCode, ...(parsedWsc ? { wsc: parsedWsc } : {}), remember });
  };

  return (
    <YStack gap="$3" paddingBottom="$6">
      <Text fontWeight="800" fontSize="$6">
        Module login
      </Text>
      <Paragraph theme="alt2" fontSize="$2">
        {channel.module}
        {channel.address ? ` (address ${channel.address})` : ''} asks for a login code before it
        accepts this write — the five-digit number VCDS calls “Login – 11”. The app ships no codes:
        use the one from your own records or your VCDS log.
      </Paragraph>
      {prefill ? (
        <Paragraph theme="alt2" fontSize="$2">
          {prefillNote ??
            `Filled in from this car’s code book (${prefill.purpose || 'saved code'}).`}
        </Paragraph>
      ) : null}

      <YStack gap="$1">
        <Paragraph fontWeight="700">Login code</Paragraph>
        <XStack gap="$2" alignItems="center">
          <Input
            flex={1}
            value={code}
            onChangeText={(t: string) => setCode(t.replace(/\D/g, '').slice(0, 5))}
            keyboardType="number-pad"
            secureTextEntry={!reveal}
            maxLength={5}
            placeholder="•••••"
            accessibilityLabel="Login code"
          />
          <Button
            size="$3"
            hitSlop={HIT_SLOP}
            onPress={() => setReveal((r) => !r)}
            accessibilityLabel={reveal ? 'Hide login code' : 'Show login code'}
          >
            {reveal ? 'Hide' : 'Show'}
          </Button>
        </XStack>
        {showErrors && parsedCode === null ? (
          <Paragraph color="$statusError" fontSize="$2">
            {LOGIN_CODE_ERROR}
          </Paragraph>
        ) : null}
      </YStack>

      <YStack gap="$1">
        <Paragraph fontWeight="700">Workshop code (optional)</Paragraph>
        <Input
          value={wsc}
          onChangeText={(t: string) => setWsc(t.replace(/\D/g, '').slice(0, 5))}
          keyboardType="number-pad"
          maxLength={5}
          placeholder="00000"
          accessibilityLabel="Workshop code"
        />
        {showErrors && parsedWsc === null ? (
          <Paragraph color="$statusError" fontSize="$2">
            {WSC_ERROR}
          </Paragraph>
        ) : null}
      </YStack>

      <Button
        size="$3"
        hitSlop={HIT_SLOP}
        justifyContent="flex-start"
        theme={remember ? 'green' : 'gray'}
        icon={remember ? <Check size={16} /> : undefined}
        onPress={() => setRemember((r) => !r)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: remember }}
        accessibilityLabel="Remember for this car"
      >
        Remember for this car
      </Button>
      <Paragraph theme="alt2" fontSize="$1">
        {remember
          ? 'The code is saved in this car’s code book once the module accepts it, so the next write skips this step.'
          : 'Not saved: the code is used for this write only.'}
      </Paragraph>

      <XStack gap="$3">
        <Button flex={1} onPress={onCancel}>
          Cancel
        </Button>
        <Button flex={1} theme="green" onPress={submit}>
          Continue
        </Button>
      </XStack>
    </YStack>
  );
}
