import React, { useCallback, useRef, useState } from 'react';
import { PanResponder, View } from 'react-native';
import { YStack, XStack, Paragraph, H4, Button, Text } from 'tamagui';
import Svg, { Polyline, Line, Circle } from 'react-native-svg';
import { Screen } from '@/shared/ui';
import { HintCard } from '@/features/onboarding';
import { Point } from '@/shared/obd-core';
import { useChartsStore, ChartPanel } from '../model/chartsStore';
import { useChartSeries } from '../hooks/useChartSeries';
import { useChartExport } from '../hooks/useChartExport';

const W = 320;
const H = 120;
const MIN_WINDOW = 10_000; //  10 s — most zoomed-in
const MAX_WINDOW = 600_000; // 10 min — most zoomed-out
const COLORS = ['#2bb673', '#4c9df3', '#d29922', '#f85149'];

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

interface ScreenPoint {
  x: number;
  y: number;
  t: number;
  v: number;
}

/** Map a series to SVG screen coordinates, each PID independently normalized (matches the gauges'
 *  auto-scaling). Returns both the coords (for tap-inspect) and the polyline string. */
function toScreen(pts: Point[]): { screen: ScreenPoint[]; polyline: string } {
  if (pts.length < 1) return { screen: [], polyline: '' };
  const ts = pts.map((p) => p.t);
  const vs = pts.map((p) => p.v);
  const tMin = Math.min(...ts);
  const tSpan = Math.max(...ts) - tMin || 1;
  const vMin = Math.min(...vs);
  const vSpan = Math.max(...vs) - vMin || 1;
  const screen = pts.map((p) => ({
    x: ((p.t - tMin) / tSpan) * W,
    y: H - ((p.v - vMin) / vSpan) * H,
    t: p.t,
    v: p.v,
  }));
  return { screen, polyline: screen.map((s) => `${s.x.toFixed(1)},${s.y.toFixed(1)}`).join(' ') };
}

interface Inspect {
  pid: string;
  t: number;
  v: number;
  x: number;
  y: number;
}

