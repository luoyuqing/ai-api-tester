import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AssessmentOutlinedIcon from '@mui/icons-material/AssessmentOutlined';
import HistoryOutlinedIcon from '@mui/icons-material/HistoryOutlined';
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutline';
import type { EvaluationResult } from '@/types';
import { ALL_DIMENSIONS } from '@/types';
import { useComparison } from '@/hooks/useComparison';
import { useResultStore } from '@/store/resultStore';
import { formatDuration, formatTimestamp } from '@/lib/timer';
import PageHeader from '@/components/common/PageHeader';
import EmptyState from '@/components/common/EmptyState';
import LoadingState from '@/components/common/LoadingState';
import ScoreBadge from '@/components/common/ScoreBadge';
import ResultPicker from '@/components/dashboard/ResultPicker';
import GradeBadge from '@/components/dashboard/GradeBadge';
import ScoreRadar from '@/components/dashboard/ScoreRadar';
import ScoreBars from '@/components/dashboard/ScoreBars';
import DimensionCard from '@/components/dashboard/DimensionCard';
import MetricTable from '@/components/dashboard/MetricTable';
import ComparisonView from '@/components/dashboard/ComparisonView';
import ExportButtons from '@/components/dashboard/ExportButtons';

type DashboardTab = 'single' | 'compare';

