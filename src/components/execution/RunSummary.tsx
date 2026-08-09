import React from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Typography from '@mui/material/Typography';
import AssessmentOutlinedIcon from '@mui/icons-material/AssessmentOutlined';
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import EmojiEventsOutlinedIcon from '@mui/icons-material/EmojiEventsOutlined';
import type { Dimension, EvaluationResult, TaskStatus } from '@/types';
import { ALL_DIMENSIONS } from '@/types';
import { DIMENSION_LABELS } from '@/constants/dimensions';
import ScoreBadge from '@/components/common/ScoreBadge';
import { formatDuration } from '@/lib/timer';
import { exportResultCsv, exportResultJson, exportSummaryCsv } from '@/lib/export';

export interface RunSummaryProps {
  results: EvaluationResult[];
  status: TaskStatus;
  elapsedMs: number;
  onViewDashboard?(): void;
}

function dimScore(result: EvaluationResult, dim: Dimension): number | null {
  return result.dimensionScores.find((d) => d.dimension === dim)?.score ?? null;
}

/** N/A 参与排序时排在最后。 */
function sortByOverall(a: EvaluationResult, b: EvaluationResult): number {
  const av = a.overallScore ?? -1;
  const bv = b.overallScore ?? -1;
  return bv - av;
}

/**
 * 任务完成后的结果概览。
 * 仅呈现综合分与三维分数；指标级下钻交给看板页，避免这里变成第二个 Dashboard。
 */
const RunSummary: React.FC<RunSummaryProps> = ({ results, status, elapsedMs, onViewDashboard }) => {
  if (results.length === 0) return null;

  const ranked = [...results].sort(sortByOverall);
  const champion = ranked[0];
  const naCount = results.reduce(
    (acc, r) => acc + r.dimensionScores.filter((d) => d.score === null).length,
    0,
  );

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <Box className="flex flex-wrap items-center gap-2">
          <Typography variant="h4" className="flex items-center gap-1">
            <EmojiEventsOutlinedIcon fontSize="small" />
            评测结果概览
          </Typography>
          <Chip
            label={status === 'cancelled' ? '任务被终止（部分结果）' : '任务已完成'}
            color={status === 'cancelled' ? 'warning' : 'success'}
            variant="outlined"
          />
          <Typography variant="caption" color="text.secondary">
            {results.length} 个模型 · 总耗时 {formatDuration(elapsedMs)}
            {naCount > 0 ? ` · ${naCount} 个维度为 N/A（已从加权分母剔除）` : ''}
          </Typography>
          <Box className="flex-1" />
          <Button
            size="small"
            startIcon={<DownloadOutlinedIcon />}
            onClick={() => exportSummaryCsv(results)}
          >
            导出概览 CSV
          </Button>
          {onViewDashboard ? (
            <Button
              variant="contained"
              size="small"
              startIcon={<AssessmentOutlinedIcon />}
              onClick={onViewDashboard}
            >
              进入可视化看板
            </Button>
          ) : null}
        </Box>

        <Divider />

        {results.length > 1 && champion.overallScore !== null ? (
          <Typography variant="body2" color="text.secondary">
            本轮综合分最高：<strong>{champion.providerName}</strong>（{champion.model}），
            {Math.round(champion.overallScore * 10) / 10} 分。
            综合分 = 0.40·性能 + 0.30·功能 + 0.30·破限，N/A 项会按有效权重重新归一。
          </Typography>
        ) : null}

        <Box className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {ranked.map((result, index) => (
            <Card key={result.id} variant="outlined">
              <CardContent className="flex flex-col gap-2">
                <Box className="flex items-start gap-2">
                  <Box className="min-w-0 flex-1">
                    <Typography variant="subtitle2" noWrap title={result.providerName}>
                      {results.length > 1 ? `#${index + 1} ` : ''}
                      {result.providerName}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" noWrap title={result.model}>
                      {result.model}
                    </Typography>
                  </Box>
                  <ScoreBadge score={result.overallScore} size="large" caption="综合" />
                </Box>

                <Divider />

                <Box className="flex items-start justify-around">
                  {ALL_DIMENSIONS.map((dim) => (
                    <ScoreBadge
                      key={dim}
                      score={dimScore(result, dim)}
                      size="small"
                      caption={DIMENSION_LABELS[dim]}
                    />
                  ))}
                </Box>

                <Box className="flex items-center gap-1">
                  <Typography variant="caption" color="text.secondary" className="flex-1">
                    {formatDuration(result.endedAt - result.startedAt)} · 引擎 v{result.engineVersion}
                  </Typography>
                  <Button size="small" onClick={() => exportResultJson(result)}>
                    JSON
                  </Button>
                  <Button size="small" onClick={() => exportResultCsv(result)}>
                    CSV
                  </Button>
                </Box>
              </CardContent>
            </Card>
          ))}
        </Box>
      </CardContent>
    </Card>
  );
};

export default RunSummary;
