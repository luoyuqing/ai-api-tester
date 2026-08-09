import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TableSortLabel from '@mui/material/TableSortLabel';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import CompareArrowsIcon from '@mui/icons-material/CompareArrows';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import DeleteSweepOutlinedIcon from '@mui/icons-material/DeleteSweepOutlined';
import HistoryOutlinedIcon from '@mui/icons-material/HistoryOutlined';
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutline';
import RefreshIcon from '@mui/icons-material/Refresh';
import SearchIcon from '@mui/icons-material/Search';
import type { ResultIndexItem } from '@/types';
import { useComparison } from '@/hooks/useComparison';
import { DIMENSION_META } from '@/constants/dimensions';
import { formatDuration, formatTimestamp } from '@/lib/timer';
import PageHeader from '@/components/common/PageHeader';
import EmptyState from '@/components/common/EmptyState';
import LoadingState from '@/components/common/LoadingState';
import ConfirmDialog from '@/components/common/ConfirmDialog';
import ScoreBadge, { scoreColor, scoreText } from '@/components/common/ScoreBadge';
import ComparisonView from '@/components/dashboard/ComparisonView';

type SortKey = 'configName' | 'providerName' | 'overallScore' | 'startedAt' | 'duration';
type SortDir = 'asc' | 'desc';

interface SortableColumn {
  key: SortKey;
  label: string;
  numeric: boolean;
}

const SORTABLE_COLUMNS: readonly SortableColumn[] = [
  { key: 'configName', label: '任务名', numeric: false },
  { key: 'providerName', label: '模型', numeric: false },
  { key: 'overallScore', label: '综合', numeric: true },
  { key: 'startedAt', label: '开始时间', numeric: true },
  { key: 'duration', label: '耗时', numeric: true },
];

/** N/A 始终排在最后，无论升序还是降序——「没有分」不等于「零分」。 */
function compareScore(a: number | null, b: number | null, dir: SortDir): number {
  const aNa = a === null || !Number.isFinite(a);
  const bNa = b === null || !Number.isFinite(b);
  if (aNa && bNa) return 0;
  if (aNa) return 1;
  if (bNa) return -1;
  return dir === 'asc' ? a - b : b - a;
}

function durationOf(item: ResultIndexItem): number {
  return item.endedAt - item.startedAt;
}

/** 维度分单元格：N/A 显示灰色文字并解释原因，绝不显示成 0。 */
const DimensionCell: React.FC<{ score: number | null; label: string }> = ({ score, label }) => {
  const na = score === null || !Number.isFinite(score);
  return (
    <TableCell align="center">
      <Tooltip title={na ? `${label}：本次任务未评测该维度，或全部子指标均为 N/A` : `${label} ${scoreText(score)} / 100`}>
        <Typography variant="body2" component="span" sx={{ color: scoreColor(score), fontWeight: 600 }}>
          {scoreText(score)}
        </Typography>
      </Tooltip>
    </TableCell>
  );
};

/**
 * 历史记录页。
 * 索引来自 localStorage（轻量），因此搜索/排序全部在本地内存完成，无需回查 IndexedDB。
 */
