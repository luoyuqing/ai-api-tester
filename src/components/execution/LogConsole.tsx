import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import SearchOutlinedIcon from '@mui/icons-material/SearchOutlined';
import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined';
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import DeleteSweepOutlinedIcon from '@mui/icons-material/DeleteSweepOutlined';
import type { LogLevel, LogLine, LogTag } from '@/types';
import { STATUS_COLORS } from '@/theme';
import { formatLogLine } from '@/lib/logger';
import { downloadBlob, fileStamp } from '@/lib/export';
import { copyToClipboard } from '@/components/common/CopyField';
import { useUiStore } from '@/store/uiStore';

const LEVELS: ReadonlyArray<{ value: LogLevel; label: string; color: string }> = [
  { value: 'info', label: 'INFO', color: '#475569' },
  { value: 'success', label: 'OK', color: STATUS_COLORS.success },
  { value: 'warn', label: 'WARN', color: STATUS_COLORS.warning },
  { value: 'error', label: 'ERROR', color: STATUS_COLORS.danger },
];

const TAGS: ReadonlyArray<{ value: LogTag; label: string; color: string }> = [
  { value: 'PERF', label: 'PERF', color: '#1e40af' },
  { value: 'FUNC', label: 'FUNC', color: '#0891b2' },
  { value: 'SAFE', label: 'SAFE', color: '#7c3aed' },
  { value: 'SYS', label: 'SYS', color: '#64748b' },
];

/** 深色底上的正文配色（不能直接复用浅色主题的 STATUS_COLORS.info）。 */
const LEVEL_COLOR: Readonly<Record<LogLevel, string>> = Object.freeze({
  info: '#e2e8f0',
  success: '#4ade80',
  warn: '#fbbf24',
  error: '#f87171',
});

const TAG_COLOR: Readonly<Record<LogTag, string>> = Object.freeze({
  PERF: '#1e40af',
  FUNC: '#0891b2',
  SAFE: '#7c3aed',
  SYS: '#64748b',
});

/** 渲染上限：日志缓冲区最大 5000 条，一次性渲染会拖垮主线程。 */
const RENDER_LIMIT = 800;

export interface LogConsoleProps {
  logs: LogLine[];
  height?: number;
  onClear?(): void;
  /** 隐藏筛选/工具栏，用于嵌入小卡片。 */
  compact?: boolean;
}

/**
 * 实时日志控制台。
 *
 * 说明：日志内容在 logger 层已做密钥脱敏，这里不再重复处理；
 * 但导出与复制走的都是同一份已脱敏文本，不存在旁路。
 */
