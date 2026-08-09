import React from 'react';
import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { SCORE_COLORS } from '@/theme';
import { SCORE_THRESHOLDS } from '@/constants/scoring';

export type ScoreBadgeSize = 'small' | 'medium' | 'large';

/** ≥85 绿 / 70-84 蓝 / 50-69 橙 / <50 红 / N/A 灰（架构 §7.9）。 */
export function scoreColor(score: number | null | undefined): string {
  if (score === null || score === undefined || !Number.isFinite(score)) return SCORE_COLORS.na;
  if (score >= SCORE_THRESHOLDS.EXCELLENT) return SCORE_COLORS.excellent;
  if (score >= SCORE_THRESHOLDS.GOOD) return SCORE_COLORS.good;
  if (score >= SCORE_THRESHOLDS.FAIR) return SCORE_COLORS.fair;
  return SCORE_COLORS.poor;
}

/** 0-100 分文本，N/A 用「—」以外的显式标记，便于区分「0 分」与「不适用」。 */
export function scoreText(score: number | null | undefined): string {
  if (score === null || score === undefined || !Number.isFinite(score)) return 'N/A';
  return String(Math.round(score * 10) / 10);
}

const SIZE_MAP: Record<ScoreBadgeSize, { box: number; font: number; caption: number }> = {
  small: { box: 34, font: 13, caption: 9 },
  medium: { box: 46, font: 16, caption: 10 },
  large: { box: 68, font: 24, caption: 11 },
};

export interface ScoreBadgeProps {
  score: number | null | undefined;
  size?: ScoreBadgeSize;
  /** 徽章下方的说明文字，如「综合」「性能」。 */
  caption?: string;
  /** 悬浮提示，默认展示原始分数。 */
  tooltip?: string;
}

/**
 * 圆形分数徽章。颜色区间与 theme.SCORE_COLORS / SCORE_THRESHOLDS 保持单一来源。
 */
const ScoreBadge: React.FC<ScoreBadgeProps> = ({ score, size = 'medium', caption, tooltip }) => {
  const dims = SIZE_MAP[size];
  const color = scoreColor(score);
  const text = scoreText(score);

  const badge = (
    <Box className="inline-flex flex-col items-center justify-center gap-0.5">
      <Box
        sx={{
          width: dims.box,
          height: dims.box,
          borderRadius: '50%',
          border: `2px solid ${color}`,
          color,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 600,
          fontSize: dims.font,
          lineHeight: 1,
          flexShrink: 0,
        }}
      >
        {text}
      </Box>
      {caption ? (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ fontSize: dims.caption, lineHeight: 1.2 }}
        >
          {caption}
        </Typography>
      ) : null}
    </Box>
  );

  const title = tooltip ?? (text === 'N/A' ? '该项不适用，已从加权分母中剔除' : `得分 ${text} / 100`);

  return (
    <Tooltip title={title}>
      <span className="inline-flex">{badge}</span>
    </Tooltip>
  );
};

export default ScoreBadge;
