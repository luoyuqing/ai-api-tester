import React, { useMemo } from 'react';
import type { EChartsOption } from 'echarts';
import type { Dimension, EvaluationResult, MetricRecord } from '@/types';
import { SUB_METRIC_META } from '@/constants/dimensions';
import { SERIES_COLORS } from '@/theme';
import { SCORE_THRESHOLDS } from '@/constants/scoring';
import EChart from '@/components/dashboard/EChart';
import EmptyState from '@/components/common/EmptyState';

export interface ScoreBarsProps {
  results: EvaluationResult[];
  /** 只画某个维度的子指标；不传则画全部。 */
  dimension?: Dimension;
  height?: number;
}

function metricMapOf(result: EvaluationResult): Map<string, MetricRecord> {
  const map = new Map<string, MetricRecord>();
  result.dimensionScores.forEach((d) => d.metrics.forEach((m) => map.set(m.key, m)));
  return map;
}

/**
 * 子指标得分条形图（横向分组柱）。
 *
 * N/A 用 null 传给 ECharts，这样柱子会真的缺席而不是画成 0 —— 这与「N/A 不计权」的
 * 口径一致，也让读图的人一眼看出是「没测到」而不是「测了 0 分」。
 */
const ScoreBars: React.FC<ScoreBarsProps> = ({ results, dimension, height }) => {
  const maps = useMemo(() => results.map(metricMapOf), [results]);

  /** 按 SUB_METRIC_META 的固定顺序取，保证不同结果之间行序一致。 */
  const keys = useMemo(() => {
    const candidates = SUB_METRIC_META.filter(
      (m) => dimension === undefined || m.dimension === dimension,
    );
    return candidates.filter((m) => maps.some((map) => map.has(m.key)));
  }, [maps, dimension]);

  const option = useMemo<EChartsOption>(() => {
    // 横向柱状图的 yAxis 是自底向上的，反转一次让第一个指标出现在顶部。
    const categories = keys.map((m) => m.label).reverse();

    return {
      color: results.map((_r, i) => SERIES_COLORS[i % SERIES_COLORS.length]),
      grid: { left: 96, right: 40, top: 32, bottom: 8, containLabel: true },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: { top: 0, type: 'scroll', data: results.map((r) => r.providerName) },
      xAxis: {
        type: 'value',
        min: 0,
        max: 100,
        splitLine: { lineStyle: { color: '#e2e8f0' } },
        axisLabel: { color: '#64748b' },
      },
      yAxis: {
        type: 'category',
        data: categories,
        axisLabel: { color: '#475569', fontSize: 12 },
        axisTick: { show: false },
      },
      series: results.map((r, i) => ({
        name: r.providerName,
        type: 'bar',
        barMaxWidth: 14,
        itemStyle: { borderRadius: [0, 3, 3, 0] },
        markLine:
          i === 0
            ? {
                silent: true,
                symbol: 'none',
                lineStyle: { color: '#cbd5e1', type: 'dashed' },
                label: { fontSize: 10, color: '#94a3b8' },
                data: [
                  { xAxis: SCORE_THRESHOLDS.FAIR, name: '及格线' },
                  { xAxis: SCORE_THRESHOLDS.EXCELLENT, name: '优秀线' },
                ],
              }
            : undefined,
        data: keys
          .map((meta) => {
            const record = maps[i].get(meta.key);
            return record && record.score !== null ? Math.round(record.score * 10) / 10 : null;
          })
          .reverse(),
      })),
    };
  }, [results, keys, maps]);

  if (results.length === 0 || keys.length === 0) {
    return (
      <EmptyState
        title="没有可展示的子指标"
        description="所选维度下的所有子指标都是 N/A，或该结果未覆盖此维度。"
        minHeight={160}
      />
    );
  }

  const autoHeight = 64 + keys.length * Math.max(28, 16 * results.length + 12);
  return <EChart option={option} height={height ?? autoHeight} />;
};

export default ScoreBars;
