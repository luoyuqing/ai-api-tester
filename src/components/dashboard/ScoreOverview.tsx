import React from 'react';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import ScheduleOutlinedIcon from '@mui/icons-material/ScheduleOutlined';
import TimerOutlinedIcon from '@mui/icons-material/TimerOutlined';
import type { Dimension, EvaluationResult } from '@/types';
import ScoreBadge from '@/components/common/ScoreBadge';
import { DIMENSION_META } from '@/constants/dimensions';
import { formatDuration, formatTimestamp } from '@/lib/timer';
import { SERIES_COLORS } from '@/theme';

export interface ScoreOverviewProps {
  results: EvaluationResult[];
  /** 点选卡片时回调，未提供时卡片不可点。 */
  onSelect?(id: string): void;
  /** 当前高亮的结果 id。 */
  selectedId?: string;
}

function dimensionScore(result: EvaluationResult, dimension: Dimension): number | null {
  return result.dimensionScores.find((d) => d.dimension === dimension)?.score ?? null;
}

/** 该维度是否整体缺席（未评测），用于区分「没跑」和「跑了但 N/A」。 */
function dimensionAbsent(result: EvaluationResult, dimension: Dimension): boolean {
  return !result.dimensionScores.some((d) => d.dimension === dimension);
}

/**
 * 对比结果概览卡片组。
 * 每张卡片对应一个 EvaluationResult，色条颜色与图表 series 配色一一对应，
 * 这样用户在雷达图/柱状图里看到的颜色能直接对回卡片。
 */
const ScoreOverview: React.FC<ScoreOverviewProps> = ({ results, onSelect, selectedId }) => {
  if (results.length === 0) return null;

  return (
    <Box className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {results.map((result, i) => {
        const color = SERIES_COLORS[i % SERIES_COLORS.length];
        const selected = selectedId === result.id;
        const clickable = typeof onSelect === 'function';

        return (
          <Card
            key={result.id}
            onClick={clickable ? () => onSelect?.(result.id) : undefined}
            sx={{
              position: 'relative',
              overflow: 'hidden',
              cursor: clickable ? 'pointer' : 'default',
              borderColor: selected ? color : undefined,
              boxShadow: selected ? `0 0 0 1px ${color}` : 'none',
              transition: 'box-shadow .15s, border-color .15s',
              '&:hover': { borderColor: clickable ? color : undefined },
            }}
          >
            {/* 左侧色条：与图表 series 颜色一致 */}
            <Box
              sx={{
                position: 'absolute',
                insetBlock: 0,
                left: 0,
                width: 4,
                backgroundColor: color,
              }}
            />
            <CardContent className="flex flex-col gap-2" sx={{ pl: 2.5 }}>
              <Box className="flex items-start gap-3">
                <Box className="min-w-0 flex-1">
                  <Typography variant="h5" noWrap title={result.providerName}>
                    {result.providerName}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap title={result.model}>
                    {result.model}
                  </Typography>
                </Box>
                <ScoreBadge
                  score={result.overallScore}
                  size="large"
                  caption="综合"
                  tooltip={
                    result.overallScore === null
                      ? '全部维度均为 N/A，无法计算综合分'
                      : `综合得分 ${Math.round(result.overallScore * 10) / 10} / 100`
                  }
                />
              </Box>

              <Divider />

              <Box className="flex items-center justify-around">
                {DIMENSION_META.map((meta) => {
                  const absent = dimensionAbsent(result, meta.key);
                  const score = dimensionScore(result, meta.key);
                  return (
                    <ScoreBadge
                      key={meta.key}
                      score={score}
                      size="small"
                      caption={meta.shortLabel}
                      tooltip={
                        absent
                          ? `${meta.label}：本次任务未选择该维度`
                          : score === null
                            ? `${meta.label}：全部子指标 N/A，已从加权分母中剔除`
                            : `${meta.label} ${Math.round(score * 10) / 10} / 100 · 权重 ${(meta.weight * 100).toFixed(0)}%`
                      }
                    />
                  );
                })}
              </Box>

              <Divider />

              <Box className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Tooltip title="本次评测耗时">
                  <Box className="flex items-center gap-1 text-slate-500">
                    <TimerOutlinedIcon sx={{ fontSize: 14 }} />
                    <Typography variant="caption" color="text.secondary">
                      {formatDuration(result.endedAt - result.startedAt)}
                    </Typography>
                  </Box>
                </Tooltip>
                <Tooltip title="开始时间">
                  <Box className="flex items-center gap-1 text-slate-500">
                    <ScheduleOutlinedIcon sx={{ fontSize: 14 }} />
                    <Typography variant="caption" color="text.secondary">
                      {formatTimestamp(result.startedAt)}
                    </Typography>
                  </Box>
                </Tooltip>
              </Box>

              <Box className="flex flex-wrap items-center gap-1">
                <Chip
                  label={result.configSnapshot.name}
                  variant="outlined"
                  title={result.configSnapshot.name}
                  sx={{ maxWidth: '100%' }}
                />
                <Chip label={`引擎 v${result.engineVersion}`} variant="outlined" />
              </Box>
            </CardContent>
          </Card>
        );
      })}
    </Box>
  );
};

export default ScoreOverview;
