import React from 'react';
import { View, Text } from 'react-native';
import Svg, { Path, Circle, Line, Defs, LinearGradient, Stop } from 'react-native-svg';

// Real-data projection chart. Consumes an array of { label, value } points
// (already-computed numbers from the same source-of-truth math as the
// headline number on the surrounding card). The final point plotted MUST
// exactly equal the displayed projection number — that is the reconciliation
// guarantee.
export type ChartPoint = { label: string; value: number };

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
};

const DEFAULT_MONEY = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

export default function ProjectionLineChart({ points, height = 130, strokeColor = '#8b6437', gradientTop = 'rgba(232,201,143,0.35)', gradientBottom = 'rgba(232,201,143,0)', currency = DEFAULT_MONEY, showLabels = true, ready = true, emptyLabel = 'Not enough data yet.' }: Props) {
  if (!ready) {
    return (
      <View style={{ height, backgroundColor: '#efe6d0', borderRadius: 10, opacity: 0.5, marginTop: 8, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: 10, color: '#9a6d32' }}>Updating…</Text>
      </View>
    );
  }
  if (!points || points.length < 2) {
    return (
      <View style={{ height, borderRadius: 10, marginTop: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 }}>
        <Text style={{ fontSize: 10, color: '#9a6d32', textAlign: 'center', lineHeight: 14 }}>{emptyLabel}</Text>
      </View>
    );
  }

  const W = 320, PADDING_X = 24, PADDING_Y = 20;
  const innerW = W - PADDING_X * 2;
  const innerH = height - PADDING_Y * 2;
  const values = points.map(p => p.value);
  const minV = Math.min(...values, 0);
  const maxV = Math.max(...values, 1);
  const range = Math.max(1, maxV - minV);
  // Convert data point → SVG coord.
  const xAt = (i: number) => PADDING_X + (i / (points.length - 1)) * innerW;
  const yAt = (v: number) => PADDING_Y + innerH - ((v - minV) / range) * innerH;

  // Smooth path using cubic bezier curves between consecutive points so the
  // compounding-style curve reads as growth, not straight zig-zag.
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

  return (
    <View style={{ marginTop: 8 }}>
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
        {points.map((p, i) => (
          <Circle key={i} cx={xAt(i)} cy={yAt(p.value)} r={i === points.length - 1 ? 3.5 : 2.5} fill={strokeColor} />
        ))}
      </Svg>
      {showLabels && (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4, marginTop: 4 }}>
          {points.map((p, i) => (
            <View key={i} style={{ alignItems: 'center', flex: 1 }}>
              <Text style={{ fontSize: 8, fontWeight: '700', color: '#a97c39', letterSpacing: 0.4 }}>{p.label}</Text>
              <Text style={{ fontSize: 8, color: '#8d806e', marginTop: 1 }} numberOfLines={1}>
                {i === 0 || i === points.length - 1 ? currency(p.value) : ''}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
