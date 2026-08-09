/**
 * 结果导出（纯前端，Blob + a[download]，无任何服务端上报路径）。
 *
 * - JSON：完整 EvaluationResult（含配置快照与探针明细），可复现可审计。
 * - CSV ：面向 Excel 的扁平指标表，带 UTF-8 BOM 以避免中文乱码。
 */
import type { Dimension, EvaluationResult, MetricRecord } from '@/types';
import { DIMENSION_LABELS } from '@/constants/dimensions';
import { toIsoUtc } from '@/lib/timer';

/** Excel 需要 BOM 才能正确识别 UTF-8。 */
const BOM = '\uFEFF';

/** 转义单个 CSV 字段。 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/** 二维数组 → CSV 文本。 */
export function toCsv(rows: ReadonlyArray<ReadonlyArray<unknown>>): string {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}

/** 文件名安全化：去掉路径分隔符与非法字符。 */
export function safeFileName(input: string): string {
  const cleaned = input.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return cleaned.length > 0 ? cleaned.slice(0, 80) : 'export';
}

/** 时间戳后缀，如 20260808-113022。 */
export function fileStamp(ts: number = Date.now()): string {
  const d = new Date(ts);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

/** 触发浏览器下载。 */
export function downloadBlob(content: string, fileName: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // 交给下一帧释放，避免部分浏览器还没开始下载就回收了 URL。
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadJson(data: unknown, fileName: string): void {
  downloadBlob(JSON.stringify(data, null, 2), fileName, 'application/json;charset=utf-8');
}

export function downloadCsv(rows: ReadonlyArray<ReadonlyArray<unknown>>, fileName: string): void {
  downloadBlob(`${BOM}${toCsv(rows)}`, fileName, 'text/csv;charset=utf-8');
}

// ───────────────────────── 辅助读数 ─────────────────────────

function dimensionLabel(dimension: Dimension): string {
  return DIMENSION_LABELS[dimension] ?? dimension;
}

function dimensionScoreOf(result: EvaluationResult, dimension: Dimension): number | null {
  return result.dimensionScores.find((d) => d.dimension === dimension)?.score ?? null;
}

/** 打平一个结果的全部子指标，保持维度内原有顺序。 */
export function flattenMetrics(result: EvaluationResult): MetricRecord[] {
  const out: MetricRecord[] = [];
  result.dimensionScores.forEach((d) => {
    d.metrics.forEach((m) => out.push(m));
  });
  return out;
}

function scoreCell(score: number | null): string {
  return score === null || !Number.isFinite(score) ? 'N/A' : String(Math.round(score * 10) / 10);
}

// ───────────────────────── 单结果导出 ─────────────────────────

export function resultBaseName(result: EvaluationResult): string {
  return safeFileName(`aiat-${result.providerName}-${result.model}-${fileStamp(result.endedAt)}`);
}

/** 导出单个评测结果的完整 JSON。 */
export function exportResultJson(result: EvaluationResult): void {
  downloadJson(
    {
      exportedAt: new Date().toISOString(),
      exportKind: 'evaluation-result',
      schema: 1,
      result,
    },
    `${resultBaseName(result)}.json`,
  );
}

/** 导出单个评测结果的指标明细 CSV。 */
export function exportResultCsv(result: EvaluationResult): void {
  const rows: unknown[][] = [];

  rows.push(['# 评测结果导出']);
  rows.push(['结果 ID', result.id]);
  rows.push(['任务 ID', result.taskId]);
  rows.push(['任务名称', result.configSnapshot.name]);
  rows.push(['Provider', result.providerName]);
  rows.push(['模型', result.model]);
  rows.push(['引擎版本', result.engineVersion]);
  rows.push(['开始时间(UTC)', toIsoUtc(result.startedAt)]);
  rows.push(['结束时间(UTC)', toIsoUtc(result.endedAt)]);
  rows.push(['综合得分', scoreCell(result.overallScore)]);
  result.dimensionScores.forEach((d) => {
    rows.push([`${dimensionLabel(d.dimension)}得分`, scoreCell(d.score), `有效权重 ${d.effectiveWeight}`]);
  });
  rows.push([]);

  rows.push(['维度', '指标 Key', '指标名称', '原始值', '展示值', '得分', '权重', 'N/A 原因']);
  result.dimensionScores.forEach((d) => {
    d.metrics.forEach((m) => {
      rows.push([
        dimensionLabel(m.dimension),
        m.key,
        m.label,
        m.rawValue,
        m.displayValue,
        scoreCell(m.score),
        m.weight,
        m.naReason ?? '',
      ]);
    });
  });

  downloadCsv(rows, `${resultBaseName(result)}.csv`);
}

// ───────────────────────── 多结果对比导出 ─────────────────────────

/** 导出多结果对比 CSV：行=指标，列=各模型。 */
export function exportComparisonCsv(results: EvaluationResult[]): void {
  if (results.length === 0) return;

  const header: unknown[] = ['分组', '指标 Key', '指标名称'];
  results.forEach((r) => {
    header.push(`${r.providerName} 展示值`, `${r.providerName} 得分`);
  });

  const rows: unknown[][] = [];
  rows.push(['# 模型对比导出', `导出时间(UTC) ${new Date().toISOString()}`, `模型数 ${results.length}`]);
  rows.push([]);

  // 概览行
  rows.push(['分组', '项', '说明', ...results.flatMap((r) => [r.providerName, ''])]);
  rows.push(['概览', 'model', '模型名', ...results.flatMap((r) => [r.model, ''])]);
  rows.push([
    '概览',
    'overall',
    '综合得分',
    ...results.flatMap((r) => [scoreCell(r.overallScore), '']),
  ]);
  (['performance', 'functionality', 'safety'] as Dimension[]).forEach((dim) => {
    rows.push([
      '概览',
      dim,
      `${dimensionLabel(dim)}得分`,
      ...results.flatMap((r) => [scoreCell(dimensionScoreOf(r, dim)), '']),
    ]);
  });
  rows.push([]);

  // 指标明细：以出现顺序合并所有 key
  const metricMaps = results.map((r) => {
    const map = new Map<string, MetricRecord>();
    flattenMetrics(r).forEach((m) => map.set(m.key, m));
    return map;
  });
  const orderedKeys: string[] = [];
  const seen = new Set<string>();
  metricMaps.forEach((map) => {
    map.forEach((_value, key) => {
      if (!seen.has(key)) {
        seen.add(key);
        orderedKeys.push(key);
      }
    });
  });

  rows.push(header);
  orderedKeys.forEach((key) => {
    const sample = metricMaps.map((m) => m.get(key)).find((m): m is MetricRecord => Boolean(m));
    if (!sample) return;
    const row: unknown[] = [dimensionLabel(sample.dimension), key, sample.label];
    metricMaps.forEach((map) => {
      const record = map.get(key);
      row.push(record ? record.displayValue : '—', record ? scoreCell(record.score) : 'N/A');
    });
    rows.push(row);
  });

  downloadCsv(rows, safeFileName(`aiat-comparison-${results.length}models-${fileStamp()}`) + '.csv');
}

/** 导出多结果对比 JSON（完整结果数组）。 */
export function exportComparisonJson(results: EvaluationResult[]): void {
  if (results.length === 0) return;
  downloadJson(
    {
      exportedAt: new Date().toISOString(),
      exportKind: 'evaluation-comparison',
      schema: 1,
      count: results.length,
      results,
    },
    safeFileName(`aiat-comparison-${results.length}models-${fileStamp()}`) + '.json',
  );
}

/** 导出概览 CSV（一行一个模型），适合快速贴进汇报文档。 */
export function exportSummaryCsv(results: EvaluationResult[]): void {
  if (results.length === 0) return;
  const rows: unknown[][] = [
    ['Provider', '模型', '综合', '性能', '功能', '破限', '开始时间(UTC)', '结束时间(UTC)', '引擎版本'],
  ];
  results.forEach((r) => {
    rows.push([
      r.providerName,
      r.model,
      scoreCell(r.overallScore),
      scoreCell(dimensionScoreOf(r, 'performance')),
      scoreCell(dimensionScoreOf(r, 'functionality')),
      scoreCell(dimensionScoreOf(r, 'safety')),
      toIsoUtc(r.startedAt),
      toIsoUtc(r.endedAt),
      r.engineVersion,
    ]);
  });
  downloadCsv(rows, safeFileName(`aiat-summary-${fileStamp()}`) + '.csv');
}
