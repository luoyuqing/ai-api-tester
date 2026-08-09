import React, { useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import type { ECharts, EChartsOption } from 'echarts';

export interface EChartProps {
  option: EChartsOption;
  height?: number;
  /** 传给容器的额外 class，默认用全局的 .aiat-chart。 */
  className?: string;
}

/**
 * 极薄的 ECharts 封装。
 *
 * 这里直接用原生 `echarts.init` 而不是 `echarts-for-react`：
 * 原生 API 自带完整 TS 类型、不依赖额外的 esModuleInterop 配置，
 * 也省掉了一层无谓的 props 转发。
 * 尺寸变化用 ResizeObserver 处理；容器塌陷（宽或高为 0）时跳过 resize，
 * 否则 ECharts 会打印 "Can't get dom width or height" 警告。
 */
const EChart: React.FC<EChartProps> = ({ option, height = 320, className }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<ECharts | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;

    const chart = echarts.init(el, undefined, { renderer: 'canvas' });
    chartRef.current = chart;

    const observer = new ResizeObserver(() => {
      if (el.clientWidth > 0 && el.clientHeight > 0) chart.resize();
    });
    observer.observe(el);

    return () => {
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    // notMerge=true：切换对比模型时旧 series 必须被彻底清掉，否则会残留幽灵图形。
    chart.setOption(option, true);
  }, [option]);

  return <div ref={containerRef} className={className ?? 'aiat-chart'} style={{ height }} />;
};

export default EChart;