const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const comparison = useComparison();
  const loadResult = useResultStore((s) => s.load);

  const [tab, setTab] = useState<DashboardTab>('single');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [result, setResult] = useState<EvaluationResult | null>(null);
  const [loadingDetail, setLoadingDetail] = useState<boolean>(false);

  const { index, comparisonIds } = comparison;

  /** 默认选中：优先本次刚跑完的第一条，否则退回索引里最新的一条。 */
  useEffect(() => {
    if (selectedId !== null) return;
    const fallback = comparisonIds[0] ?? index[0]?.id ?? null;
    if (fallback) setSelectedId(fallback);
  }, [selectedId, comparisonIds, index]);

  useEffect(() => {
    if (selectedId === null) {
      setResult(null);
      return undefined;
    }
    let cancelled = false;
    setLoadingDetail(true);
    void loadResult(selectedId)
      .then((r) => {
        if (!cancelled) setResult(r);
      })
      .finally(() => {
        if (!cancelled) setLoadingDetail(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, loadResult]);

  const allMetrics = useMemo(
    () => (result ? result.dimensionScores.flatMap((d) => d.metrics) : []),
    [result],
  );

  const dimensionScores = useMemo(() => {
    if (!result) return [];
    // 固定按 性能 → 功能 → 破限 排列，避免引擎返回顺序变化导致卡片跳动。
    return ALL_DIMENSIONS.map((dim) =>
      result.dimensionScores.find((d) => d.dimension === dim),
    ).filter((d): d is NonNullable<typeof d> => Boolean(d));
  }, [result]);

  const suiteVersionText = useMemo(() => {
    if (!result) return '';
    const entries = Object.entries(result.suiteVersions);
    return entries.length === 0 ? '—' : entries.map(([id, v]) => `${id}@${v}`).join('、');
  }, [result]);

  const emptyIndex = index.length === 0 && !comparison.indexLoading;

  return (
    <Box className="flex flex-col gap-4">
      <PageHeader
        icon={<AssessmentOutlinedIcon />}
        title="可视化看板"
        description="三维雷达 + 子指标拆解 + 原始证据下钻。所有数据都来自本机 IndexedDB。"
        actions={
          <Box className="flex items-center gap-1">
            <Button
              variant="outlined"
              startIcon={<HistoryOutlinedIcon />}
              onClick={() => navigate('/history')}
            >
              历史记录
            </Button>
            <Button
              variant="contained"
              startIcon={<PlayCircleOutlineIcon />}
              onClick={() => navigate('/run')}
            >
              新建评测
            </Button>
          </Box>
        }
      />

      {emptyIndex ? (
        <Card>
          <CardContent>
            <EmptyState
              title="本机还没有任何评测记录"
              description="先到配置中心添加 Provider，再执行一次评测，报告会自动出现在这里。"
              action={
                <Button variant="contained" onClick={() => navigate('/config')}>
                  去配置中心
                </Button>
              }
            />
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className="flex flex-col gap-3">
              <Tabs value={tab} onChange={(_e, v: DashboardTab) => setTab(v)}>
                <Tab value="single" label="单模型报告" />
                <Tab
                  value="compare"
                  label={`横向对比${comparisonIds.length > 0 ? ` (${comparisonIds.length})` : ''}`}
                />
              </Tabs>
              <Divider />

              {tab === 'single' ? (
                <Box className="flex flex-wrap items-start gap-3">
                  <Box className="min-w-[280px] flex-1">
                    <ResultPicker
                      index={index}
                      value={selectedId}
                      loading={comparison.indexLoading}
                      onChange={setSelectedId}
                      onRefresh={() => void comparison.refreshIndex()}
                    />
                  </Box>
                  <ExportButtons results={result ? [result] : []} />
                </Box>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  当前对比集合来自历史页的勾选（也会在每次任务结束后自动填充）。
                  到<Button size="small" onClick={() => navigate('/history')}>历史记录</Button>
                  页可以增删对比对象，最多 {comparison.maxCompare} 个。
                </Typography>
              )}
            </CardContent>
          </Card>

          {tab === 'compare' ? (
            comparison.loadingResults ? (
              <LoadingState label="正在从 IndexedDB 读取对比明细…" />
            ) : (
              <>
                {!comparison.hasEnoughForCompare && comparison.results.length > 0 ? (
                  <Alert severity="info" variant="outlined">
                    只选了 {comparison.results.length} 个模型，横向对比建议至少 {comparison.minCompare} 个。
                  </Alert>
                ) : null}
                <ComparisonView results={comparison.results} />
              </>
            )
          ) : loadingDetail ? (
            <LoadingState label="正在读取评测明细…" />
          ) : !result ? (
            <Card>
              <CardContent>
                <EmptyState
                  title="没有读到这条结果的明细"
                  description="索引仍在，但 IndexedDB 里的详情可能已被浏览器清理。可以重新执行一次评测。"
                />
              </CardContent>
            </Card>
          ) : (
            <>
              {/* 概览 */}
              <Card>
                <CardContent className="flex flex-wrap items-center gap-4">
                  <ScoreBadge score={result.overallScore} size="large" caption="综合得分" />
                  <Box className="min-w-0 flex-1">
                    <Box className="flex flex-wrap items-center gap-2">
                      <Typography variant="h3" noWrap title={result.providerName}>
                        {result.providerName}
                      </Typography>
                      <GradeBadge score={result.overallScore} />
                    </Box>
                    <Typography variant="body2" color="text.secondary">
                      {result.model} · 任务「{result.configSnapshot.name}」
                    </Typography>
                    <Box className="mt-1 flex flex-wrap gap-1">
                      <Chip label={`引擎 v${result.engineVersion}`} variant="outlined" />
                      <Chip
                        label={`耗时 ${formatDuration(result.endedAt - result.startedAt)}`}
                        variant="outlined"
                      />
                      <Chip label={formatTimestamp(result.endedAt)} variant="outlined" />
                      <Chip
                        label={`${result.probeResults.length} 个探针`}
                        variant="outlined"
                      />
                      <Tooltip title={suiteVersionText}>
                        <Chip
                          label={`${Object.keys(result.suiteVersions).length} 个用例集版本`}
                          variant="outlined"
                        />
                      </Tooltip>
                    </Box>
                  </Box>
                  <Box className="flex items-start gap-4">
                    {dimensionScores.map((d) => (
                      <ScoreBadge
                        key={d.dimension}
                        score={d.score}
                        size="small"
                        caption={
                          d.dimension === 'performance'
                            ? '性能'
                            : d.dimension === 'functionality'
                              ? '功能'
                              : '破限'
                        }
                      />
                    ))}
                  </Box>
                </CardContent>
              </Card>

              {/* 图表 */}
              <Box className="grid grid-cols-1 gap-4 xl:grid-cols-12">
                <Box className="xl:col-span-5">
                  <Card className="h-full">
                    <CardContent className="flex flex-col gap-2">
                      <Typography variant="h5">三维雷达</Typography>
                      <Divider />
                      <ScoreRadar results={[result]} height={340} showLegend={false} />
                    </CardContent>
                  </Card>
                </Box>
                <Box className="xl:col-span-7">
                  <Card className="h-full">
                    <CardContent className="flex flex-col gap-2">
                      <Typography variant="h5">子指标得分</Typography>
                      <Divider />
                      <ScoreBars results={[result]} />
                    </CardContent>
                  </Card>
                </Box>
              </Box>

              {/* 维度卡片 */}
              <Box className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                {dimensionScores.map((d) => (
                  <DimensionCard key={d.dimension} dimensionScore={d} />
                ))}
              </Box>

              {/* 全量指标表 */}
              <Card>
                <CardContent className="flex flex-col gap-2">
                  <Box className="flex flex-wrap items-center gap-2">
                    <Typography variant="h5">全部子指标</Typography>
                    <Chip label={`${allMetrics.length} 项`} variant="outlined" />
                    <Chip
                      label={`${allMetrics.filter((m) => m.score === null).length} 项 N/A`}
                      variant="outlined"
                      color="warning"
                    />
                    <Box className="flex-1" />
                    <ExportButtons results={[result]} />
                  </Box>
                  <Divider />
                  <MetricTable metrics={allMetrics} />
                  <Typography variant="caption" color="text.secondary">
                    点击行首箭头可展开该指标的分项数据与原始响应片段（已脱敏、已截断至 2000 字符）。
                  </Typography>
                </CardContent>
              </Card>
            </>
          )}
        </>
      )}
    </Box>
  );
};

export default DashboardPage;
