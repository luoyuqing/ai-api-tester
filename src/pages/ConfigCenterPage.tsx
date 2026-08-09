import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Slider from '@mui/material/Slider';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutline';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import BookmarkAddOutlinedIcon from '@mui/icons-material/BookmarkAddOutlined';
import type { Dimension, ScoringMode, TestSuite } from '@/types';
import { ALL_DIMENSIONS } from '@/types';
import { useTestConfigStore } from '@/store/testConfigStore';
import { useProviderStore } from '@/store/providerStore';
import { useUiStore } from '@/store/uiStore';
import { DIMENSION_META } from '@/constants/dimensions';
import {
  MAX_CONCURRENCY,
  MAX_RETRIES_LIMIT,
  MAX_TIMEOUT_MS,
  MIN_CONCURRENCY,
  MIN_STABILITY_SAMPLE_SIZE,
  MIN_TIMEOUT_MS,
} from '@/constants/defaults';
import { collectPlaceholders, parseImportedSuite, parsePlaceholderDictionary } from '@/data/testsets';
import PageHeader from '@/components/common/PageHeader';
import ProviderList from '@/components/provider/ProviderList';
import ConfirmDialog from '@/components/common/ConfirmDialog';

const SCORING_OPTIONS: ReadonlyArray<{ value: ScoringMode; label: string; hint: string }> = [
  { value: 'rule', label: '规则判分', hint: '零额外成本，完全离线，判分口径固定' },
  { value: 'llm-judge', label: 'LLM-as-judge', hint: '由裁判模型打分，需额外配置一个 Provider' },
  { value: 'hybrid', label: '混合', hint: '规则先筛，再由裁判模型细评' },
];

/** 用例集按维度归类展示。 */
function suiteDimension(suite: TestSuite): Dimension {
  const first = suite.kind[0] ?? '';
  if (first.startsWith('perf.')) return 'performance';
  if (first.startsWith('safe.')) return 'safety';
  return 'functionality';
}

