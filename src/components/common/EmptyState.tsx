import React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import InboxOutlinedIcon from '@mui/icons-material/InboxOutlined';

export interface EmptyStateProps {
  title: string;
  description?: string;
  /** 自定义图标，默认使用收件箱图标。 */
  icon?: React.ReactNode;
  /** 行动区（按钮等）。 */
  action?: React.ReactNode;
  /** 最小高度，默认 220px。 */
  minHeight?: number;
}

/** 统一的空态占位块。 */
const EmptyState: React.FC<EmptyStateProps> = ({
  title,
  description,
  icon,
  action,
  minHeight = 220,
}) => (
  <Box
    className="flex w-full flex-col items-center justify-center gap-2 px-6 py-8 text-center"
    sx={{ minHeight }}
  >
    <Box sx={{ color: 'text.disabled', display: 'flex' }}>
      {icon ?? <InboxOutlinedIcon sx={{ fontSize: 40 }} />}
    </Box>
    <Typography variant="h6" color="text.primary">
      {title}
    </Typography>
    {description ? (
      <Typography variant="body2" color="text.secondary" className="max-w-lg">
        {description}
      </Typography>
    ) : null}
    {action ? <Box className="mt-2 flex gap-2">{action}</Box> : null}
  </Box>
);

export default EmptyState;
