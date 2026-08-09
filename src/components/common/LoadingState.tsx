import React from 'react';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';

export interface LoadingStateProps {
  label?: string;
  /** 最小高度，默认 200px。 */
  minHeight?: number;
  size?: number;
}

/** 统一的加载占位块。 */
const LoadingState: React.FC<LoadingStateProps> = ({ label = '加载中…', minHeight = 200, size = 26 }) => (
  <Box
    className="flex w-full flex-col items-center justify-center gap-2"
    sx={{ minHeight }}
    role="status"
    aria-live="polite"
  >
    <CircularProgress size={size} />
    <Typography variant="caption" color="text.secondary">
      {label}
    </Typography>
  </Box>
);

export default LoadingState;
