import React, { useState } from 'react';
import { YStack, XStack, Paragraph, H4, Button } from 'tamagui';
import type { DiscoveredModule, UdsHeaderCandidate } from '@/shared/obd-core';
import type { DiagModule } from '@/shared/vehicles';
import { useModuleScanStore } from '../model/moduleScanStore';
import { diagModuleLiteral, isInModuleList } from '../api/discovery';

/** `08/46` for a probe that covered a shared id pair, else the single address. */
const addresses = (d: DiscoveredModule) =>
  [d.candidate, ...(d.alternatives ?? [])].map((x) => x.address).join('/');

function AnsweredRow({
  found,
  modules,
  isGarageCar,
  onAdd,
}: {
  found: DiscoveredModule;
  modules: DiagModule[];
  isGarageCar: boolean;
  onAdd: (d: DiscoveredModule) => void;
}) {
  const [showLiteral, setShowLiteral] = useState(false);
  // A shared id pair (08 / 46 on 746/7B0) is ONE module: the probe picked an address from its
  // ident, and the user can switch to another candidate on the same pair before adding it.
  const [picked, setPicked] = useState<UdsHeaderCandidate>(found.candidate);
  const sharing = [found.candidate, ...(found.alternatives ?? [])];
  const others = sharing.filter((x) => x !== picked);
  const effective: DiscoveredModule = {
    ...found,
    candidate: picked,
    ...(others.length ? { alternatives: others } : {}),
  };
  const c = picked;
  const listed = isInModuleList(effective, modules);
  const ident = found.ident;
  return (
    <YStack
      testID={`discovered-${found.candidate.address}-${found.candidate.reqHeader}`}
      backgroundColor="$color1"
      borderRadius="$3"
      padding="$2"
      gap="$1"
    >
      <XStack gap="$2" alignItems="center">
        <Paragraph fontFamily="$mono" theme="alt2">
          {c.address}
        </Paragraph>
        <YStack flex={1}>
          <Paragraph>{c.name}</Paragraph>
          <Paragraph theme="alt2" size="$2">
            {c.reqHeader} → {c.rxFilter}
            {ident?.partNumber ? ` · ${ident.partNumber}` : ''}
            {ident?.systemName ? ` · ${ident.systemName}` : ''}
          </Paragraph>
        </YStack>
        <Paragraph size="$2">✓ answered</Paragraph>
      </XStack>
      {others.length ? (
        <YStack gap="$1">
          <Paragraph theme="alt2" size="$2">
            Addresses {sharing.map((x) => x.address).join(' and ')} share these CAN ids on some
            cars, so one module answered for both. Shown as {c.address}
            {ident?.systemName ? ` from its ident (${ident.systemName})` : ''}; switch if its ident
            says otherwise.
          </Paragraph>
          {listed
            ? null
            : others.map((alt) => (
                <Button key={alt.address} size="$2" onPress={() => setPicked(alt)}>
                  {`Record as ${alt.address} ${alt.name} instead`}
                </Button>
              ))}
        </YStack>
      ) : null}
      {listed ? (
        <Paragraph theme="alt2" size="$2">
          Already in this car's module list.
        </Paragraph>
      ) : isGarageCar ? (
        <Button size="$2" onPress={() => onAdd(effective)}>
          Add to this car's module list
        </Button>
      ) : (
        <YStack gap="$1">
          <Button size="$2" onPress={() => setShowLiteral((v) => !v)}>
            {showLiteral ? 'Hide module entry' : "Add to this car's module list"}
          </Button>
          {showLiteral ? (
            <YStack gap="$1">
              <Paragraph theme="alt2" size="$2">
                This car is a built-in profile, which lives in the app's code. Paste this entry into
                its modules list (developer step), or add the car to My garage to keep the module on
                this phone.
              </Paragraph>
              <Paragraph fontFamily="$mono" size="$1" selectable testID="discovered-literal">
                {diagModuleLiteral(effective)}
              </Paragraph>
            </YStack>
          ) : null}
        </YStack>
      )}
    </YStack>
  );
}

/** **Discover modules** (plan 25): probe the known VAG UDS addresses and list what answered, with a
 *  way to add each module to this car's list. CAN only; read-only. */
export function DiscoverySection({
  discover,
  addDiscovered,
  isGarageCar,
  modules,
  discovery,
}: {
  discover: () => Promise<void>;
  addDiscovered: (d: DiscoveredModule) => void;
  isGarageCar: boolean;
  modules: DiagModule[];
  /** The last discovery on this car and connection (`useModuleScan` drops a stale one). */
  discovery: DiscoveredModule[] | null;
}) {
  const running = useModuleScanStore((s) => s.running);
  const progress = useModuleScanStore((s) => s.discoveryProgress);
  const answered = discovery?.filter((d) => d.state === 'answered') ?? [];
  const silent = discovery?.filter((d) => d.state === 'silent') ?? [];
  const errors = discovery?.filter((d) => d.state === 'error') ?? [];

  return (
    <YStack gap="$2" backgroundColor="$color2" borderRadius="$4" padding="$3">
      <H4>Discover modules</H4>
      <Paragraph theme="alt2" size="$2">
        Asks each known VW-group module address for its part number (read-only) to find which
        control modules really answer on this car. Takes a few seconds per silent address.
      </Paragraph>
      <Button disabled={running} onPress={() => void discover()}>
        {progress ? `Discovering ${progress.done}/${progress.total}…` : 'Discover modules'}
      </Button>
      {discovery ? (
        <YStack gap="$2">
          <Paragraph size="$2">
            {answered.length} of {discovery.length} addresses answered.
          </Paragraph>
          {answered.map((d) => (
            <AnsweredRow
              key={`${d.candidate.address}-${d.candidate.reqHeader}`}
              found={d}
              modules={modules}
              isGarageCar={isGarageCar}
              onAdd={addDiscovered}
            />
          ))}
          {silent.length ? (
            <Paragraph theme="alt2" size="$2">
              No answer:{' '}
              {silent.map((d) => `${addresses(d)} (${d.candidate.reqHeader})`).join(' · ')}. Silence
              is not proof a module is missing — older modules may use VW TP2.0 instead.
            </Paragraph>
          ) : null}
          {errors.map((d) => (
            <Paragraph
              key={`${d.candidate.address}-${d.candidate.reqHeader}`}
              color="$red10"
              size="$2"
            >
              ⚠ {addresses(d)} ({d.candidate.reqHeader}): {d.reason}
            </Paragraph>
          ))}
        </YStack>
      ) : null}
    </YStack>
  );
}
