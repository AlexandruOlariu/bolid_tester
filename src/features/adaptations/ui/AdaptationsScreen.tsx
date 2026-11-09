import React, { useMemo, useRef, useState } from 'react';
import { YStack, XStack, Paragraph, H4, Button, Switch, Input } from 'tamagui';
import { useRouter } from 'expo-router';
import { Screen } from '@/shared/ui';
import type { AdaptationChannel } from '@/shared/vehicles';
import { useAdaptationsStore } from '../model/adaptationsStore';
import {
  KwpSessionCacheContext,
  newKwpSessionCache,
  useAdaptations,
  type LoginInput,
} from '../hooks/useAdaptations';
import { LoginSheet } from './LoginSheet';

/** The honest K-line limit (plan 22): shown on a K-line link, where only KWP2000 modules answer. */
export const KWP1281_LIMIT =
  'On a K-line car only KWP2000 modules are reachable through a generic ELM327 adapter. Modules ' +
  'that speak KWP1281 — on older VAG cars often the instrument cluster, comfort and climate ' +
  'modules — cannot be addressed at all, so their adaptations are not offered. To reset the ' +
  'service reminder on such a car, use the manual procedure on the Service reset screen.';

/** What waits for a login code: the new value's confirm step, or a one-tap restore. */
type PendingAction = { kind: 'write' } | { kind: 'restore'; raw: number[] };

function ChannelRow({ ch }: { ch: AdaptationChannel }) {
  const { describe, read, write, restore, display, loginInfo, forgetLogin } = useAdaptations();
  const unlocked = useAdaptationsStore((s) => s.unlocked);
  const running = useAdaptationsStore((s) => s.running);
  const raw = useAdaptationsStore((s) => s.values[ch.did]);
  // Select the stable array and filter outside the selector: a selector returning a fresh array
  // on every call makes zustand re-render forever ("getSnapshot should be cached").
  const allBackups = useAdaptationsStore((s) => s.backups);
  const backups = useMemo(() => allBackups.filter((b) => b.did === ch.did), [allBackups, ch.did]);
  const [draft, setDraft] = useState<string>('');
  const [confirming, setConfirming] = useState(false);
  // KWP login (plan 22): the sheet's open state, the action waiting for it, and the code to use.
  const [sheetFor, setSheetFor] = useState<PendingAction | null>(null);
  const [login, setLogin] = useState<LoginInput | null>(null);
  // The code the module just rejected: never re-sent without the sheet, never pre-filled. (A
  // rejected *remembered* code is also forgotten by the hook, so this survives a remount.)
  const [rejectedCode, setRejectedCode] = useState<number | null>(null);

  const current = display(ch, raw);
  const description = describe(ch);
  const info = loginInfo(ch);
  const prefill = info?.entry && info.entry.code !== rejectedCode ? info.entry : null;

  /** Run `action` with a login: the remembered one (no sheet), or the sheet first. */
  const withLogin = (action: PendingAction) => {
    if (info?.remembered && info.entry && info.entry.code !== rejectedCode) {
      void runAction(action, { code: info.entry.code, wsc: info.entry.wsc });
      return;
    }
    setSheetFor(action);
  };

  /** Track the code the module just rejected; any other outcome clears it. */
  const settleLogin = (rejected: boolean | undefined, input: LoginInput | undefined) =>
    setRejectedCode(rejected && input ? input.code : null);

  const runAction = async (action: PendingAction, input: LoginInput | undefined) => {
    if (action.kind === 'write') {
      setLogin(input ?? null);
      setConfirming(true);
      return;
    }
    const res = await restore(ch, action.raw, input);
    settleLogin(res.loginRejected, input);
  };

  const startWrite = () => (ch.login ? withLogin({ kind: 'write' }) : setConfirming(true));
  const startRestore = (r: number[]) =>
    ch.login ? withLogin({ kind: 'restore', raw: r }) : void restore(ch, r);

  const confirmWrite = async () => {
    setConfirming(false);
    const res = await write(ch, Number(draft), login ?? undefined);
    setLogin(null);
    settleLogin(res.loginRejected, login ?? undefined);
    setDraft('');
  };

  return (
    <YStack gap="$2" backgroundColor="$color2" padding="$3" borderRadius="$4">
      <XStack alignItems="center" gap="$2">
        <YStack flex={1}>
          <H4>{ch.name}</H4>
          <Paragraph theme="alt2" size="$2">
            {ch.module} · {ch.transport === 'kwp' ? `local id ${ch.did}` : `DID ${ch.did}`}
            {ch.min !== undefined && ch.max !== undefined
              ? ` · ${ch.min}–${ch.max}${ch.unit ?? ''}`
              : ''}
          </Paragraph>
        </YStack>
        <Paragraph>{current !== null ? `${current}${ch.unit ?? ''}` : '—'}</Paragraph>
      </XStack>
      {description ? (
        <Paragraph theme="alt2" size="$2">
          {description}
        </Paragraph>
      ) : null}
      <Paragraph theme="alt2" size="$2">
        ⚠ Experimental / unverified channel — confirm behaviour on the real car.
      </Paragraph>
      {info ? (
        <XStack gap="$2" alignItems="center">
          <Paragraph theme="alt2" size="$2" flex={1}>
            {info.remembered && info.entry
              ? `Login: remembered (${info.entry.address} · ${info.entry.purpose || 'saved code'})`
              : info.origin === 'pre-vin' && info.entry
                ? `Login: needed — a code saved before this car’s VIN was known is available (${info.entry.address} · ${info.entry.purpose || 'saved code'})`
                : info.entry
                  ? `Login: needed — a documented code is available (${info.entry.address} · ${info.entry.purpose})`
                  : 'Login: needed'}
          </Paragraph>
          {info.remembered ? (
            <Button
              size="$2"
              onPress={() => forgetLogin(ch)}
              accessibilityLabel="Forget login code"
            >
              Forget
            </Button>
          ) : null}
        </XStack>
      ) : null}
      <XStack gap="$2">
        <Button size="$3" disabled={running} onPress={() => read(ch)}>
          Read
        </Button>
        {ch.security ? (
          <Paragraph theme="alt2" size="$2" alignSelf="center">
            Security-locked (read-only)
          </Paragraph>
        ) : null}
      </XStack>
      {unlocked && !ch.security ? (
        <YStack gap="$2">
          <XStack gap="$2" alignItems="center">
            <Input
              flex={1}
              size="$3"
              keyboardType="numeric"
              placeholder={current !== null ? String(current) : 'new value'}
              value={draft}
              onChangeText={setDraft}
              accessibilityLabel={`New value for ${ch.name}`}
            />
            {!confirming ? (
              <Button
                size="$3"
                theme="red"
                disabled={running || raw === undefined || draft.trim() === ''}
                onPress={startWrite}
              >
                Write
              </Button>
            ) : null}
          </XStack>
          {raw === undefined ? (
            <Paragraph theme="alt2" size="$2">
              Read the current value first — writes always start from a fresh backup.
            </Paragraph>
          ) : null}
          {confirming ? (
            <YStack gap="$2" backgroundColor="$color1" padding="$2" borderRadius="$3">
              <Paragraph size="$2">
                Write {draft}
                {ch.unit ?? ''} to {ch.name} (was {current ?? '—'}
                {ch.unit ?? ''})? The old value is backed up and re-verified after writing.
              </Paragraph>
              <XStack gap="$2">
                <Button flex={1} size="$3" theme="red" disabled={running} onPress={confirmWrite}>
                  Confirm write
                </Button>
                <Button
                  flex={1}
                  size="$3"
                  onPress={() => {
                    setConfirming(false);
                    setLogin(null);
                  }}
                >
                  Cancel
                </Button>
              </XStack>
            </YStack>
          ) : null}
          {backups.length ? (
            <Button size="$3" disabled={running} onPress={() => startRestore(backups[0].raw)}>
              Restore backup ({new Date(backups[0].at).toLocaleTimeString()})
            </Button>
          ) : null}
          {ch.defaultRaw ? (
            <Button size="$3" disabled={running} onPress={() => startRestore(ch.defaultRaw!)}>
              Restore known default
            </Button>
          ) : null}
        </YStack>
      ) : null}
      {ch.login ? (
        <LoginSheet
          channel={sheetFor ? ch : null}
          prefill={prefill}
          prefillNote={
            prefill && info?.origin === 'pre-vin'
              ? `Filled in from a code saved for this vehicle type before this car’s VIN was known (${prefill.purpose || 'saved code'}) — check it is this car’s code.`
              : undefined
          }
          onClose={() => setSheetFor(null)}
          onSubmit={(input) => {
            const action = sheetFor;
            setSheetFor(null);
            if (action) void runAction(action, input);
          }}
        />
      ) : null}
    </YStack>
  );
}

