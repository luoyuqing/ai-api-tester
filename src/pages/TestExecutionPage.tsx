import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Typography from '@mui/material/Typography';
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutline';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import type { EvaluationConfig, ProbeResult } from '@/types';
import { useEvaluationRun } from '@/hooks/useEvaluationRun';
import { useProviderStore } from '@/store/providerStore';
import { useTestConfigStore } from '@/store/testConfigStore';
import { useUiStore } from '@/store/uiStore';
import {
  MAX_COMPARE_MODELS,
  MAX_CONCURRENCY,
  MIN_COMPARE_MODELS,
  MIN_CONCURRENCY,
} from '@/constants/defaults';
import { collectPlaceholders } from '@/data/testsets';
import PageHeader from '@/components/common/PageHeader';
import EmptyState from '@/components/common/EmptyState';
import RunControls from '@/components/execution/RunControls';
import TaskConfigForm from '@/components/execution/TaskConfigForm';
import SafetyNoticeDialog from '@/components/execution/SafetyNoticeDialog';
import ProgressPanel from '@/components/execution/ProgressPanel';
import ProviderProgressList from '@/components/execution/ProviderProgressList';
import ProbeMatrix from '@/components/execution/ProbeMatrix';
import LogConsole from '@/components/execution/LogConsole';
import RunSummary from '@/components/execution/RunSummary';

const SCORING_LABELS: Readonly<Record<EvaluationConfig['scoring']['mode'], string>> = Object.freeze({
  rule: '规则判分',
  'llm-judge': '大模型裁判',
  hybrid: '混合判分',
});

