import React, { useState } from 'react';
import { YStack, XStack, Paragraph, H4, Button } from 'tamagui';
import type { DiscoveredModule, UdsHeaderCandidate } from '@/shared/obd-core';
import type { DiagModule } from '@/shared/vehicles';
import { useModuleScanStore } from '../model/moduleScanStore';
import { diagModuleLiteral, isInModuleList } from '../api/discovery';
import { HIT_SLOP } from '@/shared/ui';
import { useTranslation } from '@/shared/i18n';

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
  const { t } = useTranslation('moduleScan');
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
        <Paragraph size="$2">✓ {t('discover.answered')}</Paragraph>
      </XStack>
      {others.length ? (
        <YStack gap="$1">
          <Paragraph theme="alt2" size="$2">
            {ident?.systemName
              ? t('discover.sharedIdent', {
                  list: sharing.map((x) => x.address).join(` ${t('discover.and')} `),
                  address: c.address,
                  system: ident.systemName,
                })
              : t('discover.shared', {
                  list: sharing.map((x) => x.address).join(` ${t('discover.and')} `),
                  address: c.address,
                })}
          </Paragraph>
          {listed
            ? null
            : others.map((alt) => (
                <Button
                  key={alt.address}
                  size="$3"
                  hitSlop={HIT_SLOP}
                  onPress={() => setPicked(alt)}
                >
                  {t('discover.recordAs', { address: alt.address, name: alt.name })}
                </Button>
              ))}
        </YStack>
      ) : null}
      {listed ? (
        <Paragraph theme="alt2" size="$2">
          {t('discover.listed')}
        </Paragraph>
      ) : isGarageCar ? (
        <Button size="$3" hitSlop={HIT_SLOP} onPress={() => onAdd(effective)}>
          {t('discover.add')}
        </Button>
      ) : (
        <YStack gap="$1">
          <Button size="$3" hitSlop={HIT_SLOP} onPress={() => setShowLiteral((v) => !v)}>
            {showLiteral ? t('discover.hideEntry') : t('discover.add')}
          </Button>
          {showLiteral ? (
            <YStack gap="$1">
              <Paragraph theme="alt2" size="$2">
                {t('discover.builtIn')}
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
  const { t } = useTranslation('moduleScan');
  const running = useModuleScanStore((s) => s.running);
  const progress = useModuleScanStore((s) => s.discoveryProgress);
  const answered = discovery?.filter((d) => d.state === 'answered') ?? [];
  const silent = discovery?.filter((d) => d.state === 'silent') ?? [];
  const errors = discovery?.filter((d) => d.state === 'error') ?? [];

  return (
    <YStack gap="$2" backgroundColor="$color2" borderRadius="$4" padding="$3">
      <H4>{t('discover.title')}</H4>
      <Paragraph theme="alt2" size="$2">
        {t('discover.help')}
      </Paragraph>
      <Button disabled={running} onPress={() => void discover()}>
        {progress
          ? t('discover.progress', { done: progress.done, total: progress.total })
          : t('discover.title')}
      </Button>
      {discovery ? (
        <YStack gap="$2">
          <Paragraph size="$2">
            {t('discover.summary', { answered: answered.length, total: discovery.length })}
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
              {t('discover.silent', {
                list: silent.map((d) => `${addresses(d)} (${d.candidate.reqHeader})`).join(' · '),
              })}
            </Paragraph>
          ) : null}
          {errors.map((d) => (
            <Paragraph
              key={`${d.candidate.address}-${d.candidate.reqHeader}`}
              color="$statusError"
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
