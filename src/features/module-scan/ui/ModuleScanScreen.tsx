import React, { useState } from 'react';
import { YStack, XStack, Paragraph, H4, Button } from 'tamagui';
import { Screen } from '@/shared/ui';
import { vagModuleName } from '@/shared/obd-core';
import { useModuleScan } from '../hooks/useModuleScan';
import { useModuleScanStore, ModuleScanResult } from '../model/moduleScanStore';
import { ScanHistorySection } from './ScanHistorySection';

const hex2 = (n: number) => n.toString(16).padStart(2, '0').toUpperCase();

const tp20StateLabel: Record<string, string> = {
  ok: '✓',
  'not-installed': 'not fitted',
  refused: '✕ refused',
  silent: '– silent',
};

function stateBadge(r: ModuleScanResult): string {
  if (r.state === 'ok') return r.dtcs.length ? `⚠ ${r.dtcs.length} fault${r.dtcs.length > 1 ? 's' : ''}` : '✓ no faults';
  if (r.state === 'silent') return '– no response';
  if (r.state === 'skipped') return '⏳ TP2.0';
  return '✕ error';
}

function ModuleRow({
  result,
  onClear,
  running,
}: {
  result: ModuleScanResult;
  onClear: (address: string) => void;
  running: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const m = result.module;
  return (
    <YStack backgroundColor="$color2" borderRadius="$4" padding="$3" gap="$2">
      <XStack alignItems="center" gap="$2" onPress={() => setExpanded((e) => !e)}>
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
          {m.experimental ? (
            <Paragraph theme="alt2" size="$2">
              ⚠ Addressing for this module is experimental / unverified — confirm on the real car.
            </Paragraph>
          ) : null}
          {result.ident?.systemName ? (
            <Paragraph theme="alt2" size="$2">
              System: {result.ident.systemName}
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
                  d.statusFlags.confirmed ? 'confirmed' : null,
                  d.statusFlags.pending ? 'pending' : null,
                  d.statusFlags.testFailed ? 'failing now' : null,
                  d.statusFlags.warningIndicator ? 'warning lamp' : null,
                ]
                  .filter(Boolean)
                  .join(' · ') || 'stored'}
              </Paragraph>
            </YStack>
          ))}
          {result.state === 'ok' ? (
            !confirmingClear ? (
              <Button size="$3" disabled={running || !result.dtcs.length} onPress={() => setConfirmingClear(true)}>
                Clear this module's faults
              </Button>
            ) : (
              <XStack gap="$2">
                <Button
                  flex={1}
                  size="$3"
                  theme="red"
                  disabled={running}
                  onPress={() => {
                    setConfirmingClear(false);
                    onClear(m.address);
                  }}
                >
                  Confirm clear
                </Button>
                <Button flex={1} size="$3" onPress={() => setConfirmingClear(false)}>
                  Cancel
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
  const { available, canScanTp20, modules, proto, scanAll, clearOne, scanGateway } = useModuleScan();
  const running = useModuleScanStore((s) => s.running);
  const progress = useModuleScanStore((s) => s.progress);
  const results = useModuleScanStore((s) => s.results);
  const lastScanTs = useModuleScanStore((s) => s.lastScanTs);
  const tp20 = useModuleScanStore((s) => s.tp20);
  const tp20Error = useModuleScanStore((s) => s.tp20Error);

  if (!available) {
    return (
      <Screen title="Module scan">
        <Paragraph theme="alt2">
          {modules.length === 0
            ? 'No control modules are declared for this vehicle profile. Module scan needs a ' +
              'profile with a module list (see the Golf Plus example) — the generic profile scans ' +
              'the engine only, via the Fault codes screen.'
            : 'Module scan needs a CAN (UDS) link. On K-line cars a generic ELM327 reaches the ' +
              'engine ECU only — use the Fault codes screen for engine faults.'}
        </Paragraph>
      </Screen>
    );
  }

  return (
    <Screen
      title="Module scan"
      subtitle={`VCDS-style auto-scan · ${modules.length} modules declared · link ${proto}`}
    >
      <Button theme="green" disabled={running} onPress={scanAll}>
        {running && progress ? `Scanning ${progress.done}/${progress.total}…` : 'Scan all modules'}
      </Button>
      {lastScanTs ? (
        <Paragraph theme="alt2" size="$2">
          Last scan {new Date(lastScanTs).toLocaleTimeString()}
        </Paragraph>
      ) : null}
      {results.map((r) => (
        <ModuleRow key={r.module.address} result={r} onClear={clearOne} running={running} />
      ))}

      {canScanTp20 ? (
        <YStack gap="$2" backgroundColor="$color2" borderRadius="$4" padding="$3">
          <H4>Pre-UDS modules (TP2.0)</H4>
          <Paragraph theme="alt2" size="$2">
            ⚠ Experimental. Older VAG modules (cluster, comfort, gateway) speak VW TP2.0, not UDS.
            This opens a channel to the gateway, reads its installation list, and identifies each
            module. On a real generic ELM327 this is timing-sensitive and may not work on every
            adapter.
          </Paragraph>
          <Button disabled={running} onPress={scanGateway}>
            {running ? 'Scanning…' : 'Scan gateway (TP2.0)'}
          </Button>
          {tp20Error ? (
            <Paragraph color="$red10" size="$2">
              ⚠ {tp20Error}
            </Paragraph>
          ) : null}
          {tp20 ? (
            <YStack gap="$2">
              {tp20.installed.length ? (
                <Paragraph theme="alt2" size="$2">
                  Gateway reports {tp20.installed.length} installed modules:{' '}
                  {tp20.installed.map((a) => `${hex2(a)} ${vagModuleName(a)}`).join(' · ')}
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
                          <Paragraph key={d.vag} size="$2" color="$red10" fontFamily="$mono">
                            {d.vag} (status 0x{d.status.toString(16).padStart(2, '0').toUpperCase()})
                          </Paragraph>
                        ))
                      ) : (
                        <Paragraph theme="alt2" size="$2">
                          No faults stored.
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
                      ? `⚠ ${m.dtcs.length} fault${m.dtcs.length > 1 ? 's' : ''}`
                      : (tp20StateLabel[m.state] ?? m.state)}
                  </Paragraph>
                </XStack>
              ))}
            </YStack>
          ) : null}
        </YStack>
      ) : null}
      <ScanHistorySection />

      {!results.length && !running ? (
        <Paragraph theme="alt2">
          Scans every declared module for identification (part number, software) and fault codes
          with VAG code numbers — like a VCDS auto-scan, over the modules this adapter can reach.
        </Paragraph>
      ) : null}
    </Screen>
  );
}