const LogConsole: React.FC<LogConsoleProps> = ({ logs, height = 360, onClear, compact = false }) => {
  const showSnackbar = useUiStore((s) => s.showSnackbar);

  const [levels, setLevels] = useState<LogLevel[]>(['info', 'success', 'warn', 'error']);
  const [tags, setTags] = useState<LogTag[]>(['PERF', 'FUNC', 'SAFE', 'SYS']);
  const [keyword, setKeyword] = useState<string>('');
  const [autoScroll, setAutoScroll] = useState<boolean>(true);

  const scrollRef = useRef<HTMLDivElement | null>(null);

  const filtered = useMemo(() => {
    const needle = keyword.trim().toLowerCase();
    return logs.filter((line) => {
      if (!levels.includes(line.level)) return false;
      if (!tags.includes(line.tag)) return false;
      if (needle.length === 0) return true;
      return (
        line.message.toLowerCase().includes(needle) ||
        (line.providerName ?? '').toLowerCase().includes(needle)
      );
    });
  }, [logs, levels, tags, keyword]);

  const visible = useMemo(
    () => (filtered.length > RENDER_LIMIT ? filtered.slice(filtered.length - RENDER_LIMIT) : filtered),
    [filtered],
  );

  useEffect(() => {
    if (!autoScroll) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [visible, autoScroll]);

  const toggleLevel = useCallback((value: LogLevel): void => {
    setLevels((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
  }, []);

  const toggleTag = useCallback((value: LogTag): void => {
    setTags((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
  }, []);

  const asText = useCallback((): string => filtered.map(formatLogLine).join('\n'), [filtered]);

  const handleCopy = async (): Promise<void> => {
    const ok = await copyToClipboard(asText());
    showSnackbar(ok ? `已复制 ${filtered.length} 行日志` : '复制失败，请手动选择', ok ? 'success' : 'warning');
  };

  const handleDownload = (): void => {
    downloadBlob(asText(), `aiat-run-${fileStamp()}.log`, 'text/plain;charset=utf-8');
  };

  const errorCount = useMemo(() => logs.filter((l) => l.level === 'error').length, [logs]);
  const warnCount = useMemo(() => logs.filter((l) => l.level === 'warn').length, [logs]);

  return (
    <Box className="flex flex-col gap-2">
      {compact ? null : (
        <Box className="flex flex-wrap items-center gap-2">
          {LEVELS.map((lv) => {
            const on = levels.includes(lv.value);
            return (
              <Chip
                key={lv.value}
                label={lv.label}
                variant={on ? 'filled' : 'outlined'}
                onClick={() => toggleLevel(lv.value)}
                sx={{
                  cursor: 'pointer',
                  backgroundColor: on ? lv.color : 'transparent',
                  color: on ? '#fff' : lv.color,
                  borderColor: lv.color,
                }}
              />
            );
          })}
          <Box sx={{ width: 1, height: 18, backgroundColor: '#e2e8f0' }} />
          {TAGS.map((tg) => {
            const on = tags.includes(tg.value);
            return (
              <Chip
                key={tg.value}
                label={tg.label}
                variant={on ? 'filled' : 'outlined'}
                onClick={() => toggleTag(tg.value)}
                sx={{
                  cursor: 'pointer',
                  backgroundColor: on ? tg.color : 'transparent',
                  color: on ? '#fff' : tg.color,
                  borderColor: tg.color,
                }}
              />
            );
          })}

          <Box className="flex-1" />

          <TextField
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="过滤关键字"
            sx={{ maxWidth: 200 }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchOutlinedIcon fontSize="small" />
                </InputAdornment>
              ),
            }}
          />

          <FormControlLabel
            control={
              <Switch
                size="small"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
              />
            }
            label={<Typography variant="caption">自动滚动</Typography>}
          />

          <Tooltip title="复制当前筛选结果">
            <span>
              <IconButton size="small" disabled={filtered.length === 0} onClick={() => void handleCopy()}>
                <ContentCopyOutlinedIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="下载为 .log">
            <span>
              <IconButton size="small" disabled={filtered.length === 0} onClick={handleDownload}>
                <DownloadOutlinedIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          {onClear ? (
            <Tooltip title="清空日志缓冲区">
              <span>
                <IconButton size="small" disabled={logs.length === 0} onClick={onClear}>
                  <DeleteSweepOutlinedIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          ) : null}
        </Box>
      )}

      <Box
        ref={scrollRef}
        sx={{
          height,
          overflow: 'auto',
          backgroundColor: '#0f172a',
          borderRadius: 1,
          px: 1.5,
          py: 1,
        }}
      >
        {visible.length === 0 ? (
          <Typography variant="caption" sx={{ color: '#64748b' }} className="aiat-log-line">
            {logs.length === 0
              ? '等待任务启动…引擎事件会实时输出到这里。'
              : '当前筛选条件下没有匹配的日志。'}
          </Typography>
        ) : (
          visible.map((line) => (
            <Box key={line.id} className="aiat-log-line" sx={{ color: '#cbd5e1' }}>
              <Box component="span" sx={{ color: '#64748b' }}>
                {new Date(line.ts).toLocaleTimeString('zh-CN', { hour12: false })}{' '}
              </Box>
              <Box component="span" sx={{ color: TAG_COLOR[line.tag], fontWeight: 600 }}>
                [{line.tag}]
              </Box>
              {line.providerName ? (
                <Box component="span" sx={{ color: '#94a3b8' }}>
                  {' '}
                  {line.providerName}
                </Box>
              ) : null}{' '}
              <Box component="span" sx={{ color: LEVEL_COLOR[line.level] }}>
                {line.message}
              </Box>
            </Box>
          ))
        )}
      </Box>

      <Box className="flex flex-wrap items-center gap-2">
        <Typography variant="caption" color="text.secondary">
          共 {logs.length} 行
          {filtered.length !== logs.length ? ` · 筛选后 ${filtered.length} 行` : ''}
          {filtered.length > RENDER_LIMIT ? ` · 仅渲染最新 ${RENDER_LIMIT} 行` : ''}
        </Typography>
        {warnCount > 0 ? (
          <Chip label={`${warnCount} 警告`} variant="outlined" color="warning" />
        ) : null}
        {errorCount > 0 ? <Chip label={`${errorCount} 错误`} variant="outlined" color="error" /> : null}
      </Box>
    </Box>
  );
};

export default LogConsole;
