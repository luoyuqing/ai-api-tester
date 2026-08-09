import React, { useState } from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Collapse from '@mui/material/Collapse';
import IconButton from '@mui/material/IconButton';
import LinearProgress from '@mui/material/LinearProgress';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import type { MetricRecord } from '@/types';
import { DIMENSION_LABELS, getSubMetricMeta } from '@/constants/dimensions';
import { scoreColor, scoreText } from '@/components/common/ScoreBadge';
import EmptyState from '@/components/common/EmptyState';

export interface MetricTableProps {
  metrics: MetricRecord[];
  /** 是否展示「维度」列（单维度卡片里没必要）。 */
  showDimension?: boolean;
  /** 允许展开查看 detail / evidence，默认开启。 */
  expandable?: boolean;
}

interface MetricRowProps {
  metric: MetricRecord;
  showDimension: boolean;
  expandable: boolean;
}

function detailEntries(metric: MetricRecord): Array<[string, string]> {
  if (!metric.detail) return [];
  return Object.entries(metric.detail).map(([k, v]) => [k, v === null ? '—' : String(v)]);
}

const MetricRow: React.FC<MetricRowProps> = ({ metric, showDimension, expandable }) => {
  const [open, setOpen] = useState<boolean>(false);
  const meta = getSubMetricMeta(metric.key);
  const details = detailEntries(metric);
  const evidence = metric.evidence ?? [];
  const hasMore = details.length > 0 || evidence.length > 0 || Boolean(metric.naReason);
  const canExpand = expandable && hasMore;
  const color = scoreColor(metric.score);
  const isNa = metric.score === null;

  return (
    <>
      <TableRow hover sx={{ '& > *': { borderBottom: canExpand && open ? 'unset' : undefined } }}>
        <TableCell padding="none" sx={{ width: 36 }}>
          {canExpand ? (
            <IconButton size="small" onClick={() => setOpen((v) => !v)}>
              {open ? (
                <KeyboardArrowDownIcon fontSize="small" />
              ) : (
                <KeyboardArrowRightIcon fontSize="small" />
              )}
            </IconButton>
          ) : null}
        </TableCell>

        {showDimension ? (
          <TableCell sx={{ whiteSpace: 'nowrap' }}>
            <Typography variant="caption" color="text.secondary">
              {DIMENSION_LABELS[metric.dimension]}
            </Typography>
          </TableCell>
        ) : null}

        <TableCell>
          <Box className="flex items-center gap-1">
            <Typography variant="body2">{metric.label}</Typography>
            {meta ? (
              <Tooltip title={`${meta.tooltip}（${meta.requirementId}）`}>
                <HelpOutlineIcon sx={{ fontSize: 14, color: 'text.disabled' }} />
              </Tooltip>
            ) : null}
          </Box>
        </TableCell>

        <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
          <Typography variant="body2" color={isNa ? 'text.disabled' : 'text.primary'}>
            {metric.displayValue || '—'}
          </Typography>
        </TableCell>

        <TableCell sx={{ minWidth: 140 }}>
          <Box className="flex items-center gap-2">
            <LinearProgress
              variant="determinate"
              value={isNa ? 0 : Math.min(100, Math.max(0, metric.score ?? 0))}
              sx={{
                flex: 1,
                height: 6,
                borderRadius: 3,
                backgroundColor: '#e2e8f0',
                '& .MuiLinearProgress-bar': { backgroundColor: color, borderRadius: 3 },
              }}
            />
            <Typography variant="body2" sx={{ color, fontWeight: 600, minWidth: 38, textAlign: 'right' }}>
              {scoreText(metric.score)}
            </Typography>
          </Box>
        </TableCell>

        <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
          <Typography variant="caption" color="text.secondary">
            {isNa ? '不计权' : `${(metric.weight * 100).toFixed(0)}%`}
          </Typography>
        </TableCell>
      </TableRow>

      {canExpand ? (
        <TableRow>
          <TableCell colSpan={showDimension ? 6 : 5} sx={{ py: 0, backgroundColor: '#f8fafc' }}>
            <Collapse in={open} timeout="auto" unmountOnExit>
              <Box className="flex flex-col gap-2 py-2">
                {metric.naReason ? (
                  <Typography variant="caption" color="warning.main">
                    N/A 原因：{metric.naReason}
                  </Typography>
                ) : null}

                {details.length > 0 ? (
                  <Box className="flex flex-wrap gap-1">
                    {details.map(([k, v]) => (
                      <Chip key={k} label={`${k}: ${v}`} variant="outlined" />
                    ))}
                  </Box>
                ) : null}

                {evidence.length > 0 ? (
                  <Box className="flex flex-col gap-1">
                    <Typography variant="caption" color="text.secondary">
                      证据片段（{evidence.length} 条，已脱敏并截断）：
                    </Typography>
                    {evidence.slice(0, 5).map((text, i) => (
                      <Box
                        key={`${metric.key}-ev-${i}`}
                        className="aiat-log-line"
                        sx={{
                          backgroundColor: '#ffffff',
                          border: '1px solid #e2e8f0',
                          borderRadius: 1,
                          px: 1,
                          py: 0.5,
                          maxHeight: 140,
                          overflow: 'auto',
                        }}
                      >
                        {text}
                      </Box>
                    ))}
                    {evidence.length > 5 ? (
                      <Typography variant="caption" color="text.secondary">
                        其余 {evidence.length - 5} 条请导出 JSON 查看。
                      </Typography>
                    ) : null}
                  </Box>
                ) : null}
              </Box>
            </Collapse>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
};

/** 子指标明细表：展示值 + 归一化得分 + 权重，可展开看 detail 与证据。 */
const MetricTable: React.FC<MetricTableProps> = ({
  metrics,
  showDimension = true,
  expandable = true,
}) => {
  if (metrics.length === 0) {
    return <EmptyState title="没有指标数据" minHeight={160} />;
  }

  return (
    <TableContainer>
      <Table stickyHeader>
        <TableHead>
          <TableRow>
            <TableCell padding="none" sx={{ width: 36 }} />
            {showDimension ? <TableCell>维度</TableCell> : null}
            <TableCell>指标</TableCell>
            <TableCell align="right">实测值</TableCell>
            <TableCell>归一化得分</TableCell>
            <TableCell align="right">权重</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {metrics.map((m) => (
            <MetricRow
              key={m.key}
              metric={m}
              showDimension={showDimension}
              expandable={expandable}
            />
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
};

export default MetricTable;
