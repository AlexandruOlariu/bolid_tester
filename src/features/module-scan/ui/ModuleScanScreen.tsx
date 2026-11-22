import React, { useState } from 'react';
import { YStack, XStack, Paragraph, H4, Button } from 'tamagui';
import { Screen, VerificationBadge, HIT_SLOP } from '@/shared/ui';
import { diagModuleKey } from '@/shared/vehicles';
import { vagModuleName, vagNativeDtcText } from '@/shared/obd-core';
import { useModuleScan, TP20_MONITOR_UNAVAILABLE } from '../hooks/useModuleScan';
import { useModuleScanStore, ModuleScanResult } from '../model/moduleScanStore';
import { ScanHistorySection } from './ScanHistorySection';
import { DiscoverySection } from './DiscoverySection';
import { translate, useTranslation } from '@/shared/i18n';
import { formatTime } from '@/shared/lib/format';

const hex2 = (n: number) => n.toString(16).padStart(2, '0').toUpperCase();

/** A native KWP fault (TP2.0 module): 5-digit number, component text when known, status byte. */
const kwpFaultLine = (vag: string, status: number) => {
  const text = vagNativeDtcText(vag);
  return `${vag}${text ? ` ${text}` : ''} (${translate('moduleScan:kwpStatus', { status: hex2(status) })})`;
};

const tp20StateLabel = (state: string): string =>
  state === 'ok' ? '✓' : translate(`moduleScan:tp20State.${state}`, { defaultValue: state });

function stateBadge(r: ModuleScanResult): string {
  if (r.state === 'ok')
    return r.dtcs.length
      ? `⚠ ${translate('moduleScan:faults', { count: r.dtcs.length })}`
      : `✓ ${translate('moduleScan:noFaults')}`;
  if (r.state === 'silent') return `– ${translate('moduleScan:noResponse')}`;
  if (r.state === 'skipped') return '⏳ TP2.0';
  return `✕ ${translate('moduleScan:error')}`;
}

function ModuleRow({
  result,
  onClear,
  running,
}: {
  result: ModuleScanResult;
  /** Called with `diagModuleKey(module)`. */
  onClear: (key: string) => void;
  running: boolean;
}) {
  const { t } = useTranslation('moduleScan');
  const [expanded, setExpanded] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const m = result.module;
  return (
    <YStack backgroundColor="$color2" borderRadius="$4" padding="$3" gap="$2">
      <XStack
        alignItems="center"
        gap="$2"
        onPress={() => setExpanded((e) => !e)}
        accessible
        accessibilityRole="button"
        accessibilityLabel={`${m.address} ${m.name}. ${stateBadge(result)}`}
        accessibilityHint={expanded ? t('row.hideHint') : t('row.showHint')}
        accessibilityState={{ expanded }}
      >
        <Paragraph fontFamily="$mono" theme="alt2">
          {m.address}
        </Paragraph>
        <YStack flex={1}>
          <H4>{m.name}</H4>
          {result.ident?.partNumber ? (
            <Paragraph theme="alt2" size="$2">
              {result.ident.partNumber}
              {result.ident.softwareVersion ? ` · SW ${result.ident.softwareVersion}` : ''}
            </Paragraph>
          ) : null}
        </YStack>
        <Paragraph theme={result.dtcs.length ? undefined : 'alt2'}>{stateBadge(result)}</Paragraph>
      </XStack>

      {expanded ? (
        <YStack gap="$2">
          {result.reason ? (
            <Paragraph theme="alt2" size="$2">
              {result.reason}
            </Paragraph>
          ) : null}
          <VerificationBadge item={m} testID={`verify-module-${diagModuleKey(m)}`} />
          {result.ident?.systemName ? (
            <Paragraph theme="alt2" size="$2">
              {t('row.system', { name: result.ident.systemName })}
            </Paragraph>
          ) : null}
          {result.dtcs.map((d) => (
            <YStack key={d.display} backgroundColor="$color1" borderRadius="$3" padding="$2">
              <XStack gap="$2" alignItems="center">
                <Paragraph fontFamily="$mono">{d.display}</Paragraph>
                <Paragraph theme="alt2" size="$2">
                  VAG {d.vagCode}
                </Paragraph>
              </XStack>
              <Paragraph size="$2">{d.description}</Paragraph>
              <Paragraph theme="alt2" size="$2">
                {[
                  d.statusFlags.confirmed ? t('flag.confirmed') : null,
                  d.statusFlags.pending ? t('flag.pending') : null,
                  d.statusFlags.testFailed ? t('flag.failing') : null,
                  d.statusFlags.warningIndicator ? t('flag.lamp') : null,
                ]
                  .filter(Boolean)
                  .join(' · ') || t('flag.stored')}
              </Paragraph>
            </YStack>
          ))}
          {result.state === 'ok' ? (
            !confirmingClear ? (
              <Button
                size="$3"
                hitSlop={HIT_SLOP}
                disabled={running || !result.dtcs.length}
                onPress={() => setConfirmingClear(true)}
              >
                {t('row.clear')}
              </Button>
            ) : (
              <XStack gap="$2">
                <Button
                  flex={1}
                  size="$3"
                  hitSlop={HIT_SLOP}
                  theme="red"
                  disabled={running}
                  onPress={() => {
                    setConfirmingClear(false);
                    onClear(diagModuleKey(m));
                  }}
                >
                  {t('row.confirmClear')}
                </Button>
                <Button
                  flex={1}
                  size="$3"
                  hitSlop={HIT_SLOP}
                  onPress={() => setConfirmingClear(false)}
                >
                  {t('common:actions.cancel')}
                </Button>
              </XStack>
            )
          ) : null}
        </YStack>
      ) : null}
    </YStack>
  );
}