export function AdaptationsScreen() {
  const { available, channels, declaredCount, kline } = useAdaptations();
  const unlocked = useAdaptationsStore((s) => s.unlocked);
  const setUnlocked = useAdaptationsStore((s) => s.setUnlocked);
  const lastResult = useAdaptationsStore((s) => s.lastResult);
  const router = useRouter();
  // One KWP session cache for this screen session, shared by every row (plan 22).
  const kwpCache = useRef(newKwpSessionCache()).current;

  const kwp1281 = kline ? (
    <YStack gap="$2">
      <Paragraph theme="alt2" size="$2">
        {KWP1281_LIMIT}
      </Paragraph>
      <Button size="$3" onPress={() => router.push('/service-reset')}>
        Open Service reset
      </Button>
    </YStack>
  ) : null;

  if (!available) {
    return (
      <Screen title="Adaptations">
        <Paragraph theme="alt2">
          Adaptation channels are unavailable for this car / link. They are experimental and
          profile-driven: UDS channels need a CAN link and KWP channels a K-line link — the current
          profile declares
          {declaredCount ? ' channels, but none for this link.' : ' none.'}
        </Paragraph>
        {kwp1281}
      </Screen>
    );
  }

  return (
    <Screen
      title="Adaptations"
      subtitle="⚠ Experimental — writes module adaptation values. Backup + verify on every write."
    >
      <XStack
        alignItems="center"
        justifyContent="space-between"
        backgroundColor="$color2"
        padding="$3"
        borderRadius="$4"
      >
        <YStack flex={1}>
          <H4>Unlock writes</H4>
          <Paragraph theme="alt2" size="$2">
            Off = read-only. Writes back up the old value and verify after writing.
          </Paragraph>
        </YStack>
        <Switch
          checked={unlocked}
          onCheckedChange={(v) => setUnlocked(!!v)}
          accessibilityLabel="Unlock writes"
        >
          <Switch.Thumb />
        </Switch>
      </XStack>
      {kwp1281}
      {lastResult ? <Paragraph>{lastResult}</Paragraph> : null}
      <KwpSessionCacheContext.Provider value={kwpCache}>
        {channels.map((ch) => (
          <ChannelRow key={`${ch.reqHeader}:${ch.did}`} ch={ch} />
        ))}
      </KwpSessionCacheContext.Provider>
    </Screen>
  );
}
