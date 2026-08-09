import React from 'react';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import RefreshIcon from '@mui/icons-material/Refresh';
import type { ResultIndexItem } from '@/types';
import { formatTimestamp } from '@/lib/timer';
import { scoreColor, scoreText } from '@/components/common/ScoreBadge';

export interface ResultPickerProps {
  index: ResultIndexItem[];
  value: string | null;
  onChange(id: string): void;
  loading?: boolean;
  label?: string;
  onRefresh?(): void;
}

/** 历史结果下拉选择器（索引已按结束时间倒序）。 */
const ResultPicker: React.FC<ResultPickerProps> = ({
  index,
  value,
  onChange,
  loading = false,
  label = '选择评测结果',
  onRefresh,
}) => (
  <Box className="flex items-center gap-1">
    <TextField
      select
      label={label}
      value={index.some((i) => i.id === value) ? (value ?? '') : ''}
      disabled={loading || index.length === 0}
      onChange={(e) => onChange(e.target.value)}
      helperText={
        index.length === 0
          ? loading
            ? '正在读取本地历史…'
            : '本机还没有任何评测记录'
          : `共 ${index.length} 条历史记录，按结束时间倒序`
      }
      SelectProps={{
        renderValue: (selected) => {
          const item = index.find((i) => i.id === selected);
          if (!item) return '';
          return `${item.providerName} · ${item.model} · ${scoreText(item.overallScore)} 分`;
        },
      }}
    >
      {index.map((item) => (
        <MenuItem key={item.id} value={item.id}>
          <Box className="flex w-full min-w-0 items-center gap-2">
            <Box
              sx={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                flexShrink: 0,
                backgroundColor: scoreColor(item.overallScore),
              }}
            />
            <Box className="min-w-0 flex-1">
              <Typography variant="body2" noWrap>
                {item.providerName} · {item.model}
              </Typography>
              <Typography variant="caption" color="text.secondary" noWrap>
                {item.configName} · {formatTimestamp(item.endedAt)}
              </Typography>
            </Box>
            <Typography
              variant="body2"
              sx={{ color: scoreColor(item.overallScore), fontWeight: 600, flexShrink: 0 }}
            >
              {scoreText(item.overallScore)}
            </Typography>
          </Box>
        </MenuItem>
      ))}
    </TextField>

    {onRefresh ? (
      <Tooltip title="重新读取本地历史索引">
        <span>
          <IconButton size="small" disabled={loading} onClick={onRefresh}>
            <RefreshIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
    ) : null}
  </Box>
);

export default ResultPicker;
