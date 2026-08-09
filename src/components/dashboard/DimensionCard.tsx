import React, { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Collapse from '@mui/material/Collapse';
import Divider from '@mui/material/Divider';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import type { DimensionScore } from '@/types';
import { DIMENSION_META } from '@/constants/dimensions';
import ScoreBadge from '@/components/common/ScoreBadge';
import GradeBadge from '@/components/dashboard/GradeBadge';
import MetricTable from '@/components/dashboard/MetricTable';

export interface DimensionCardProps {
  dimensionScore: DimensionScore;
  /** 默认展开子指标明细。 */
  defaultExpanded?: boolean;
}

/** 单个维度的得分卡：分数 + 等级 + 有效权重 + 可折叠的子指标明细。 */
const DimensionCard: React.FC<DimensionCardProps> = ({ dimensionScore, defaultExpanded = false }) => {
  const [expanded, setExpanded] = useState<boolean>(defaultExpanded);
  const meta = DIMENSION_META.find((m) => m.key === dimensionScore.dimension);

  const naCount = dimensionScore.metrics.filter((m) => m.score === null).length;
  const nominalWeight = meta?.weight ?? 0;
  const weightShifted =
    Math.abs(dimensionScore.effectiveWeight - nominalWeight) > 0.001 &&
    dimensionScore.effectiveWeight > 0;

  return (
    <Card>
      <CardContent className="flex flex-col gap-2">
        <Box className="flex items-start gap-2">
          <Box
            sx={{ width: 4, alignSelf: 'stretch', borderRadius: 2, backgroundColor: meta?.color ?? '#94a3b8' }}
          />
          <Box className="min-w-0 flex-1">
            <Box className="flex flex-wrap items-center gap-1">
              <Typography variant="h5">{meta?.label ?? dimensionScore.dimension}</Typography>
              <GradeBadge score={dimensionScore.score} size="small" />
            </Box>
            <Typography variant="caption" color="text.secondary">
              {meta?.description}
            </Typography>
          </Box>
          <ScoreBadge score={dimensionScore.score} size="medium" />
        </Box>

        <Box className="flex flex-wrap items-center gap-1">
          <Tooltip title="该维度在综合分中的名义权重">
            <Chip label={`名义权重 ${(nominalWeight * 100).toFixed(0)}%`} variant="outlined" />
          </Tooltip>
          <Tooltip title="N/A 项剔除后重新归一得到的实际权重">
            <Chip
              label={`有效权重 ${(dimensionScore.effectiveWeight * 100).toFixed(1)}%`}
              variant="outlined"
              color={dimensionScore.effectiveWeight === 0 ? 'default' : 'primary'}
            />
          </Tooltip>
          <Chip label={`${dimensionScore.metrics.length} 个子指标`} variant="outlined" />
          {naCount > 0 ? <Chip label={`${naCount} 项 N/A`} variant="outlined" color="warning" /> : null}
        </Box>

        {weightShifted ? (
          <Typography variant="caption" color="text.secondary">
            存在 N/A 子指标，权重已按剩余项重新归一，因此有效权重与名义权重不同。
          </Typography>
        ) : null}

        <Divider />

        <Button
          size="small"
          onClick={() => setExpanded((v) => !v)}
          endIcon={expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
          sx={{ alignSelf: 'flex-start' }}
        >
          {expanded ? '收起子指标' : '展开子指标'}
        </Button>

        <Collapse in={expanded} timeout="auto" unmountOnExit>
          <MetricTable metrics={dimensionScore.metrics} showDimension={false} />
        </Collapse>
      </CardContent>
    </Card>
  );
};

export default DimensionCard;
