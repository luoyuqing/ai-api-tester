/**
 * 自包含 HTML 报告生成。
 *
 * 产物为单个 .html 文件：
 *  - 通过 `?raw` 把 ECharts 运行时内联进文档，离线即可渲染交互图表；
 *  - 评测数据以 JSON 形式嵌入各图表 option，打开时由内联脚本初始化；
 *  - 指标明细以表格呈现，便于复制与归档。
 *
 * 既可在桌面 Electron 下由主进程落盘（electronAPI.saveReport），
 * 也可在纯 Web 环境下作为 Blob 下载（见 ExportButtons 兜底）。
 */
import type { Dimension, EvaluationResult, MetricRecord } from '@/types';
import { DIMENSION_LABELS } from '@/constants/dimensions';
import { resultBaseName } from '@/lib/export';
// 内联 ECharts 运行时，保证报告离线可交互。
import echartsRaw from 'echarts/dist/echarts.min.js?raw';

const DIM_ORDER: Dimension[] = ['performance', 'functionality', 'safety'];

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function scoreNum(v: number | null): number {
  return v === null || !Number.isFinite(v) ? 0 : Math.round(v * 10) / 10;
}

function colorFor(score: number | null): string {
  const s = scoreNum(score);
  if (s >= 80) return '#2e9e5b';
  if (s >= 60) return '#d98a00';
  return '#cf3b3b';
}

function scoreBadge(score: number | null): string {
  if (score === null || !Number.isFinite(score)) {
    return '<span class="badge na">N/A</span>';
  }
  return `<span class="badge" style="background:${colorFor(score)}">${scoreNum(score)}</span>`;
}

// ───────────────────────── 图表 option ─────────────────────────

function radarOption(result: EvaluationResult): Record<string, unknown> {
  const vals = DIM_ORDER.map((d) => scoreNum(result.dimensionScores.find((x) => x.dimension === d)?.score ?? null));
  return {
    tooltip: {},
    radar: {
      radius: '62%',
      indicator: DIM_ORDER.map((d) => ({ name: DIMENSION_LABELS[d], max: 100 })),
    },
    series: [
      {
        type: 'radar',
        data: [{ value: vals, name: escapeHtml(result.model) }],
        areaStyle: { opacity: 0.18 },
        lineStyle: { color: '#3b6df0' },
        itemStyle: { color: '#3b6df0' },
      },
    ],
  };
}

function dimBarOption(result: EvaluationResult): Record<string, unknown> {
  const vals = DIM_ORDER.map((d) => scoreNum(result.dimensionScores.find((x) => x.dimension === d)?.score ?? null));
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 64, right: 36, top: 16, bottom: 16 },
    xAxis: { type: 'value', max: 100 },
    yAxis: { type: 'category', data: DIM_ORDER.map((d) => DIMENSION_LABELS[d]) },
    series: [
      {
        type: 'bar',
        data: vals.map((v) => ({ value: v, itemStyle: { color: colorFor(v) } })),
        label: { show: true, position: 'right', formatter: '{c}' },
        barWidth: '55%',
      },
    ],
  };
}

function compareBarOption(results: EvaluationResult[]): Record<string, unknown> {
  const cats = ['综合', ...DIM_ORDER.map((d) => DIMENSION_LABELS[d])];
  const series = results.map((r, i) => {
    const overall = scoreNum(r.overallScore);
    const dims = DIM_ORDER.map((d) => scoreNum(r.dimensionScores.find((x) => x.dimension === d)?.score ?? null));
    const palette = ['#3b6df0', '#2e9e5b', '#d98a00', '#9b59b6', '#e056a0'];
    return {
      name: escapeHtml(r.model),
      type: 'bar',
      data: [overall, ...dims].map((v) => ({ value: v, itemStyle: { color: palette[i % palette.length] } })),
    };
  });
  return {
    tooltip: { trigger: 'axis' },
    legend: { data: results.map((r) => escapeHtml(r.model)), top: 0 },
    grid: { left: 48, right: 24, top: 36, bottom: 16 },
    xAxis: { type: 'category', data: cats },
    yAxis: { type: 'value', max: 100 },
    series,
  };
}

// ───────────────────────── 段落渲染 ─────────────────────────

function metricRows(metrics: MetricRecord[]): string {
  if (metrics.length === 0) return '<tr><td colspan="4" class="muted">无指标</td></tr>';
  return metrics
    .map(
      (m) => `<tr>
        <td>${escapeHtml(m.label)}</td>
        <td>${escapeHtml(m.displayValue)}</td>
        <td>${scoreBadge(m.score)}</td>
        <td class="muted">${m.naReason ? escapeHtml(m.naReason) : '—'}</td>
      </tr>`,
    )
    .join('');
}

