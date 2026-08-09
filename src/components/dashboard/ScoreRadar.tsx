import React, { useMemo } from 'react';
import type { EChartsOption } from 'echarts';
import type { Dimension, EvaluationResult } from '@/types';
import EChart from '@/components/dashboard/EChart';
import { DIMENSION_META } from '@/constants/dimensions';
import { SERIES_COLORS } from '@/theme';

export interface ScoreRadarProps {
  results: EvaluationResult[];
  height?: number;
  /** 单模型报告里图例只是噪音，可关掉。 */
  showLegend?: boolean;
}

/** ECharts 的「空值」约定：'-' 表示该点缺失，会被断开而不是画成 0。 */
const NA_POINT = '-';

function dimensionScore(result: EvaluationResult, dimension: Dimension): number | null {
  return result.dimensionScores.find((d) => d.dimension === dimension)?.score ?? null;
}

/** N/A 铁律：null 分绝不能退化成 0，必须交给 ECharts 当空值处理。 */
function radarValue(score: number | null): number | string {
  if (score === null || !Number.isFinite(score)) return NA_POINT;
  return Math.round(score * 10) / 10;
}

/** tooltip 里拼的是 HTML，Provider 名来自用户输入，必须转义。 */
function esc(text: string): string {
  return text.replace(/[&<>"']/g, (c) => {
    if (c === '&') return '&amp;';
    if (c === '<') return '&lt;';
    if (c === '>') return '&gt;';
    if (c === '"') return '&quot;';
    return '&#39;';
  });
}

/** 同名 Provider 出现多次时补上模型名，避免图例互相覆盖。 */
function seriesName(result: EvaluationResult, all: EvaluationResult[]): string {
  const duplicated = all.filter((r) => r.providerName === result.providerName).length > 1;
  return duplicated ? `${result.providerName} · ${result.model}` : result.providerName;
}

interface RadarTooltipParam {
  name?: string;
  value?: unknown;
  marker?: string;
}

/**
 * 三维度雷达图。每个对比结果一条曲线，N/A 维度断点而非补 0。
 */
const ScoreRadar: React.FC<ScoreRadarProps> = ({ results, height = 320, showLegend = true }) => {
  const option = useMemo<EChartsOption>(() => {
    const names = results.map((r) => seriesName(r, results));

    return {
      color: results.map((_r, i) => SERIES_COLORS[i % SERIES_COLORS.length]),
      legend: {
        show: showLegend,
        data: names,
        bottom: 0,
        type: 'scroll',
        itemWidth: 12,
        itemHeight: 8,
        textStyle: { fontSize: 12, color: '#475569' },
      },
      tooltip: {
        trigger: 'item',
        confine: true,
        formatter: (params: unknown): string => {
          const raw = Array.isArray(params) ? params[0] : params;
          const item = (raw ?? {}) as RadarTooltipParam;
          const values: unknown[] = Array.isArray(item.value) ? item.value : [];
          const lines = DIMENSION_META.map((meta, i) => {
            const v = values[i];
            const text = typeof v === 'number' ? `${v} 分` : 'N/A';
            return `${esc(meta.label)}：${text}`;
          }).join('<br/>');
          return `<strong>${esc(item.name ?? '')}</strong><br/>${lines}`;
        },
      },
      radar: {
        indicator: DIMENSION_META.map((meta) => ({ name: meta.label, max: 100, min: 0 })),
        radius: '62%',
        center: ['50%', showLegend ? '46%' : '50%'],
        splitNumber: 4,
        axisName: { color: '#475569', fontSize: 12 },
        axisLine: { lineStyle: { color: '#e2e8f0' } },
        splitLine: { lineStyle: { color: '#e2e8f0' } },
        splitArea: { areaStyle: { color: ['#ffffff', '#f8fafc'] } },
      },
      series: [
        {
          type: 'radar',
          symbolSize: 5,
          lineStyle: { width: 2 },
          areaStyle: { opacity: 0.08 },
          emphasis: { focus: 'series' },
          data: results.map((r, i) => ({
            name: names[i],
            value: DIMENSION_META.map((meta) => radarValue(dimensionScore(r, meta.key))),
          })),
        },
      ],
    };
  }, [results, showLegend]);

  return <EChart option={option} height={height} />;
};

export default ScoreRadar;
