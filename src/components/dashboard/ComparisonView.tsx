import React, { useMemo } from 'react';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import EmojiEventsOutlinedIcon from '@mui/icons-material/EmojiEventsOutlined';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import type { Dimension, EvaluationResult, MetricRecord } from '@/types';
import { ALL_DIMENSIONS } from '@/types';
import { DIMENSION_META, SUB_METRIC_META, getSubMetricMeta } from '@/constants/dimensions';
import { SERIES_COLORS } from '@/theme';
import { scoreColor, scoreText } from '@/components/common/ScoreBadge';
import ScoreOverview from '@/components/dashboard/ScoreOverview';
import ScoreRadar from '@/components/dashboard/ScoreRadar';
import ScoreBars from '@/components/dashboard/ScoreBars';
import ExportButtons from '@/components/dashboard/ExportButtons';
import EmptyState from '@/components/common/EmptyState';

export interface ComparisonViewProps {
  results: EvaluationResult[];
}

interface Row {
  key: string;
  label: string;
  tooltip?: string;
  /** 每列的分数，null 表示 N/A。 */
  scores: Array<number | null>;
  /** 每列的展示值；概览行没有展示值。 */
  displays?: string[];
  emphasize?: boolean;
}

function dimScore(result: EvaluationResult, dim: Dimension): number | null {
  return result.dimensionScores.find((d) => d.dimension === dim)?.score ?? null;
}

function metricMapOf(result: EvaluationResult): Map<string, MetricRecord> {
  const map = new Map<string, MetricRecord>();
  result.dimensionScores.forEach((d) => d.metrics.forEach((m) => map.set(m.key, m)));
  return map;
}

/** 该行的最高分列下标集合（并列全部高亮）；全 N/A 时返回空集。 */
function bestIndexes(scores: Array<number | null>): Set<number> {
  const valid = scores.filter((s): s is number => s !== null);
  if (valid.length < 2) return new Set<number>();
  const max = Math.max(...valid);
  const out = new Set<number>();
  scores.forEach((s, i) => {
    if (s !== null && Math.abs(s - max) < 0.05) out.add(i);
  });
  return out;
}

