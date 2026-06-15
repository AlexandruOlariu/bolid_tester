import React from 'react';
import { YStack, Paragraph, H4 } from 'tamagui';
import Svg, { Polyline, Line } from 'react-native-svg';
import { Screen } from '@/shared/ui';
import { Point } from '@/shared/obd-core';
import { useChartsStore } from '../model/chartsStore';
import { useChartSeries } from '../hooks/useChartSeries';

const W = 320;
const H = 120;

function pointsToPolyline(pts: Point[]): string {
  if (pts.length < 2) return '';
  const ts = pts.map((p) => p.t);
  const vs = pts.map((p) => p.v);
  const tMin = Math.min(...ts);
  const tMax = Math.max(...ts);
  const vMin = Math.min(...vs);
  const vMax = Math.max(...vs);
  const tSpan = tMax - tMin || 1;
  const vSpan = vMax - vMin || 1;
  return pts
    .map((p) => {
      const x = ((p.t - tMin) / tSpan) * W;
      const y = H - ((p.v - vMin) / vSpan) * H;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

function Panel({ pids, windowMs }: { pids: string[]; windowMs: number }) {
  const { series, stats } = useChartSeries(pids, windowMs);
  return (
    <YStack gap="$1" backgroundColor="$color2" padding="$3" borderRadius="$4">
      <H4>{pids.join(', ')}</H4>
      <Svg width={W} height={H}>
        <Line x1={0} y1={H} x2={W} y2={H} stroke="#30363D" strokeWidth={1} />
        {pids.map((pid) => (
          <Polyline
            key={pid}
            points={pointsToPolyline(series[pid] ?? [])}
            fill="none"
            stroke="#2bb673"
            strokeWidth={2}
          />
        ))}
      </Svg>
      {pids.map((pid) => {
        const s = stats[pid];
        return (
          <Paragraph key={pid} theme="alt2" size="$2">
            {pid}: {s ? `now ${s.current.toFixed(1)} · min ${s.min.toFixed(1)} · max ${s.max.toFixed(1)}` : 'no data'}
          </Paragraph>
        );
      })}
    </YStack>
  );
}

export function ChartsScreen() {
  const panels = useChartsStore((s) => s.panels);
  return (
    <Screen title="Charts" subtitle="Live parameters over time">
      {panels.map((p) => (
        <Panel key={p.id} pids={p.pids} windowMs={p.windowMs} />
      ))}
    </Screen>
  );
}
