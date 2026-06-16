import React, { useEffect } from 'react';
import { XStack, Paragraph, H3, Button, Card } from 'tamagui';
import { Screen, ValueCard } from '@/shared/ui';
import { useDpf } from '../hooks/useDpf';

const STATUS: Record<string, { color: string; label: string }> = {
  ok: { color: '#2bb673', label: 'Filter healthy' },
  filling: { color: '#3fb950', label: 'Soot building (normal)' },
  'regen-due': { color: '#d29922', label: 'Regeneration due' },
  regenerating: { color: '#58a6ff', label: 'Regenerating now' },
  high: { color: '#f85149', label: 'Soot load high' },
  unknown: { color: '#8B949E', label: 'No reading' },
};

export function DpfScreen() {
  const { available, values, report, running, refresh } = useDpf();

  useEffect(() => {
    if (available) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available]);

  if (!available) {
    return (
      <Screen title="DPF / regen">
        <Paragraph theme="alt2">
          The DPF monitor needs a diesel profile with DPF PIDs on a CAN (UDS) link. It is hidden for
          petrol cars and K-line cars (no Mode 22). Select the Golf TDI (or another diesel CAN profile)
          to use it.
        </Paragraph>
      </Screen>
    );
  }

  const s = report ? (STATUS[report.status] ?? STATUS.unknown) : STATUS.unknown;
  return (
    <Screen title="DPF / regen" subtitle="⚠ Experimental Mode 22 reads — confirm values on the car.">
      <Card bordered padding="$3" backgroundColor="$color2">
        <H3 color={s.color}>{s.label}</H3>
        {report?.sootPct != null ? <Paragraph>Soot load {report.sootPct}%</Paragraph> : null}
        {report?.advice ? (
          <Paragraph theme="alt2" size="$2">
            {report.advice}
          </Paragraph>
        ) : null}
      </Card>

      <Button theme="blue" onPress={refresh} disabled={running}>
        {running ? 'Reading…' : 'Refresh'}
      </Button>

      <XStack flexWrap="wrap" gap="$2">
        {values.map((v) => (
          <ValueCard key={v.did} name={v.name} value={v.value} unit={v.unit} />
        ))}
      </XStack>
    </Screen>
  );
}
