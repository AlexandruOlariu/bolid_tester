import React, { useState } from 'react';
import { YStack, XStack, Paragraph, H4, Button, Switch } from 'tamagui';
import { Screen } from '@/shared/ui';
import { buildCodingView, type CodingByteView } from '@/shared/obd-core';
import type { CodingModule } from '@/shared/vehicles';
import { useCodingStore } from '../model/codingStore';
import { useCoding } from '../hooks/useCoding';
import { CodingTweaks } from './CodingTweaks';
import { CodingBackup } from './CodingBackup';

const hex2 = (n: number) => n.toString(16).padStart(2, '0').toUpperCase();
const lowestBit = (mask: number) => mask & -mask;

/** Old→new coding preview: each byte in hex, changed bytes highlighted. */
function CodingPreview({ view }: { view: CodingByteView[] }) {
  return (
    <XStack flexWrap="wrap" gap="$1.5">
      {view.map((b) => (
        <Paragraph
          key={b.index}
          fontFamily="$mono"
          size="$3"
          color={b.changed ? '$yellow10' : undefined}
          theme={b.changed ? undefined : 'alt2'}
        >
          {b.hex}
        </Paragraph>
      ))}
    </XStack>
  );
}

/** One byte: named fields as friendly controls (Switch / stepper) + a raw 8-bit editor. */
function ByteCard({
  byteView,
  onToggleBit,
  onSetField,
}: {
  byteView: CodingByteView;
  onToggleBit: (byte: number, bit: number) => void;
  onSetField: (byte: number, mask: number, value: number) => void;
}) {
  return (
    <YStack
      gap="$2"
      backgroundColor="$color1"
      borderRadius="$3"
      padding="$2"
      borderLeftWidth={byteView.changed ? 3 : 0}
      borderLeftColor="$yellow10"
    >
      <XStack alignItems="center" gap="$2">
        <Paragraph fontFamily="$mono" theme="alt2" size="$2">
          Byte {byteView.index}
        </Paragraph>
        <Paragraph fontFamily="$mono">0x{byteView.hex}</Paragraph>
      </XStack>

      {byteView.fields.map((f) =>
        f.bit !== undefined ? (
          <XStack key={f.name} justifyContent="space-between" alignItems="center">
            <Paragraph flex={1} size="$2">
              {f.name}
              <Paragraph theme="alt2" size="$1">
                {'  '}bit {f.bit}
              </Paragraph>
            </Paragraph>
            <Switch
              size="$2"
              checked={f.value === 1}
              onCheckedChange={() => onToggleBit(byteView.index, f.bit!)}
            >
              <Switch.Thumb />
            </Switch>
          </XStack>
        ) : f.mask !== undefined ? (
          <XStack key={f.name} justifyContent="space-between" alignItems="center" gap="$2">
            <Paragraph flex={1} size="$2">
              {f.name}
              <Paragraph theme="alt2" size="$1">
                {'  '}mask 0x{hex2(f.mask)}
              </Paragraph>
            </Paragraph>
            <XStack alignItems="center" gap="$2">
              <Button
                size="$1"
                circular
                disabled={f.value <= 0}
                onPress={() => onSetField(byteView.index, f.mask!, Math.max(0, f.value - lowestBit(f.mask!)))}
              >
                −
              </Button>
              <Paragraph fontFamily="$mono" minWidth={28} textAlign="center">
                {f.value / lowestBit(f.mask)}
              </Paragraph>
              <Button
                size="$1"
                circular
                disabled={f.value >= f.mask}
                onPress={() =>
                  onSetField(byteView.index, f.mask!, Math.min(f.mask!, f.value + lowestBit(f.mask!)))
                }
              >
                +
              </Button>
            </XStack>
          </XStack>
        ) : null,
      )}

      {/* Raw bit editor — flip any bit (incl. undocumented ones), msb first. */}
      <XStack gap="$1" flexWrap="wrap">
        {byteView.bits.map((b) => (
          <Button
            key={b.bit}
            size="$1"
            paddingHorizontal="$2"
            theme={b.value ? 'green' : undefined}
            onPress={() => onToggleBit(byteView.index, b.bit)}
          >
            {b.value}
          </Button>
        ))}
      </XStack>
    </YStack>
  );
}