export function ModuleScanScreen() {
  const { t } = useTranslation('moduleScan');
  const {
    available,
    canScanTp20,
    tp20MonitorUnavailable,
    canDiscover,
    isGarageCar,
    discovery: discovered,
    modules,
    proto,
    scanAll,
    clearOne,
    scanGateway,
    discover,
    addDiscovered,
  } = useModuleScan();
  const discovery = canDiscover ? (
    <DiscoverySection
      discover={discover}
      addDiscovered={addDiscovered}
      isGarageCar={isGarageCar}
      modules={modules}
      discovery={discovered}
    />
  ) : null;
  const running = useModuleScanStore((s) => s.running);
  const progress = useModuleScanStore((s) => s.progress);
  const results = useModuleScanStore((s) => s.results);
  const lastScanTs = useModuleScanStore((s) => s.lastScanTs);
  const tp20 = useModuleScanStore((s) => s.tp20);
  const tp20Error = useModuleScanStore((s) => s.tp20Error);

  if (!available) {
    return (
      <Screen title={t('title')}>
        <Paragraph theme="alt2">
          {modules.length === 0
            ? `${t('noModules')}${canDiscover ? ` ${t('discoverBelow')}` : ''}`
            : t('needsCan')}
        </Paragraph>
        {discovery}
      </Screen>
    );
  }

  return (
    <Screen title={t('title')} subtitle={t('subtitle', { count: modules.length, proto })}>
      <Button theme="green" disabled={running} onPress={scanAll}>
        {running && progress
          ? t('scanning', { done: progress.done, total: progress.total })
          : t('scanAll')}
      </Button>
      {lastScanTs ? (
        <Paragraph theme="alt2" size="$2">
          {t('lastScan', { time: formatTime(lastScanTs, true) })}
        </Paragraph>
      ) : null}
      {results.map((r) => (
        <ModuleRow key={diagModuleKey(r.module)} result={r} onClear={clearOne} running={running} />
      ))}

      {discovery}

      {canScanTp20 ? (
        <YStack gap="$2" backgroundColor="$color2" borderRadius="$4" padding="$3">
          <H4>{t('tp20.title')}</H4>
          <Paragraph theme="alt2" size="$2">
            {t('tp20.help')}
          </Paragraph>
          {tp20MonitorUnavailable ? (
            <Paragraph fontWeight="700" size="$2">
              {t('tp20.monitorUnavailable')}
            </Paragraph>
          ) : (
            <Button disabled={running} onPress={scanGateway}>
              {running ? t('tp20.scanning') : t('tp20.scan')}
            </Button>
          )}
          {tp20Error && tp20Error !== TP20_MONITOR_UNAVAILABLE ? (
            <Paragraph color="$statusError" size="$2">
              ⚠ {tp20Error}
            </Paragraph>
          ) : null}
          {tp20 ? (
            <YStack gap="$2">
              {tp20.installed.length ? (
                <Paragraph theme="alt2" size="$2">
                  {t('tp20.installed', {
                    count: tp20.installed.length,
                    list: tp20.installed.map((a) => `${hex2(a)} ${vagModuleName(a)}`).join(' · '),
                  })}
                </Paragraph>
              ) : null}
              {tp20.modules.map((m) => (
                <XStack key={m.address} gap="$2" alignItems="flex-start">
                  <Paragraph fontFamily="$mono" theme="alt2">
                    {hex2(m.address)}
                  </Paragraph>
                  <YStack flex={1}>
                    <Paragraph>{m.name}</Paragraph>
                    {m.ident ? (
                      <Paragraph theme="alt2" size="$2">
                        {m.ident}
                      </Paragraph>
                    ) : null}
                    {m.dtcs ? (
                      m.dtcs.length ? (
                        m.dtcs.map((d) => (
                          <Paragraph key={d.vag} size="$2" color="$statusError" fontFamily="$mono">
                            {kwpFaultLine(d.vag, d.status)}
                          </Paragraph>
                        ))
                      ) : (
                        <Paragraph theme="alt2" size="$2">
                          {t('tp20.noFaults')}
                        </Paragraph>
                      )
                    ) : null}
                    {m.reason ? (
                      <Paragraph theme="alt2" size="$2">
                        {m.reason}
                      </Paragraph>
                    ) : null}
                  </YStack>
                  <Paragraph theme="alt2" size="$2">
                    {m.dtcs?.length && m.state === 'ok'
                      ? `⚠ ${t('faults', { count: m.dtcs.length })}`
                      : tp20StateLabel(m.state)}
                  </Paragraph>
                </XStack>
              ))}
            </YStack>
          ) : null}
        </YStack>
      ) : null}
      <ScanHistorySection />

      {!results.length && !running ? <Paragraph theme="alt2">{t('help')}</Paragraph> : null}
    </Screen>
  );
}
