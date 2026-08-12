import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, PanResponder, LayoutChangeEvent } from 'react-native';
import Svg, { Path, Circle, Line, Defs, LinearGradient, Stop } from 'react-native-svg';

// Real-data projection chart. Consumes an array of { label, value } points
// (already-computed numbers from the same source-of-truth math as the
// headline number on the surrounding card). The final point plotted MUST
// exactly equal the displayed projection number — that is the reconciliation
// guarantee.
//
// Interactive (spec #26): tapping / dragging on the chart snaps to the
// nearest data point and surfaces an inline tooltip with:
//   • label (e.g. "Today", "10YR", "May 2027")
//   • exact dollar amount
//   • change from previous point (+$XXX / -$XXX)
// Tap outside the chart to dismiss.
export type ChartPoint = {
  label: string;
  value: number;
  // Optional metadata carried through so callers can render richer
  // tooltips (e.g. "Actual" vs "Projected", full ISO date, etc.). None
  // are required — they're all read defensively.
  meta?: {
    source?: 'actual' | 'budgeted' | 'estimated' | 'projected';
    fullLabel?: string;
    subtitle?: string;
  };
};

type Props = {
  points: ChartPoint[];
  height?: number;
  strokeColor?: string;
  gradientTop?: string;
  gradientBottom?: string;
  currency?: (n: number) => string;
  showLabels?: boolean;
  ready?: boolean; // when false, render a skeleton instead of the chart
  emptyLabel?: string;
  labelColor?: string;      // "TODAY" / "3Y" pill text
  labelValueColor?: string; // small dollar values under the pills
  emptyColor?: string;      // empty-state text color
  skeletonBg?: string;
  // When true (default), enables the tap-to-inspect tooltip. Set to false
  // for micro-charts that don't have room to render a tooltip overlay.
  interactive?: boolean;
  // Tooltip styling overrides for dark hero cards.
  tooltipBg?: string;
  tooltipText?: string;
  tooltipMuted?: string;
};

const DEFAULT_MONEY = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