function Panel({ id, pids, windowMs: initialWindowMs }: ChartPanel) {
  const [windowMs, setWindowMs] = useState(initialWindowMs);
  const [panOffsetMs, setPanOffsetMs] = useState(0);
  const [inspect, setInspect] = useState<Inspect | null>(null);
  const { series, stats, oldestOffsetMs } = useChartSeries(pids, windowMs, 120, panOffsetMs);
  const { shareCsv, busy } = useChartExport();

  // Live refs so the (memoized) PanResponder handlers never read stale gesture inputs.
  const windowRef = useRef(windowMs);
  const panRef = useRef(panOffsetMs);
  const oldestRef = useRef(oldestOffsetMs);
  const screenRef = useRef<{ pid: string; pts: ScreenPoint[] }[]>([]);
  windowRef.current = windowMs;
  panRef.current = panOffsetMs;
  oldestRef.current = oldestOffsetMs;

  // Per-gesture scratch state + a simple time throttle so setState fires at most ~30 Hz.
  const startDist = useRef<number | null>(null);
  const startWindow = useRef(windowMs);
  const startPan = useRef(panOffsetMs);
  const twoFinger = useRef(false);
  const lastEmit = useRef(0);

  const emit = useCallback((fn: () => void) => {
    const now = Date.now();
    if (now - lastEmit.current < 32) return;
    lastEmit.current = now;
    fn();
  }, []);

  const inspectAt = useCallback((x: number) => {
    let best: Inspect | null = null;
    let bestDx = Infinity;
    for (const { pid, pts } of screenRef.current) {
      for (const p of pts) {
        const dx = Math.abs(p.x - x);
        if (dx < bestDx) {
          bestDx = dx;
          best = { pid, t: p.t, v: p.v, x: p.x, y: p.y };
        }
      }
    }
    setInspect(best);
  }, []);

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        twoFinger.current = false;
        startDist.current = null;
        startWindow.current = windowRef.current;
        startPan.current = panRef.current;
      },
      onPanResponderMove: (e, g) => {
        const touches = e.nativeEvent.touches;
        if (touches.length >= 2) {
          // Pinch → zoom the time window. Fingers apart (dist ↑) shrinks windowMs (zoom in).
          twoFinger.current = true;
          const [a, b] = touches;
          const dist = Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
          if (startDist.current == null) {
            startDist.current = dist;
            startWindow.current = windowRef.current;
            return;
          }
          const next = clamp((startWindow.current * startDist.current) / (dist || 1), MIN_WINDOW, MAX_WINDOW);
          emit(() => setWindowMs(next));
        } else {
          // One-finger drag → pan the window's end back/forward in time.
          const msPerPx = windowRef.current / W;
          const maxOffset = Math.max(0, oldestRef.current - windowRef.current);
          const next = clamp(startPan.current + g.dx * msPerPx, 0, maxOffset);
          emit(() => setPanOffsetMs(next));
        }
      },
      onPanResponderRelease: (e, g) => {
        // A near-stationary single-finger touch is a tap → inspect the nearest sample.
        if (!twoFinger.current && Math.abs(g.dx) < 6 && Math.abs(g.dy) < 6) {
          inspectAt(e.nativeEvent.locationX);
        }
        startDist.current = null;
      },
    }),
  ).current;

  // Rebuild the screen-space geometry each render for both drawing and tap-inspect.
  const plotted = pids.map((pid, i) => {
    const { screen, polyline } = toScreen(series[pid] ?? []);
    return { pid, color: COLORS[i % COLORS.length], screen, polyline };
  });
  screenRef.current = plotted.map((p) => ({ pid: p.pid, pts: p.screen }));

  const panned = panOffsetMs > 0;

  return (
    <YStack gap="$1" backgroundColor="$color2" padding="$3" borderRadius="$4">
      <XStack justifyContent="space-between" alignItems="center">
        <H4>{pids.join(', ')}</H4>
        <Text theme="alt2" fontSize="$2">
          {Math.round(windowMs / 1000)}s{panned ? ' · panned' : ''}
        </Text>
      </XStack>

      <View
        {...responder.panHandlers}
        accessibilityLabel={`Chart for ${pids.join(', ')}. Pinch to zoom, drag to pan, tap to inspect a sample.`}
      >
        <Svg width={W} height={H}>
          <Line x1={0} y1={H} x2={W} y2={H} stroke="#30363D" strokeWidth={1} />
          {plotted.map((p) => (
            <Polyline key={p.pid} points={p.polyline} fill="none" stroke={p.color} strokeWidth={2} />
          ))}
          {inspect ? (
            <>
              <Line x1={inspect.x} y1={0} x2={inspect.x} y2={H} stroke="#8B949E" strokeWidth={1} />
              <Circle cx={inspect.x} cy={inspect.y} r={4} fill="#E6EDF3" />
            </>
          ) : null}
        </Svg>
      </View>

      {inspect ? (
        <Paragraph theme="alt2" size="$2">
          {inspect.pid} @ {new Date(inspect.t).toLocaleTimeString()}:{' '}
          <Text fontWeight="700">{inspect.v.toFixed(1)}</Text>
        </Paragraph>
      ) : null}

      {pids.map((pid) => {
        const s = stats[pid];
        return (
          <Paragraph key={pid} theme="alt2" size="$2">
            {pid}: {s ? `now ${s.current.toFixed(1)} · min ${s.min.toFixed(1)} · max ${s.max.toFixed(1)}` : 'no data'}
          </Paragraph>
        );
      })}

      <XStack gap="$2" marginTop="$1">
        {panned ? (
          <Button size="$2" theme="alt2" onPress={() => setPanOffsetMs(0)}>
            Back to live
          </Button>
        ) : null}
        {inspect ? (
          <Button size="$2" theme="alt2" onPress={() => setInspect(null)}>
            Clear
          </Button>
        ) : null}
        <Button
          size="$2"
          theme="blue"
          disabled={busy}
          onPress={() => shareCsv(`chart-${id}`, series)}
        >
          Share window (CSV)
        </Button>
      </XStack>
    </YStack>
  );
}

export function ChartsScreen() {
  const panels = useChartsStore((s) => s.panels);
  return (
    <Screen title="Charts" subtitle="Live parameters over time">
      <HintCard id="charts-gestures" title="Explore the chart">
        Pinch to zoom the time window (10 s–10 min), drag left/right to pan through history, and tap a
        line to read the exact value and time. Use “Share window (CSV)” to send the data out.
      </HintCard>
      {panels.map((p) => (
        <Panel key={p.id} id={p.id} pids={p.pids} windowMs={p.windowMs} />
      ))}
    </Screen>
  );
}