function ModuleEditor({ mod }: { mod: CodingModule }) {
  const { read, write, toggleBit, setField, fieldsFor, currentFor } = useCoding();
  const unlocked = useCodingStore((s) => s.unlocked);
  const current = currentFor(mod);
  const [original, setOriginal] = useState<number[] | null>(null);
  const [confirming, setConfirming] = useState(false);

  const fields = fieldsFor(mod);
  const view = buildCodingView(current, fields, original ?? undefined);
  const dirty = !!original && view.some((b) => b.changed);

  return (
    <YStack gap="$2" backgroundColor="$color2" padding="$3" borderRadius="$4">
      <XStack alignItems="center" gap="$2">
        <YStack flex={1}>
          <H4>{mod.module}</H4>
          <Paragraph theme="alt2" size="$2">
            DID {mod.codingDid}
            {mod.partNumber ? ` · ${mod.partNumber}` : ''}
          </Paragraph>
        </YStack>
        <Button size="$2" onPress={async () => setOriginal((await read(mod)) ?? current)}>
          Read + backup
        </Button>
      </XStack>

      {original ? (
        <YStack gap="$1">
          <Paragraph theme="alt2" size="$2">
            Before → After
          </Paragraph>
          <XStack gap="$2" alignItems="center">
            <CodingPreview view={buildCodingView(original, fields)} />
            <Paragraph theme="alt2">→</Paragraph>
            <CodingPreview view={view} />
          </XStack>
        </YStack>
      ) : (
        <Paragraph theme="alt2" size="$2">
          Read the module first — writes always start from a fresh backup.
        </Paragraph>
      )}

      {view.map((b) => (
        <ByteCard
          key={b.index}
          byteView={b}
          onToggleBit={(byte, bit) => toggleBit(mod, current, byte, bit)}
          onSetField={(byte, mask, value) => setField(mod, current, byte, mask, value)}
        />
      ))}

      {!confirming ? (
        <Button
          theme="red"
          disabled={!unlocked || !original || !dirty}
          onPress={() => setConfirming(true)}
        >
          {!unlocked ? 'Unlock to write' : !dirty ? 'No changes to write' : 'Write coding (experimental)'}
        </Button>
      ) : (
        <YStack gap="$2" backgroundColor="$color1" padding="$2" borderRadius="$3">
          <Paragraph size="$2">
            Write the new coding to {mod.module}? The old value is backed up and re-verified after
            writing.
          </Paragraph>
          <XStack gap="$2">
            <Button
              flex={1}
              size="$3"
              theme="red"
              onPress={async () => {
                setConfirming(false);
                const ok = await write(mod, current);
                if (ok) setOriginal(current);
              }}
            >
              Confirm write
            </Button>
            <Button flex={1} size="$3" onPress={() => setConfirming(false)}>
              Cancel
            </Button>
          </XStack>
        </YStack>
      )}
    </YStack>
  );
}

export function CodingScreen() {
  const { available, modules } = useCoding();
  const unlocked = useCodingStore((s) => s.unlocked);
  const setUnlocked = useCodingStore((s) => s.setUnlocked);
  const lastResult = useCodingStore((s) => s.lastResult);

  if (!available) {
    return (
      <Screen title="Coding">
        <Paragraph theme="alt2">
          Coding is unavailable for this car / protocol. It is experimental, CAN-only, and
          profile-gated.
        </Paragraph>
      </Screen>
    );
  }

  return (
    <Screen title="Coding" subtitle="⚠ Experimental — writes can disable functions. Your car, your risk.">
      <XStack justifyContent="space-between" alignItems="center">
        <Paragraph flex={1}>Unlock writing</Paragraph>
        <Switch checked={unlocked} onCheckedChange={(v) => setUnlocked(!!v)}>
          <Switch.Thumb />
        </Switch>
      </XStack>
      {lastResult ? <Paragraph theme="alt2">{lastResult}</Paragraph> : null}

      <CodingTweaks />

      {modules.map((m) => (
        <ModuleEditor key={m.module} mod={m} />
      ))}

      <CodingBackup />
    </Screen>
  );
}
