import React from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import StopIcon from '@mui/icons-material/Stop';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import AssessmentOutlinedIcon from '@mui/icons-material/AssessmentOutlined';
import type { TaskStatus } from '@/types';

export interface RunControlsProps {
  status: TaskStatus;
  isRunning: boolean;
  isPaused: boolean;
  isFinished: boolean;
  /** 校验全部通过时才允许启动。 */
  canStart: boolean;
  /** canStart 为 false 时展示的原因，用于 Tooltip。 */
  blockReason?: string;
  /** 已完成且产出了结果时展示「查看报告」。 */
  hasResults?: boolean;
  onStart(): void;
  onPause(): void;
  onResume(): void;
  onCancel(): void;
  onReset(): void;
  onViewReport?(): void;
}

/**
 * 任务控制条。
 * 按钮的可用性完全由 status 派生，避免出现「运行中还能点开始」这类竞态。
 */
const RunControls: React.FC<RunControlsProps> = ({
  status,
  isRunning,
  isPaused,
  isFinished,
  canStart,
  blockReason,
  hasResults = false,
  onStart,
  onPause,
  onResume,
  onCancel,
  onReset,
  onViewReport,
}) => {
  const active = isRunning || isPaused;
  const startDisabled = active || !canStart;

  const startButton = (
    <span>
      <Button
        variant="contained"
        size="medium"
        startIcon={<PlayArrowIcon />}
        disabled={startDisabled}
        onClick={onStart}
      >
        {isFinished ? '重新开始' : '开始评测'}
      </Button>
    </span>
  );

  return (
    <Box className="flex flex-wrap items-center gap-2">
      {startDisabled && blockReason ? (
        <Tooltip title={blockReason}>{startButton}</Tooltip>
      ) : (
        startButton
      )}

      {isPaused ? (
        <Button variant="outlined" startIcon={<PlayArrowIcon />} onClick={onResume}>
          继续
        </Button>
      ) : (
        <Button
          variant="outlined"
          startIcon={<PauseIcon />}
          disabled={!isRunning}
          onClick={onPause}
        >
          暂停
        </Button>
      )}

      <Tooltip title="停止后已完成的探针结果仍会被保留并落盘">
        <span>
          <Button
            variant="outlined"
            color="error"
            startIcon={<StopIcon />}
            disabled={!active}
            onClick={onCancel}
          >
            终止
          </Button>
        </span>
      </Tooltip>

      <Button
        size="small"
        startIcon={<RestartAltIcon />}
        disabled={active || status === 'idle'}
        onClick={onReset}
      >
        清空运行态
      </Button>

      {hasResults && onViewReport ? (
        <>
          <Box className="flex-1" />
          <Button
            variant="contained"
            color="secondary"
            startIcon={<AssessmentOutlinedIcon />}
            onClick={onViewReport}
          >
            查看报告
          </Button>
        </>
      ) : null}

      {isPaused ? (
        <Typography variant="caption" color="warning.main" className="w-full">
          已暂停：正在飞行中的请求会跑完，不会再派发新的探针。
        </Typography>
      ) : null}
    </Box>
  );
};

export default RunControls;
