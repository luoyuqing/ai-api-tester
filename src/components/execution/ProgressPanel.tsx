import React from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import LinearProgress from '@mui/material/LinearProgress';
import Typography from '@mui/material/Typography';
import type { TaskStatus } from '@/types';
import { STATUS_COLORS } from '@/theme';
import { formatDuration } from '@/lib/timer';

export const TASK_STATUS_LABELS: Readonly<Record<TaskStatus, string>> = Object.freeze({
  idle: '待启动',
  running: '运行中',
  paused: '已暂停',
  completed: '已完成',
  cancelled: '已终止',
  failed: '已失败',
});

export function taskStatusColor(status: TaskStatus): string {
  switch (status) {
    case 'running':
      return '#1e40af';
    case 'paused':
      return STATUS_COLORS.warning;
    case 'completed':
      return STATUS_COLORS.success;
    case 'failed':
    case 'cancelled':
      return STATUS_COLORS.danger;
    case 'idle':
    default:
      return STATUS_COLORS.unknown;
  }
}

export interface ProgressPanelProps {
  status: TaskStatus;
  taskId: string | null;
  done: number;
  total: number;
  percent: number;
  elapsedMs: number;
  error?: string | null;
  /** 参与本次任务的 Provider 数量，用于展示分母语义。 */
  providerCount?: number;
}

function statValue(label: string, value: string): React.ReactElement {
  return (
    <Box className="min-w-[92px]">
      <Typography variant="caption" color="text.secondary" component="div">
        {label}
      </Typography>
      <Typography variant="h5" component="div">
        {value}
      </Typography>
    </Box>
  );
}

/**
 * 总进度面板。
 * `percent` 由引擎按「计划单元」而非请求数计算，因此暂停时它会停在原地而不是回退。
 */
const ProgressPanel: React.FC<ProgressPanelProps> = ({
  status,
  taskId,
  done,
  total,
  percent,
  elapsedMs,
  error,
  providerCount = 0,
}) => {
  const color = taskStatusColor(status);
  const indeterminate = status === 'running' && total === 0;
  const eta =
    status === 'running' && done > 0 && total > done
      ? ((elapsedMs / done) * (total - done))
      : null;

  return (
    <Box className="flex flex-col gap-3">
      <Box className="flex flex-wrap items-center gap-2">
        <Chip
          label={TASK_STATUS_LABELS[status]}
          sx={{ backgroundColor: color, color: '#fff', fontWeight: 600 }}
        />
        {taskId ? (
          <Typography variant="caption" color="text.secondary">
            任务 ID：<code>{taskId}</code>
          </Typography>
        ) : null}
        <Box className="flex-1" />
        <Typography variant="caption" color="text.secondary">
          {providerCount > 0 ? `${providerCount} 个 Provider 并行推进` : '尚未启动'}
        </Typography>
      </Box>

      <Box>
        <Box className="mb-1 flex items-baseline gap-2">
          <Typography variant="h2" component="span" sx={{ color }}>
            {Math.round(percent)}%
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {done} / {total || '—'} 计划单元
          </Typography>
        </Box>
        <LinearProgress
          variant={indeterminate ? 'indeterminate' : 'determinate'}
          value={Math.min(100, Math.max(0, percent))}
          sx={{
            height: 10,
            borderRadius: 5,
            backgroundColor: '#e2e8f0',
            '& .MuiLinearProgress-bar': { backgroundColor: color, borderRadius: 5 },
          }}
        />
      </Box>

      <Box className="flex flex-wrap gap-6">
        {statValue('已用时', formatDuration(elapsedMs))}
        {statValue('预计剩余', eta === null ? '—' : formatDuration(eta))}
        {statValue('已完成单元', String(done))}
        {statValue('总单元', total > 0 ? String(total) : '—')}
      </Box>

      {error ? (
        <Typography variant="body2" sx={{ color: STATUS_COLORS.danger }}>
          {error}
        </Typography>
      ) : null}
    </Box>
  );
};

export default ProgressPanel;
