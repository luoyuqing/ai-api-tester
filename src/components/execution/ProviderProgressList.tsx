import React from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import LinearProgress from '@mui/material/LinearProgress';
import Typography from '@mui/material/Typography';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import type { ProviderProgress } from '@/store/runStore';
import { STATUS_COLORS } from '@/theme';
import EmptyState from '@/components/common/EmptyState';

export interface ProviderProgressListProps {
  items: ProviderProgress[];
  /** 任务是否仍在推进；用于区分「跑完了」与「被中断」。 */
  active?: boolean;
}

/**
 * 每个 Provider 一条进度条。
 * total 为 0 时说明该 Provider 的 provider:start 事件尚未到达，此时显示不确定态。
 */
const ProviderProgressList: React.FC<ProviderProgressListProps> = ({ items, active = false }) => {
  if (items.length === 0) {
    return (
      <EmptyState
        title="尚无进行中的 Provider"
        description="启动任务后，这里会按 Provider 拆分展示各自的推进情况。"
        minHeight={140}
      />
    );
  }

  return (
    <Box className="flex flex-col gap-3">
      {items.map((item) => {
        const indeterminate = active && !item.finished && item.total === 0;
        const barColor = item.finished ? STATUS_COLORS.success : '#1e40af';
        return (
          <Box key={item.providerId}>
            <Box className="mb-1 flex items-center gap-2">
              <Typography variant="body2" className="min-w-0 flex-1" noWrap title={item.providerName}>
                {item.providerName}
              </Typography>
              {item.finished ? (
                <Chip
                  icon={<CheckCircleIcon />}
                  label="已完成"
                  color="success"
                  variant="outlined"
                />
              ) : (
                <Typography variant="caption" color="text.secondary">
                  {item.done} / {item.total || '—'}
                </Typography>
              )}
              <Typography
                variant="caption"
                sx={{ color: barColor, fontWeight: 600, minWidth: 36, textAlign: 'right' }}
              >
                {Math.round(item.percent)}%
              </Typography>
            </Box>
            <LinearProgress
              variant={indeterminate ? 'indeterminate' : 'determinate'}
              value={Math.min(100, Math.max(0, item.percent))}
              sx={{
                height: 6,
                borderRadius: 3,
                backgroundColor: '#e2e8f0',
                '& .MuiLinearProgress-bar': { backgroundColor: barColor, borderRadius: 3 },
              }}
            />
          </Box>
        );
      })}
    </Box>
  );
};

export default ProviderProgressList;