const TestExecutionPage: React.FC = () => {
  const navigate = useNavigate();
  const run = useEvaluationRun();

  const providers = useProviderStore((s) => s.providers);
  const loadProviders = useProviderStore((s) => s.load);
  const hasSecret = useProviderStore((s) => s.hasSecret);

  const draft = useTestConfigStore((s) => s.draft);
  const suites = useTestConfigStore((s) => s.suites);
  const placeholders = useTestConfigStore((s) => s.placeholders);
  const setDraft = useTestConfigStore((s) => s.setDraft);
  const loadConfigs = useTestConfigStore((s) => s.load);

  const showSnackbar = useUiStore((s) => s.showSnackbar);

  const [safetyOpen, setSafetyOpen] = useState<boolean>(false);

  useEffect(() => {
    void loadProviders();
    void loadConfigs();
  }, [loadProviders, loadConfigs]);

  const selectedSuites = useMemo(
    () => suites.filter((s) => draft.suiteIds.includes(s.id)),
    [suites, draft.suiteIds],
  );

  const totalCases = useMemo(
    () => selectedSuites.reduce((acc, s) => acc + s.cases.length, 0),
    [selectedSuites],
  );

  /** 缺失的占位符只会让对应用例被跳过并记 N/A，属于警告而非阻断。 */
  const missingPlaceholders = useMemo(() => {
    const required = collectPlaceholders(selectedSuites.flatMap((s) => s.cases));
    return required.filter(
      (token) => typeof placeholders[token] !== 'string' || placeholders[token].length === 0,
    );
  }, [selectedSuites, placeholders]);

  const providersWithoutKey = useMemo(
    () => draft.providerIds.filter((id) => !hasSecret(id)),
    [draft.providerIds, hasSecret],
  );

  /** 阻断项：任意一条不满足都不允许启动。合规确认不在此列 —— 它由弹窗现场补齐。 */
  const blockers = useMemo(() => {
    const list: string[] = [];
    if (providers.length === 0) list.push('尚未配置任何 Provider');
    if (draft.providerIds.length === 0) list.push('至少选择一个待测 Provider');
    if (draft.dimensions.length === 0) list.push('至少选择一个评测维度');
    if (draft.suiteIds.length === 0) list.push('至少选择一个用例集');
    if (totalCases === 0 && draft.suiteIds.length > 0) list.push('选中的用例集里没有任何用例');
    if (draft.concurrency < MIN_CONCURRENCY || draft.concurrency > MAX_CONCURRENCY) {
      list.push(`并发数须在 ${MIN_CONCURRENCY}-${MAX_CONCURRENCY} 之间`);
    }
    if (!Number.isFinite(draft.timeoutMs) || draft.timeoutMs <= 0) list.push('超时时间须大于 0');
    if (draft.scoring.mode !== 'rule' && !draft.scoring.judgeProviderId) {
      list.push(`${SCORING_LABELS[draft.scoring.mode]}需要指定裁判模型`);
    }
    if (providersWithoutKey.length > 0) {
      const names = providersWithoutKey
        .map((id) => providers.find((p) => p.id === id)?.name ?? id)
        .join('、');
      list.push(`以下 Provider 尚未录入 API Key：${names}`);
    }
    return list;
  }, [providers, draft, totalCases, providersWithoutKey]);

  /** 非阻断的提醒。 */
  const warnings = useMemo(() => {
    const list: string[] = [];
    if (draft.providerIds.length === 1) {
      list.push(`只选了 1 个模型，无法横向对比；建议 ${MIN_COMPARE_MODELS}-${MAX_COMPARE_MODELS} 个`);
    }
    if (draft.providerIds.length > MAX_COMPARE_MODELS) {
      list.push(
        `已选 ${draft.providerIds.length} 个模型，超过建议上限 ${MAX_COMPARE_MODELS}，耗时与限流风险都会显著上升`,
      );
    }
    if (missingPlaceholders.length > 0) {
      list.push(`${missingPlaceholders.length} 个占位符未提供，相关破限用例会被跳过并记为 N/A`);
    }
    if (draft.concurrency > 5 && draft.dimensions.includes('performance')) {
      list.push('并发 >5 时排队效应会污染延迟指标，性能维度建议降到 5 以内');
    }
    return list;
  }, [draft.providerIds.length, draft.concurrency, draft.dimensions, missingPlaceholders.length]);

  const canStart = blockers.length === 0;

  const handleConfigChange = useCallback(
    (next: EvaluationConfig): void => {
      setDraft(next);
    },
    [setDraft],
  );

  const handleStart = useCallback((): void => {
    if (!canStart) {
      showSnackbar(blockers[0] ?? '配置不完整，无法启动', 'warning');
      return;
    }
    // 破限维度必须在本次启动前完成合规确认，历史勾选不足以放行未确认的配置。
    if (draft.dimensions.includes('safety') && draft.safetyAcknowledged !== true) {
      setSafetyOpen(true);
      return;
    }
    void run.start(draft);
  }, [canStart, blockers, draft, run, showSnackbar]);

  const handleSafetyAccept = useCallback((): void => {
    setSafetyOpen(false);
    // 直接把补齐后的配置交给引擎：setDraft 之后本轮闭包里的 draft 仍是旧值。
    const acknowledged: EvaluationConfig = { ...draft, safetyAcknowledged: true };
    setDraft({ safetyAcknowledged: true });
    void run.start(acknowledged);
  }, [draft, setDraft, run]);

  const activeProviders = useMemo(
    () => providers.filter((p) => draft.providerIds.includes(p.id)),
    [providers, draft.providerIds],
  );

  /** 探针矩阵的数据源：结果落地后按 providerId 归集其 probeResults。 */
  const probeResultsByProvider = useMemo<Record<string, ProbeResult[]>>(() => {
    const out: Record<string, ProbeResult[]> = {};
    run.results.forEach((result) => {
      out[result.providerId] = (out[result.providerId] ?? []).concat(result.probeResults);
    });
    return out;
  }, [run.results]);

  const formLocked = run.isRunning || run.isPaused;

  return (
    <Box className="flex flex-col gap-4">
      <PageHeader
        icon={<PlayCircleOutlineIcon />}
        title="测试执行"
        description="确认待测模型与任务配置后启动。运行过程中的每条引擎事件都会实时落到下方日志。"
        actions={
          <Button
            variant="outlined"
            startIcon={<SettingsOutlinedIcon />}
            onClick={() => navigate('/config')}
          >
            回配置中心
          </Button>
        }
      />

      {/* 控制条 + 校验反馈 */}
      <Card>
        <CardContent className="flex flex-col gap-3">
          {blockers.length > 0 ? (
            <Alert severity="error" variant="outlined">
              <AlertTitle>还不能启动</AlertTitle>
              <ul className="m-0 list-disc pl-5">
                {blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </Alert>
          ) : null}

          {warnings.length > 0 ? (
            <Alert severity="warning" variant="outlined">
              <AlertTitle>可以启动，但请留意</AlertTitle>
              <ul className="m-0 list-disc pl-5">
                {warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </Alert>
          ) : null}

          <RunControls
            status={run.status}
            isRunning={run.isRunning}
            isPaused={run.isPaused}
            isFinished={run.isFinished}
            canStart={canStart}
            blockReason={blockers[0]}
            hasResults={run.results.length > 0}
            onStart={handleStart}
            onPause={run.pause}
            onResume={run.resume}
            onCancel={run.cancel}
            onReset={run.reset}
            onViewReport={() => navigate('/dashboard')}
          />

          <Box className="flex flex-wrap items-center gap-1">
            <Typography variant="caption" color="text.secondary" className="mr-1">
              本次将执行：
            </Typography>
            <Chip label={`${draft.providerIds.length} 个模型`} variant="outlined" />
            <Chip label={`${draft.dimensions.length} 个维度`} variant="outlined" />
            <Chip label={`${draft.suiteIds.length} 个用例集 / ${totalCases} 条用例`} variant="outlined" />
            <Chip label={SCORING_LABELS[draft.scoring.mode]} variant="outlined" />
          </Box>
        </CardContent>
      </Card>

      {/* 任务配置 */}
      {providers.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              title="还没有可用的 Provider"
              description="先去配置中心新增至少一个 Provider 并录入 API Key，再回来启动评测。"
              minHeight={180}
              action={
                <Button variant="contained" onClick={() => navigate('/config')}>
                  去配置中心
                </Button>
              }
            />
          </CardContent>
        </Card>
      ) : (
        <TaskConfigForm
          value={draft}
          providers={providers}
          suites={suites}
          disabled={formLocked}
          onChange={handleConfigChange}
        />
      )}

      {/* 进度 + 日志 */}
      <Box className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <Box className="flex flex-col gap-4 xl:col-span-5">
          <Card>
            <CardContent>
              <ProgressPanel
                status={run.status}
                taskId={run.taskId}
                done={run.done}
                total={run.total}
                percent={run.percent}
                elapsedMs={run.elapsedMs}
                error={run.error}
                providerCount={
                  run.providerProgress.length > 0
                    ? run.providerProgress.length
                    : activeProviders.length
                }
              />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex flex-col gap-2">
              <Typography variant="h5">各模型进度</Typography>
              <Divider />
              <ProviderProgressList
                items={run.providerProgress}
                active={run.isRunning || run.isPaused}
              />
            </CardContent>
          </Card>
        </Box>

        <Box className="xl:col-span-7">
          <Card>
            <CardContent className="flex flex-col gap-2">
              <Typography variant="h5">实时日志</Typography>
              <Divider />
              <LogConsole logs={run.logs} height={520} onClear={run.clearLogs} />
              <Typography variant="caption" color="text.secondary">
                日志在写入前已做密钥脱敏（sk-*/Bearer/api_key 等一律打码），可放心复制外发。
                缓冲区上限 5000 行，超出后丢弃最旧记录。
              </Typography>
            </CardContent>
          </Card>
        </Box>
      </Box>

      {/* 探针矩阵 */}
      <Card>
        <CardContent className="flex flex-col gap-2">
          <Typography variant="h5">探针执行矩阵</Typography>
          <Divider />
          <ProbeMatrix providers={activeProviders} probeResults={probeResultsByProvider} />
          <Typography variant="caption" color="text.secondary">
            结果在每个 Provider 跑完后整体落地，因此矩阵是按模型逐列点亮的，而不是逐格刷新。
          </Typography>
        </CardContent>
      </Card>

      {run.isFinished && run.results.length > 0 ? (
        <RunSummary
          results={run.results}
          status={run.status}
          elapsedMs={run.elapsedMs}
          onViewDashboard={() => navigate('/dashboard')}
        />
      ) : null}

      {run.status === 'failed' && run.results.length === 0 ? (
        <Alert severity="error" variant="outlined">
          <AlertTitle>任务失败</AlertTitle>
          {run.error ?? '未知错误'}。可在上方日志里定位到具体是哪个 Provider / 探针出的问题；
          若大量出现 CORS 类报错，把对应 Provider 的传输方式切到 proxy 并启动本地代理再试。
        </Alert>
      ) : null}

      <SafetyNoticeDialog
        open={safetyOpen}
        onAccept={handleSafetyAccept}
        onDecline={() => setSafetyOpen(false)}
      />
    </Box>
  );
};

export default TestExecutionPage;
