import React from 'react';
import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { SCORE_COLORS } from '@/theme';
import { SCORE_THRESHOLDS } from '@/constants/scoring';

export type Grade = 'A' | 'B' | 'C' | 'D' | 'N/A';

export interface GradeInfo {
  grade: Grade;
  label: string;
  color: string;
  hint: string;
}

/**
 * 等级完全由 SCORE_THRESHOLDS 派生，与分数徽章共用同一套区间，
 * 避免出现「徽章是绿的、等级却是 B」这种自相矛盾的展示。
 */
export function gradeOf(score: number | null | undefined): GradeInfo {
  if (score === null || score === undefined || !Number.isFinite(score)) {
    return {
      grade: 'N/A',
      label: '不适用',
      color: SCORE_COLORS.na,
      hint: '该项全部子指标均为 N/A，已从加权分母中剔除',
    };
  }
  if (score >= SCORE_THRESHOLDS.EXCELLENT) {
    return {
      grade: 'A',
      label: '优秀',
      color: SCORE_COLORS.excellent,
      hint: `≥ ${SCORE_THRESHOLDS.EXCELLENT} 分：可直接用于生产`,
    };
  }
  if (score >= SCORE_THRESHOLDS.GOOD) {
    return {
      grade: 'B',
      label: '良好',
      color: SCORE_COLORS.good,
      hint: `${SCORE_THRESHOLDS.GOOD} ~ ${SCORE_THRESHOLDS.EXCELLENT - 1} 分：可用，存在个别短板`,
    };
  }
  if (score >= SCORE_THRESHOLDS.FAIR) {
    return {
      grade: 'C',
      label: '及格',
      color: SCORE_COLORS.fair,
      hint: `${SCORE_THRESHOLDS.FAIR} ~ ${SCORE_THRESHOLDS.GOOD - 1} 分：需针对性优化后再上线`,
    };
  }
  return {
    grade: 'D',
    label: '不佳',
    color: SCORE_COLORS.poor,
    hint: `< ${SCORE_THRESHOLDS.FAIR} 分：不建议用于该场景`,
  };
}

export interface GradeBadgeProps {
  score: number | null | undefined;
  /** 是否在字母右侧展示中文说明。 */
  showLabel?: boolean;
  size?: 'small' | 'medium';
}

/** 字母等级徽章（A/B/C/D/N/A）。 */
const GradeBadge: React.FC<GradeBadgeProps> = ({ score, showLabel = true, size = 'medium' }) => {
  const info = gradeOf(score);
  const box = size === 'small' ? 24 : 32;
  const font = size === 'small' ? 12 : 15;

  return (
    <Tooltip title={info.hint}>
      <Box className="inline-flex items-center gap-1">
        <Box
          sx={{
            minWidth: box,
            height: box,
            px: 0.75,
            borderRadius: 1,
            backgroundColor: info.color,
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 700,
            fontSize: font,
            lineHeight: 1,
          }}
        >
          {info.grade}
        </Box>
        {showLabel ? (
          <Typography variant="caption" sx={{ color: info.color, fontWeight: 600 }}>
            {info.label}
          </Typography>
        ) : null}
      </Box>
    </Tooltip>
  );
};

export default GradeBadge;