export default function ProjectionLineChart({
  points,
  height = 130,
  strokeColor = '#8b6437',
  gradientTop = 'rgba(232,201,143,0.35)',
  gradientBottom = 'rgba(232,201,143,0)',
  currency = DEFAULT_MONEY,
  showLabels = true,
  ready = true,
  emptyLabel = 'Not enough data yet.',
  labelColor = '#a97c39',
  labelValueColor = '#8d806e',
  emptyColor = '#9a6d32',
  skeletonBg = '#efe6d0',
  interactive = true,
  tooltipBg = '#181714ee',
  tooltipText = '#f3ecdf',
  tooltipMuted = '#bdb6ac',
}: Props) {
  // Selected point index (null = no tooltip). Set by pan/tap.
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  // Clear the active point when the parent swaps the data (e.g. user
  // changes timeframe). Otherwise the tooltip lingers on an index that
  // no longer corresponds to the same real data point.
  useEffect(() => { setActiveIdx(null); }, [points]);
  // Actual rendered width from onLayout — used to translate PanResponder
  // page-space coordinates back into SVG viewBox coordinates. Falls back
  // to the SVG viewBox width so first-render taps still work.
  const [renderedWidth, setRenderedWidth] = useState(320);
  const containerRef = useRef<View | null>(null);

  const W = 320;
  const PADDING_X = 24;
  const PADDING_Y = 20;

  const chartMath = useMemo(() => {
    if (!points || points.length < 2) return null;
    const values = points.map(p => p.value);
    const minV = Math.min(...values, 0);
    const maxV = Math.max(...values, 1);
    const range = Math.max(1, maxV - minV);
    const innerW = W - PADDING_X * 2;
    const innerH = height - PADDING_Y * 2;
    const xAt = (i: number) => PADDING_X + (i / (points.length - 1)) * innerW;
    const yAt = (v: number) => PADDING_Y + innerH - ((v - minV) / range) * innerH;
    const pathD = points
      .map((p, i) => {
        const x = xAt(i);
        const y = yAt(p.value);
        if (i === 0) return `M ${x},${y}`;
        const prevX = xAt(i - 1);
        const prevY = yAt(points[i - 1].value);
        const cx1 = prevX + (x - prevX) * 0.5;
        const cx2 = prevX + (x - prevX) * 0.5;
        return `C ${cx1},${prevY} ${cx2},${y} ${x},${y}`;
      })
      .join(' ');
    const areaD = `${pathD} L ${xAt(points.length - 1)},${PADDING_Y + innerH} L ${xAt(0)},${PADDING_Y + innerH} Z`;
    return { minV, maxV, range, innerW, innerH, xAt, yAt, pathD, areaD };
  }, [points, height]);

  // Convert a page-space X (from PanResponder locationX) into the nearest
  // point index. Robust against unusual container widths + non-square
  // viewports because we read the actual rendered width from onLayout.
  const nearestIndex = useCallback((locationX: number): number => {
    if (!points || points.length < 2) return 0;
    const scale = W / Math.max(1, renderedWidth);
    const svgX = locationX * scale;
    const innerW = W - PADDING_X * 2;
    const step = innerW / (points.length - 1);
    const idx = Math.round((svgX - PADDING_X) / step);
    return Math.max(0, Math.min(points.length - 1, idx));
  }, [points, renderedWidth]);

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => interactive,
    onMoveShouldSetPanResponder: () => interactive,
    onPanResponderGrant: (e) => {
      const idx = nearestIndex(e.nativeEvent.locationX);
      setActiveIdx(idx);
    },
    onPanResponderMove: (e) => {
      const idx = nearestIndex(e.nativeEvent.locationX);
      setActiveIdx(idx);
    },
    onPanResponderRelease: () => {
      // Keep the tooltip visible after release; tap-outside would clear
      // it via the parent. For inline charts this "sticky" behavior lets
      // users read the value without holding their finger down.
    },
  }), [interactive, nearestIndex]);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0 && Math.abs(w - renderedWidth) > 1) setRenderedWidth(w);
  }, [renderedWidth]);

  if (!ready) {
    return (
      <View style={{ height, backgroundColor: skeletonBg, borderRadius: 10, opacity: 0.5, marginTop: 8, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: 10, color: emptyColor }}>Updating…</Text>
      </View>
    );
  }
  if (!points || points.length < 2 || !chartMath) {
    return (
      <View style={{ height, borderRadius: 10, marginTop: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 }}>
        <Text style={{ fontSize: 10, color: emptyColor, textAlign: 'center', lineHeight: 14 }}>{emptyLabel}</Text>
      </View>
    );
  }

  const { xAt, yAt, pathD, areaD, minV } = chartMath;
  const active = activeIdx != null ? points[activeIdx] : null;
  const prev = activeIdx != null && activeIdx > 0 ? points[activeIdx - 1] : null;
  const delta = active && prev ? active.value - prev.value : null;

  return (
    <View style={{ marginTop: 8 }} ref={containerRef} onLayout={onLayout}>
      {/* Tooltip — floats above the chart when a point is selected. Compact
          card design so it never covers the full chart. */}
      {active && (
        <View
          style={{
            pointerEvents: 'none',
            position: 'absolute',
            top: -6,
            left: 0,
            right: 0,
            alignItems: 'center',
            zIndex: 10,
          }}
        >
          <View style={{
            backgroundColor: tooltipBg,
            paddingHorizontal: 10,
            paddingVertical: 6,
            borderRadius: 10,
            minWidth: 130,
            maxWidth: 240,
          }}>
            <Text style={{ fontSize: 8, fontWeight: '800', color: tooltipMuted, letterSpacing: 0.6 }}>
              {(active.meta?.fullLabel || active.label).toUpperCase()}
              {active.meta?.source ? ` · ${active.meta.source.toUpperCase()}` : ''}
            </Text>
            <Text style={{ fontSize: 14, fontWeight: '800', color: tooltipText, marginTop: 2 }}>
              {currency(active.value)}
            </Text>
            {delta != null && Math.abs(delta) > 0.5 && (
              <Text style={{
                fontSize: 9,
                color: delta >= 0 ? '#8ee0a8' : '#e79b7c',
                fontWeight: '700',
                marginTop: 1,
              }}>
                {delta >= 0 ? '+' : '−'}{currency(Math.abs(delta))} vs {prev?.label}
              </Text>
            )}
            {active.meta?.subtitle && (
              <Text style={{ fontSize: 8, color: tooltipMuted, marginTop: 2 }} numberOfLines={1}>
                {active.meta.subtitle}
              </Text>
            )}
          </View>
        </View>
      )}
      <View {...panResponder.panHandlers}>
        <Svg width="100%" height={height} viewBox={`0 0 ${W} ${height}`}>
          <Defs>
            <LinearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0%" stopColor={gradientTop} stopOpacity="1" />
              <Stop offset="100%" stopColor={gradientBottom} stopOpacity="0" />
            </LinearGradient>
          </Defs>
          {/* Baseline (0 line) if the min value is negative or zero */}
          {minV <= 0 && (
            <Line x1={PADDING_X} y1={yAt(0)} x2={W - PADDING_X} y2={yAt(0)} stroke="#e6dcc5" strokeWidth={1} strokeDasharray="2 3" />
          )}
          <Path d={areaD} fill="url(#chartFill)" />
          <Path d={pathD} stroke={strokeColor} strokeWidth={2} fill="none" />
          {points.map((p, i) => {
            const isActive = i === activeIdx;
            const r = isActive ? 5 : (i === points.length - 1 ? 3.5 : 2.5);
            return <Circle key={i} cx={xAt(i)} cy={yAt(p.value)} r={r} fill={strokeColor} />;
          })}
          {/* Vertical guide line for the active point — makes the value
              easy to read against the label strip below the chart. */}
          {activeIdx != null && (
            <Line
              x1={xAt(activeIdx)}
              x2={xAt(activeIdx)}
              y1={PADDING_Y}
              y2={height - PADDING_Y}
              stroke={strokeColor}
              strokeWidth={0.75}
              strokeDasharray="2 2"
              opacity={0.55}
            />
          )}
        </Svg>
      </View>
      {showLabels && (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4, marginTop: 4 }}>
          {points.map((p, i) => (
            <View key={i} style={{ alignItems: 'center', flex: 1 }}>
              <Text style={{
                fontSize: 8,
                fontWeight: activeIdx === i ? '800' : '700',
                color: labelColor,
                letterSpacing: 0.4,
              }}>{p.label}</Text>
              <Text style={{ fontSize: 8, color: labelValueColor, marginTop: 1 }} numberOfLines={1}>
                {i === 0 || i === points.length - 1 || activeIdx === i ? currency(p.value) : ''}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