const HistoryPage: React.FC = () => {
  const navigate = useNavigate();
  const {
    index,
    indexLoading,
    comparisonIds,
    results,
    loadingResults,
    maxCompare,
    canAddMore,
    minCompare,
    refreshIndex,
    toggle,
    clear,
    remove,
    clearAll,
  } = useComparison();

  const [keyword, setKeyword] = useState<string>('');
  const [sortKey, setSortKey] = useState<SortKey>('startedAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [pendingDelete, setPendingDelete] = useState<ResultIndexItem | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);

  const rows = useMemo<ResultIndexItem[]>(() => {
    const kw = keyword.trim().toLowerCase();
    const filtered =
      kw.length === 0
        ? index
        : index.filter((item) =>
            [item.providerName, item.model, item.configName].some((field) =>
              field.toLowerCase().includes(kw),
            ),
          );

    const sorted = [...filtered];
    sorted.sort((a, b) => {
      switch (sortKey) {
        case 'overallScore':
          return compareScore(a.overallScore, b.overallScore, sortDir);
        case 'startedAt':
          return sortDir === 'asc' ? a.startedAt - b.startedAt : b.startedAt - a.startedAt;
        case 'duration':
          return sortDir === 'asc'
            ? durationOf(a) - durationOf(b)
            : durationOf(b) - durationOf(a);
        case 'providerName': {
          const diff = a.providerName.localeCompare(b.providerName, 'zh-Hans-CN');
          const tie = diff !== 0 ? diff : a.model.localeCompare(b.model, 'zh-Hans-CN');
          return sortDir === 'asc' ? tie : -tie;
        }
        case 'configName':
        default: {
          const diff = a.configName.localeCompare(b.configName, 'zh-Hans-CN');
          return sortDir === 'asc' ? diff : -diff;
        }
      }
    });
    return sorted;
  }, [index, keyword, sortKey, sortDir]);

  const handleSort = (key: SortKey): void => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    // 时间/分数默认从大到小看更符合直觉，文本默认 A→Z。
    setSortDir(key === 'configName' || key === 'providerName' ? 'asc' : 'desc');
  };

  const handleDelete = async (): Promise<void> => {
    if (!pendingDelete) return;
    setBusy(true);
    try {
      await remove(pendingDelete.id);
      setPendingDelete(null);
    } finally {
      setBusy(false);
    }
  };

  const handleClearAll = async (): Promise<void> => {
    setBusy(true);
    try {
      await clearAll();
      setConfirmClearAll(false);
    } finally {
      setBusy(false);
    }
  };

  const selectedCount = comparisonIds.length;

  const renderBody = (): React.ReactNode => {
    if (indexLoading && index.length === 0) {
      return <LoadingState label="正在读取历史索引…" />;
    }

    if (index.length === 0) {
      return (
        <EmptyState
          title="本机还没有任何评测记录"
          description="历史记录只保存在这台机器的浏览器里，不会上传。先去执行一次评测吧。"
          action={
            <Button
              variant="contained"
              startIcon={<PlayCircleOutlineIcon />}
              onClick={() => navigate('/run')}
            >
              去测试执行
            </Button>
          }
        />
      );
    }

    if (rows.length === 0) {
      return (
        <EmptyState
          title="没有匹配的记录"
          description={`没有找到包含「${keyword.trim()}」的任务名、Provider 或模型。`}
          action={<Button onClick={() => setKeyword('')}>清空搜索</Button>}
        />
      );
    }

    return (
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox" />
              {SORTABLE_COLUMNS.slice(0, 2).map((col) => (
                <TableCell key={col.key}>
                  <TableSortLabel
                    active={sortKey === col.key}
                    direction={sortKey === col.key ? sortDir : 'asc'}
                    onClick={() => handleSort(col.key)}
                  >
                    {col.label}
                  </TableSortLabel>
                </TableCell>
              ))}
              <TableCell align="center">
                <TableSortLabel
                  active={sortKey === 'overallScore'}
                  direction={sortKey === 'overallScore' ? sortDir : 'desc'}
                  onClick={() => handleSort('overallScore')}
                >
                  综合
                </TableSortLabel>
              </TableCell>
              {DIMENSION_META.map((meta) => (
                <TableCell key={meta.key} align="center">
                  <Tooltip title={meta.description}>
                    <span>{meta.shortLabel}</span>
                  </Tooltip>
                </TableCell>
              ))}
              <TableCell>
                <TableSortLabel
                  active={sortKey === 'startedAt'}
                  direction={sortKey === 'startedAt' ? sortDir : 'desc'}
                  onClick={() => handleSort('startedAt')}
                >
                  开始时间
                </TableSortLabel>
              </TableCell>
              <TableCell align="right">
                <TableSortLabel
                  active={sortKey === 'duration'}
                  direction={sortKey === 'duration' ? sortDir : 'desc'}
                  onClick={() => handleSort('duration')}
                >
                  耗时
                </TableSortLabel>
              </TableCell>
              <TableCell>引擎</TableCell>
              <TableCell align="right">操作</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((item) => {
              const checked = comparisonIds.includes(item.id);
              const disabled = !checked && !canAddMore;
              return (
                <TableRow key={item.id} hover selected={checked}>
                  <TableCell padding="checkbox">
                    <Tooltip
                      title={
                        disabled
                          ? `最多同时对比 ${maxCompare} 个结果，请先取消其他选择`
                          : checked
                            ? '从对比中移除'
                            : '加入对比'
                      }
                    >
                      <span>
                        <Checkbox
                          size="small"
                          checked={checked}
                          disabled={disabled}
                          onChange={() => toggle(item.id)}
                        />
                      </span>
                    </Tooltip>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" noWrap title={item.configName} sx={{ maxWidth: 200 }}>
                      {item.configName}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" noWrap title={item.providerName} sx={{ maxWidth: 200 }}>
                      {item.providerName}
                    </Typography>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      noWrap
                      component="div"
                      title={item.model}
                      sx={{ maxWidth: 200 }}
                    >
                      {item.model}
                    </Typography>
                  </TableCell>
                  <TableCell align="center">
                    <ScoreBadge score={item.overallScore} size="small" />
                  </TableCell>
                  <DimensionCell score={item.performanceScore} label="性能" />
                  <DimensionCell score={item.functionalityScore} label="功能" />
                  <DimensionCell score={item.safetyScore} label="破限" />
                  <TableCell>
                    <Typography variant="body2" sx={{ whiteSpace: 'nowrap' }}>
                      {formatTimestamp(item.startedAt)}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Typography variant="body2" sx={{ whiteSpace: 'nowrap' }}>
                      {formatDuration(durationOf(item))}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip label={`v${item.engineVersion}`} variant="outlined" />
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title="删除这条记录">
                      <IconButton size="small" color="error" onClick={() => setPendingDelete(item)}>
                        <DeleteOutlineIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
    );
  };

  return (
    <Box className="flex flex-col gap-4">
      <PageHeader
        icon={<HistoryOutlinedIcon />}
        title="历史记录"
        description="全部评测结果都只存在本机浏览器中。勾选 2-5 条后可以到看板做横向对比。"
        actions={
          <>
            <Button
              variant="outlined"
              startIcon={<RefreshIcon />}
              disabled={indexLoading}
              onClick={() => void refreshIndex()}
            >
              刷新
            </Button>
            <Button
              variant="contained"
              startIcon={<CompareArrowsIcon />}
              disabled={selectedCount < 1}
              onClick={() => navigate('/dashboard')}
            >
              去对比{selectedCount > 0 ? ` (${selectedCount})` : ''}
            </Button>
          </>
        }
      />

      <Card>
        <CardContent className="flex flex-col gap-3">
          <Box className="flex flex-wrap items-center gap-2">
            <TextField
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索任务名 / Provider / 模型"
              sx={{ maxWidth: 320 }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
              }}
            />
            <Chip
              label={`共 ${index.length} 条${rows.length !== index.length ? ` · 匹配 ${rows.length} 条` : ''}`}
              variant="outlined"
            />
            <Chip
              label={`已选 ${selectedCount}/${maxCompare}`}
              color={selectedCount > 0 ? 'primary' : 'default'}
              variant="outlined"
            />
            {selectedCount > 0 ? (
              <Button size="small" onClick={() => clear()}>
                清空选择
              </Button>
            ) : null}
            <Box className="flex-1" />
            <Button
              size="small"
              color="error"
              startIcon={<DeleteSweepOutlinedIcon />}
              disabled={index.length === 0}
              onClick={() => setConfirmClearAll(true)}
            >
              清空全部
            </Button>
          </Box>

          {selectedCount > 0 && selectedCount < minCompare ? (
            <Alert severity="info" variant="outlined">
              横向对比建议至少选择 {minCompare} 条记录，当前只选了 {selectedCount} 条。
            </Alert>
          ) : null}

          <Divider />

          {renderBody()}
        </CardContent>
      </Card>

      {/* 勾选后就地出对比，不必先跳看板；导出按钮在 ComparisonView 头部。 */}
      {selectedCount > 0 ? (
        loadingResults && results.length === 0 ? (
          <Card>
            <CardContent>
              <LoadingState label="正在从 IndexedDB 读取结果明细…" minHeight={160} />
            </CardContent>
          </Card>
        ) : (
          <ComparisonView results={results} />
        )
      ) : null}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="删除评测记录"
        danger
        busy={busy}
        confirmText="删除"
        content={
          pendingDelete
            ? `确定删除「${pendingDelete.configName}」中 ${pendingDelete.providerName} · ${pendingDelete.model} 的这条结果吗？索引与明细都会被清除，且不可恢复。`
            : ''
        }
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void handleDelete()}
      />

      <ConfirmDialog
        open={confirmClearAll}
        title="清空全部历史记录"
        danger
        busy={busy}
        confirmText="全部清空"
        content={`确定清空本机全部 ${index.length} 条评测记录吗？这会同时删除 IndexedDB 里的完整明细，且不可恢复。建议先导出需要留存的结果。`}
        onCancel={() => setConfirmClearAll(false)}
        onConfirm={() => void handleClearAll()}
      />
    </Box>
  );
};

export default HistoryPage;