function resultSection(result: EvaluationResult, idx: number): string {
  const dimCards = result.dimensionScores
    .map(
      (d) => `<div class="dim">
        <h4>${DIMENSION_LABELS[d.dimension]} ${scoreBadge(d.score)}</h4>
        <table class="metrics">
          <thead><tr><th>指标</th><th>实测</th><th>得分</th><th>说明</th></tr></thead>
          <tbody>${metricRows(d.metrics)}</tbody>
        </table>
      </div>`,
    )
    .join('');

  const radarId = `radar-${idx}`;
  const barId = `bar-${idx}`;

  return `
  <section class="card">
    <div class="card-head">
      <div>
        <h3>${escapeHtml(result.providerName)} · ${escapeHtml(result.model)}</h3>
        <div class="muted">引擎 ${escapeHtml(result.engineVersion)} · 生成于 ${new Date(result.endedAt).toLocaleString('zh-CN')}</div>
      </div>
      <div class="overall">综合 ${scoreBadge(result.overallScore)}</div>
    </div>
    <div class="charts">
      <div id="${radarId}" class="chart"></div>
      <div id="${barId}" class="chart"></div>
    </div>
    <div class="dims">${dimCards}</div>
    <script>
      (function(){
        var el1 = document.getElementById('${radarId}');
        if (el1 && window.echarts) window.echarts.init(el1).setOption(${JSON.stringify(radarOption(result))});
        var el2 = document.getElementById('${barId}');
        if (el2 && window.echarts) window.echarts.init(el2).setOption(${JSON.stringify(dimBarOption(result))});
      })();
    </script>
  </section>`;
}

function summaryTable(results: EvaluationResult[]): string {
  const rows = results
    .map(
      (r) => `<tr>
        <td>${escapeHtml(r.providerName)}</td>
        <td>${escapeHtml(r.model)}</td>
        <td>${scoreBadge(r.overallScore)}</td>
        <td>${scoreBadge(r.dimensionScores.find((x) => x.dimension === 'performance')?.score ?? null)}</td>
        <td>${scoreBadge(r.dimensionScores.find((x) => x.dimension === 'functionality')?.score ?? null)}</td>
        <td>${scoreBadge(r.dimensionScores.find((x) => x.dimension === 'safety')?.score ?? null)}</td>
      </tr>`,
    )
    .join('');
  return `<table class="summary">
    <thead><tr><th>厂商</th><th>模型</th><th>综合</th><th>性能</th><th>功能</th><th>安全</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

// ───────────────────────── 对外 API ─────────────────────────

const STYLE = `
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; margin: 0; background: #f5f6f8; color: #1f2430; }
  .wrap { max-width: 1040px; margin: 0 auto; padding: 28px 20px 60px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .sub { color: #6b7280; font-size: 13px; margin-bottom: 18px; }
  .card { background: #fff; border: 1px solid #e6e8ec; border-radius: 12px; padding: 18px; margin-bottom: 18px; box-shadow: 0 1px 2px rgba(0,0,0,.04); }
  .card-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
  .card-head h3 { margin: 0 0 4px; font-size: 16px; }
  .overall { font-size: 14px; white-space: nowrap; }
  .charts { display: flex; gap: 12px; flex-wrap: wrap; margin: 12px 0; }
  .chart { flex: 1 1 320px; height: 280px; min-width: 280px; }
  .dims { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 14px; }
  .dim h4 { margin: 0 0 8px; font-size: 14px; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #eef0f3; }
  thead th { color: #6b7280; font-weight: 500; }
  .summary { background: #fff; border: 1px solid #e6e8ec; border-radius: 12px; overflow: hidden; margin-bottom: 22px; }
  .metrics { margin-top: 4px; }
  .muted { color: #9aa1ad; }
  .badge { display: inline-block; min-width: 34px; text-align: center; color: #fff; border-radius: 6px; padding: 2px 8px; font-weight: 600; }
  .badge.na { background: #b7bdc7; }
  .compare { height: 320px; }
`;

/** 生成自包含 HTML 报告字符串。 */
export function buildReportHtml(results: EvaluationResult[]): string {
  if (results.length === 0) return '';
  const generatedAt = new Date().toLocaleString('zh-CN');
  const header = `
    <div class="wrap">
      <h1>AI API 质量评测报告</h1>
      <div class="sub">共 ${results.length} 个模型 · 生成时间 ${generatedAt} · 引擎 ${escapeHtml(results[0].engineVersion)}</div>
      ${summaryTable(results)}
      ${results.length > 1 ? `<section class="card"><h3>模型横向对比</h3><div id="compare" class="chart compare"></div>
        <script>(function(){var el=document.getElementById('compare');if(el&&window.echarts)window.echarts.init(el).setOption(${JSON.stringify(compareBarOption(results))});})();</script>
      </section>` : ''}
      ${results.map((r, i) => resultSection(r, i)).join('')}
    </div>`;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>AI API 质量评测报告</title>
<style>${STYLE}</style>
<script>${echartsRaw}</script>
</head>
<body>
${header}
</body>
</html>`;
}

/** 报告默认文件名（多模型时取首个模型名 + 数量）。 */
export function buildReportFileName(results: EvaluationResult[]): string {
  if (results.length === 1) return `${resultBaseName(results[0])}.html`;
  const first = results[0];
  return `aiat-report-${first.providerName}-${results.length}models-${Date.now()}.html`.replace(/[\\/:*?"<>|\s]+/g, '-');
}