const ConfigCenterPage: React.FC = () => {
  const navigate = useNavigate();

  const draft = useTestConfigStore((s) => s.draft);
  const configs = useTestConfigStore((s) => s.configs);
  const suites = useTestConfigStore((s) => s.suites);
  const placeholders = useTestConfigStore((s) => s.placeholders);
  const loadConfigs = useTestConfigStore((s) => s.load);
  const setDraft = useTestConfigStore((s) => s.setDraft);
  const resetDraft = useTestConfigStore((s) => s.resetDraft);
  const saveAsTemplate = useTestConfigStore((s) => s.saveAsTemplate);
  const applyTemplate = useTestConfigStore((s) => s.applyTemplate);
  const deleteConfig = useTestConfigStore((s) => s.deleteConfig);
  const importSuite = useTestConfigStore((s) => s.importSuite);
  const removeSuite = useTestConfigStore((s) => s.removeSuite);
  const setPlaceholders = useTestConfigStore((s) => s.setPlaceholders);
  const clearPlaceholders = useTestConfigStore((s) => s.clearPlaceholders);

  const providers = useProviderStore((s) => s.providers);
  const showSnackbar = useUiStore((s) => s.showSnackbar);

  const [ladderText, setLadderText] = useState<string>(() => draft.contextLadder.join(', '));
  const [templateName, setTemplateName] = useState<string>('');
  const [pendingSuiteDelete, setPendingSuiteDelete] = useState<TestSuite | null>(null);
  const suiteFileRef = useRef<HTMLInputElement | null>(null);
  const dictFileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void loadConfigs();
  }, [loadConfigs]);

  useEffect(() => {
    setLadderText(draft.contextLadder.join(', '));
  }, [draft.contextLadder]);

  const selectedSuites = useMemo(
    () => suites.filter((s) => draft.suiteIds.includes(s.id)),
    [suites, draft.suiteIds],
  );

  /** 选中的安全用例集需要哪些占位符，以及还缺哪些。 */
  const placeholderStatus = useMemo(() => {
    const cases = selectedSuites.flatMap((s) => s.cases);
    const required = collectPlaceholders(cases);
    const missing = required.filter(
      (token) => typeof placeholders[token] !== 'string' || placeholders[token].length === 0,
    );
    return { required, missing };
  }, [selectedSuites, placeholders]);

  const templates = useMemo(() => configs.filter((c) => c.isTemplate), [configs]);
  const totalCases = useMemo(
    () => selectedSuites.reduce((acc, s) => acc + s.cases.length, 0),
    [selectedSuites],
  );

  const toggleDimension = (dim: Dimension): void => {
    const has = draft.dimensions.includes(dim);
    const next = has ? draft.dimensions.filter((d) => d !== dim) : [...draft.dimensions, dim];
    setDraft({ dimensions: next });
  };

  const toggleSuite = (id: string): void => {
    const has = draft.suiteIds.includes(id);
    setDraft({
      suiteIds: has ? draft.suiteIds.filter((s) => s !== id) : [...draft.suiteIds, id],
    });
  };

  const commitLadder = (): void => {
    const parsed = ladderText
      .split(/[,，\s]+/)
      .map((t) => Number(t))
      .filter((n) => Number.isFinite(n) && n > 0)
      .map((n) => Math.round(n))
      .sort((a, b) => a - b);
    if (parsed.length === 0) {
      showSnackbar('上下文阶梯不能为空，已恢复原值', 'warning');
      setLadderText(draft.contextLadder.join(', '));
      return;
    }
    setDraft({ contextLadder: parsed });
  };

  const handleSuiteFile = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    try {
      const suite = parseImportedSuite(JSON.parse(await file.text()));
      await importSuite(suite);
      setDraft({ suiteIds: [...new Set([...draft.suiteIds, suite.id])] });
      showSnackbar(`已导入用例集「${suite.name}」`, 'success');
    } catch (err) {
      showSnackbar((err as Error).message, 'error');
    }
  };

  const handleDictFile = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    try {
      const dict = parsePlaceholderDictionary(JSON.parse(await file.text()));
      setPlaceholders(dict);
      showSnackbar(`已载入 ${Object.keys(dict).length} 个占位符（仅内存）`, 'success');
    } catch (err) {
      showSnackbar((err as Error).message, 'error');
    }
  };

  const handleSaveTemplate = async (): Promise<void> => {
    const name = templateName.trim() || draft.name.trim() || '未命名模板';
    await saveAsTemplate(name);
    setTemplateName('');
    showSnackbar(`已存为模板「${name}」`, 'success');
  };

  const confirmSuiteDelete = async (): Promise<void> => {
    if (!pendingSuiteDelete) return;
    await removeSuite(pendingSuiteDelete.id);
    setPendingSuiteDelete(null);
  };

  const safetySelected = draft.dimensions.includes('safety');
  const judgeNeeded = draft.scoring.mode !== 'rule';

  return (
    <Box className="flex flex-col gap-4">
      <PageHeader
        icon={<SettingsOutlinedIcon />}
        title="配置中心"
        description="左侧维护待测 Provider，右侧编排评测任务。所有内容仅保存在本机浏览器。"
        actions={
          <Button
            variant="contained"
            startIcon={<PlayCircleOutlineIcon />}
            onClick={() => navigate('/run')}
          >
            去执行
          </Button>
        }
      />

      <Box className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        {/* Provider 管理 */}
        <Box className="xl:col-span-7">
          <Card>
            <CardContent className="flex flex-col gap-3">
              <Typography variant="h4">Provider 管理</Typography>
              <Divider />
              <ProviderList dense />
            </CardContent>
          </Card>
        </Box>

        {/* 评测配置 */}
        <Box className="flex flex-col gap-4 xl:col-span-5">
          <Card>
            <CardContent className="flex flex-col gap-3">
              <Typography variant="h4">评测配置</Typography>
              <Divider />

              <TextField
                label="任务名称"
                value={draft.name}
                onChange={(e) => setDraft({ name: e.target.value })}
              />

              {/* 维度 */}
              <Box>
                <Typography variant="subtitle2" className="mb-1">
                  评测维度
                </Typography>
                <Box className="flex flex-col">
                  {ALL_DIMENSIONS.map((dim) => {
                    const meta = DIMENSION_META.find((m) => m.key === dim);
                    if (!meta) return null;
                    return (
                      <Tooltip key={dim} title={meta.description} placement="left">
                        <FormControlLabel
                          control={
                            <Checkbox
                              size="small"
                              checked={draft.dimensions.includes(dim)}
                              onChange={() => toggleDimension(dim)}
                            />
                          }
                          label={
                            <Box className="flex items-center gap-1">
                              <span>{meta.label}</span>
                              <Chip
                                label={`权重 ${(meta.weight * 100).toFixed(0)}%`}
                                variant="outlined"
                              />
                            </Box>
                          }
                        />
                      </Tooltip>
                    );
                  })}
                </Box>
                {draft.dimensions.length === 0 ? (
                  <Alert severity="warning" variant="outlined">
                    至少选择一个维度，否则无法生成综合分。
                  </Alert>
                ) : null}
                <Typography variant="caption" color="text.secondary">
                  未选中的维度会整体缺席报告；单项 N/A 的指标会自动从加权分母中剔除。
                </Typography>
              </Box>

              <Divider />

              {/* 用例集 */}
              <Box className="flex items-center gap-2">
                <Typography variant="subtitle2" className="flex-1">
                  用例集（{draft.suiteIds.length}/{suites.length} 选中 · 共 {totalCases} 条用例）
                </Typography>
                <Button
                  size="small"
                  startIcon={<UploadFileOutlinedIcon />}
                  onClick={() => suiteFileRef.current?.click()}
                >
                  导入
                </Button>
                <input
                  ref={suiteFileRef}
                  type="file"
                  accept="application/json,.json"
                  hidden
                  onChange={(e) => {
                    void handleSuiteFile(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
              </Box>
              <Box className="max-h-72 overflow-auto rounded border border-slate-200">
                {suites.map((suite) => (
                  <Box
                    key={suite.id}
                    className="flex items-center gap-1 border-b border-slate-100 px-2 py-1 last:border-0"
                  >
                    <Checkbox
                      size="small"
                      checked={draft.suiteIds.includes(suite.id)}
                      onChange={() => toggleSuite(suite.id)}
                    />
                    <Box className="min-w-0 flex-1">
                      <Typography variant="body2" noWrap title={suite.name}>
                        {suite.name}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {suite.cases.length} 条 · v{suite.version} ·{' '}
                        {DIMENSION_META.find((d) => d.key === suiteDimension(suite))?.shortLabel ?? '—'}
                      </Typography>
                    </Box>
                    {suite.builtin ? (
                      <Chip label="内置" variant="outlined" />
                    ) : (
                      <IconButton size="small" color="error" onClick={() => setPendingSuiteDelete(suite)}>
                        <DeleteOutlineIcon fontSize="small" />
                      </IconButton>
                    )}
                  </Box>
                ))}
              </Box>

              <Divider />

              {/* 判分 */}
              <TextField
                select
                label="评分模式"
                value={draft.scoring.mode}
                onChange={(e) =>
                  setDraft({ scoring: { ...draft.scoring, mode: e.target.value as ScoringMode } })
                }
                helperText={SCORING_OPTIONS.find((o) => o.value === draft.scoring.mode)?.hint}
              >
                {SCORING_OPTIONS.map((o) => (
                  <MenuItem key={o.value} value={o.value}>
                    {o.label}
                  </MenuItem>
                ))}
              </TextField>

              {judgeNeeded ? (
                <TextField
                  select
                  label="裁判模型"
                  value={draft.scoring.judgeProviderId ?? ''}
                  onChange={(e) =>
                    setDraft({
                      scoring: { ...draft.scoring, judgeProviderId: e.target.value || undefined },
                    })
                  }
                  helperText={
                    providers.length === 0
                      ? '尚未配置任何 Provider，先在左侧新增'
                      : '建议选择一个与被测模型无关的稳定模型作为裁判'
                  }
                >
                  <MenuItem value="">
                    <em>未选择</em>
                  </MenuItem>
                  {providers.map((p) => (
                    <MenuItem key={p.id} value={p.id}>
                      {p.name} · {p.model}
                    </MenuItem>
                  ))}
                </TextField>
              ) : null}

              <Divider />

              {/* 运行参数 */}
              <Box>
                <Typography variant="subtitle2">并发数：{draft.concurrency}</Typography>
                <Slider
                  size="small"
                  value={draft.concurrency}
                  min={MIN_CONCURRENCY}
                  max={MAX_CONCURRENCY}
                  step={1}
                  marks
                  valueLabelDisplay="auto"
                  onChange={(_e, value) =>
                    setDraft({ concurrency: Array.isArray(value) ? value[0] : value })
                  }
                />
                <Typography variant="caption" color="text.secondary">
                  并发过高会放大限流与排队效应，导致延迟指标失真；性能采样建议 ≤5。
                </Typography>
              </Box>

              <Box className="grid grid-cols-2 gap-3">
                <TextField
                  label="超时 (ms)"
                  type="number"
                  value={draft.timeoutMs}
                  onChange={(e) => setDraft({ timeoutMs: Number(e.target.value) || MIN_TIMEOUT_MS })}
                  inputProps={{ min: MIN_TIMEOUT_MS, max: MAX_TIMEOUT_MS, step: 1000 }}
                />
                <TextField
                  label="最大重试次数"
                  type="number"
                  value={draft.maxRetries}
                  onChange={(e) => setDraft({ maxRetries: Number(e.target.value) || 0 })}
                  inputProps={{ min: 0, max: MAX_RETRIES_LIMIT, step: 1 }}
                  helperText="仅对 429 / 5xx 生效"
                />
                <TextField
                  label="稳定性采样数"
                  type="number"
                  value={draft.stabilitySampleSize}
                  onChange={(e) =>
                    setDraft({ stabilitySampleSize: Number(e.target.value) || MIN_STABILITY_SAMPLE_SIZE })
                  }
                  inputProps={{ min: 1, step: 1 }}
                  error={draft.stabilitySampleSize < MIN_STABILITY_SAMPLE_SIZE}
                  helperText={
                    draft.stabilitySampleSize < MIN_STABILITY_SAMPLE_SIZE
                      ? `PERF-02 要求 N ≥ ${MIN_STABILITY_SAMPLE_SIZE}`
                      : `PERF-02 错误率/超时率样本量`
                  }
                />
                <TextField
                  label="延迟采样数"
                  type="number"
                  value={draft.latencySampleSize}
                  onChange={(e) => setDraft({ latencySampleSize: Number(e.target.value) || 1 })}
                  inputProps={{ min: 1, step: 1 }}
                  helperText="不含被丢弃的预热请求"
                />
              </Box>

              <TextField
                label="上下文阶梯 (tokens，逗号分隔)"
                value={ladderText}
                onChange={(e) => setLadderText(e.target.value)}
                onBlur={commitLadder}
                helperText="PERF-03 粗扫阶梯，失焦后生效并自动升序去噪"
              />
              <TextField
                label="二分细化轮数"
                type="number"
                value={draft.contextRefineRounds}
                onChange={(e) => setDraft({ contextRefineRounds: Number(e.target.value) || 0 })}
                inputProps={{ min: 0, max: 6, step: 1 }}
                helperText="粗扫命中区间后追加的二分次数，每轮会多发一次长上下文请求"
              />
            </CardContent>
          </Card>

          {/* 合规与词表 */}
          <Card>
            <CardContent className="flex flex-col gap-3">
              <Typography variant="h4">破限维度合规</Typography>
              <Divider />
              <Alert severity="warning" variant="outlined">
                <AlertTitle>使用须知</AlertTitle>
                内置破限用例集<strong>全部为占位符模板</strong>（形如 <code>{'{{TERM_A}}'}</code>），
                不含任何真实限制词。需要真实词表时请本地导入，词表<strong>只驻留内存、不写入磁盘</strong>，
                刷新页面即失效。
              </Alert>

              <FormControlLabel
                control={
                  <Switch
                    checked={draft.safetyAcknowledged}
                    onChange={(e) => setDraft({ safetyAcknowledged: e.target.checked })}
                  />
                }
                label="我已阅读并确认在授权范围内开展破限评测"
              />

              {safetySelected && !draft.safetyAcknowledged ? (
                <Alert severity="error" variant="outlined">
                  已勾选破限维度但尚未完成合规确认，执行页将拒绝启动。
                </Alert>
              ) : null}

              <Box className="flex flex-wrap items-center gap-2">
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<UploadFileOutlinedIcon />}
                  onClick={() => dictFileRef.current?.click()}
                >
                  导入本地词表
                </Button>
                <Button
                  size="small"
                  disabled={Object.keys(placeholders).length === 0}
                  onClick={() => clearPlaceholders()}
                >
                  清空词表
                </Button>
                <Chip
                  label={`已载入 ${Object.keys(placeholders).length} 个占位符`}
                  color={Object.keys(placeholders).length > 0 ? 'success' : 'default'}
                  variant="outlined"
                />
                <input
                  ref={dictFileRef}
                  type="file"
                  accept="application/json,.json"
                  hidden
                  onChange={(e) => {
                    void handleDictFile(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
              </Box>

              {placeholderStatus.required.length > 0 ? (
                <Box className="flex flex-col gap-1">
                  <Typography variant="caption" color="text.secondary">
                    当前选中用例集需要 {placeholderStatus.required.length} 个占位符
                    {placeholderStatus.missing.length > 0
                      ? `，其中 ${placeholderStatus.missing.length} 个尚未提供（对应用例会被跳过并标记 N/A）`
                      : '，均已提供'}
                    ：
                  </Typography>
                  <Box className="flex flex-wrap gap-1">
                    {placeholderStatus.required.map((token) => (
                      <Chip
                        key={token}
                        label={token}
                        color={placeholderStatus.missing.includes(token) ? 'warning' : 'success'}
                        variant="outlined"
                      />
                    ))}
                  </Box>
                </Box>
              ) : null}
            </CardContent>
          </Card>

          {/* 模板 */}
          <Card>
            <CardContent className="flex flex-col gap-3">
              <Typography variant="h4">配置模板</Typography>
              <Divider />
              <Box className="flex items-end gap-2">
                <TextField
                  label="模板名称"
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  placeholder={draft.name}
                />
                <Button
                  variant="outlined"
                  startIcon={<BookmarkAddOutlinedIcon />}
                  onClick={() => void handleSaveTemplate()}
                >
                  存为模板
                </Button>
              </Box>

              {templates.length === 0 ? (
                <Typography variant="caption" color="text.secondary">
                  还没有保存任何模板。常用的并发/超时/用例组合存成模板后可一键复用。
                </Typography>
              ) : (
                <Box className="flex flex-col">
                  {templates.map((tpl) => (
                    <Box
                      key={tpl.id}
                      className="flex items-center gap-2 border-b border-slate-100 py-1 last:border-0"
                    >
                      <Box className="min-w-0 flex-1">
                        <Typography variant="body2" noWrap>
                          {tpl.name}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {tpl.dimensions.length} 维度 · {tpl.suiteIds.length} 用例集 · 并发{' '}
                          {tpl.concurrency}
                        </Typography>
                      </Box>
                      <Button size="small" onClick={() => applyTemplate(tpl.id)}>
                        载入
                      </Button>
                      <IconButton size="small" color="error" onClick={() => void deleteConfig(tpl.id)}>
                        <DeleteOutlineIcon fontSize="small" />
                      </IconButton>
                    </Box>
                  ))}
                </Box>
              )}

              <Divider />
              <Box className="flex items-center gap-2">
                <Button size="small" startIcon={<RestartAltIcon />} onClick={() => resetDraft()}>
                  重置为默认配置
                </Button>
                <Box className="flex-1" />
                <Button
                  variant="contained"
                  size="small"
                  startIcon={<PlayCircleOutlineIcon />}
                  onClick={() => navigate('/run')}
                >
                  去执行
                </Button>
              </Box>
            </CardContent>
          </Card>
        </Box>
      </Box>

      <ConfirmDialog
        open={pendingSuiteDelete !== null}
        title="删除自定义用例集"
        danger
        confirmText="删除"
        content={
          pendingSuiteDelete
            ? `确定删除「${pendingSuiteDelete.name}」（${pendingSuiteDelete.cases.length} 条用例）吗？该操作不可恢复。`
            : ''
        }
        onCancel={() => setPendingSuiteDelete(null)}
        onConfirm={() => void confirmSuiteDelete()}
      />
    </Box>
  );
};

export default ConfigCenterPage;