/** 多模型横向对比：雷达 + 分组柱 + 逐指标表格。 */
const ComparisonView: React.FC<ComparisonViewProps> = ({ results }) => {
  const maps = useMemo(() => results.map(metricMapOf), [results]);

  const overviewRows = useMemo<Row[]>(() => {
    const rows: Row[] = [
      {
        key: 'overall',
        label: '综合得分',
        tooltip: '0.40·性能 + 0.30·功能 + 0.30·破限，N/A 维度按有效权重重新归一',
        scores: results.map((r) => r.overallScore),
        emphasize: true,
      },
    ];
    ALL_DIMENSIONS.forEach((dim) => {
      const meta = DIMENSION_META.find((m) => m.key === dim);
      rows.push({
        key: dim,
        label: meta?.label ?? dim,
        tooltip: meta?.description,
        scores: results.map((r) => dimScore(r, dim)),
      });
    });
    return rows;
  }, [results]);

  const metricRows = useMemo<Row[]>(() => {
    const present = SUB_METRIC_META.filter((m) => maps.some((map) => map.has(m.key)));
    return present.map((meta) => ({
      key: meta.key,
      label: meta.label,
      tooltip: `${meta.tooltip}（${meta.requirementId}）`,
      scores: maps.map((map) => map.get(meta.key)?.score ?? null),
      displays: maps.map((map) => map.get(meta.key)?.displayValue ?? '—'),
    }));
  }, [maps]);

  const champion = useMemo(() => {
    const scored = results.filter((r) => r.overallScore !== null);
    if (scored.length === 0) return null;
    return scored.reduce((best, r) =>
      (r.overallScore ?? -1) > (best.overallScore ?? -1) ? r : best,
    );
  }, [results]);

  if (results.length === 0) {
    return (
      <EmptyState
        title="尚未选择对比对象"
        description="在左侧历史列表里勾选 2-5 条记录即可开始横向对比。"
      />
    );
  }

  const renderRow = (row: Row): React.ReactElement => {
    const best = bestIndexes(row.scores);
    return (
      <TableRow key={row.key} hover>
        <TableCell sx={{ position: 'sticky', left: 0, backgroundColor: '#fff', zIndex: 1 }}>
          <Box className="flex items-center gap-1">
            <Typography variant="body2" sx={{ fontWeight: row.emphasize ? 600 : 400 }}>
              {row.label}
            </Typography>
            {row.tooltip ? (
              <Tooltip title={row.tooltip}>
                <HelpOutlineIcon sx={{ fontSize: 14, color: 'text.disabled' }} />
              </Tooltip>
            ) : null}
          </Box>
        </TableCell>
        {row.scores.map((score, i) => (
          <TableCell
            key={`${row.key}-${results[i].id}`}
            align="right"
            sx={{
              whiteSpace: 'nowrap',
              backgroundColor: best.has(i) ? '#f0fdf4' : undefined,
            }}
          >
            <Box className="flex items-center justify-end gap-1">
              {row.displays ? (
                <Typography variant="caption" color="text.secondary">
                  {row.displays[i]}
                </Typography>
              ) : null}
              <Typography
                variant="body2"
                sx={{
                  color: scoreColor(score),
                  fontWeight: row.emphasize || best.has(i) ? 700 : 500,
                  minWidth: 40,
                }}
              >
                {scoreText(score)}
              </Typography>
            </Box>
          </TableCell>
        ))}
      </TableRow>
    );
  };

  return (
    <Box className="flex flex-col gap-4">
      {/* 概览卡片 */}
      <Card>
        <CardContent className="flex flex-col gap-3">
          <Box className="flex flex-wrap items-center gap-2">
            <Typography variant="h4">对比概览</Typography>
            <Chip label={`${results.length} 个模型`} variant="outlined" />
            <Box className="flex-1" />
            <ExportButtons results={results} forceComparison />
          </Box>
          <Divider />

          {champion && results.length > 1 ? (
            <Typography variant="body2" color="text.secondary" className="flex items-center gap-1">
              <EmojiEventsOutlinedIcon fontSize="small" />
              综合分最高：<strong>{champion.providerName}</strong>（{champion.model}），
              {scoreText(champion.overallScore)} 分。绿色底色标记每行的最优列。
            </Typography>
          ) : null}

          <ScoreOverview results={results} />
        </CardContent>
      </Card>

      {/* 图表 */}
      <Box className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <Box className="xl:col-span-5">
          <Card className="h-full">
            <CardContent className="flex flex-col gap-2">
              <Typography variant="h5">三维雷达</Typography>
              <Divider />
              <ScoreRadar results={results} height={360} />
            </CardContent>
          </Card>
        </Box>
        <Box className="xl:col-span-7">
          <Card className="h-full">
            <CardContent className="flex flex-col gap-2">
              <Typography variant="h5">子指标得分对比</Typography>
              <Divider />
              <ScoreBars results={results} />
            </CardContent>
          </Card>
        </Box>
      </Box>

      {/* 明细表 */}
      <Card>
        <CardContent className="flex flex-col gap-2">
          <Typography variant="h5">逐指标对比</Typography>
          <Divider />
          <TableContainer sx={{ maxHeight: 620 }}>
            <Table stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell
                    sx={{ position: 'sticky', left: 0, zIndex: 3, backgroundColor: '#f8fafc' }}
                  >
                    项目
                  </TableCell>
                  {results.map((r, i) => (
                    <TableCell key={r.id} align="right" sx={{ whiteSpace: 'nowrap' }}>
                      <Box className="flex items-center justify-end gap-1">
                        <Box
                          sx={{
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            backgroundColor: SERIES_COLORS[i % SERIES_COLORS.length],
                          }}
                        />
                        <Box>
                          <Typography variant="body2" noWrap>
                            {r.providerName}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" noWrap>
                            {r.model}
                          </Typography>
                        </Box>
                      </Box>
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                <TableRow>
                  <TableCell
                    colSpan={results.length + 1}
                    sx={{ backgroundColor: '#f1f5f9', py: 0.5 }}
                  >
                    <Typography variant="caption" color="text.secondary">
                      概览
                    </Typography>
                  </TableCell>
                </TableRow>
                {overviewRows.map(renderRow)}

                {ALL_DIMENSIONS.map((dim) => {
                  const rows = metricRows.filter(
                    (row) => getSubMetricMeta(row.key)?.dimension === dim,
                  );
                  if (rows.length === 0) return null;
                  const meta = DIMENSION_META.find((m) => m.key === dim);
                  return (
                    <React.Fragment key={dim}>
                      <TableRow>
                        <TableCell
                          colSpan={results.length + 1}
                          sx={{ backgroundColor: '#f1f5f9', py: 0.5 }}
                        >
                          <Typography variant="caption" sx={{ color: meta?.color }}>
                            {meta?.label ?? dim}
                          </Typography>
                        </TableCell>
                      </TableRow>
                      {rows.map(renderRow)}
                    </React.Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
          <Typography variant="caption" color="text.secondary">
            括号左侧为实测值，右侧为归一化得分；N/A 表示该指标不适用或未采集到有效样本，不参与加权。
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );
};

export default ComparisonView;
