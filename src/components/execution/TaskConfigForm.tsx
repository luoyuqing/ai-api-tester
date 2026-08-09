import React, { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormHelperText from '@mui/material/FormHelperText';
import FormLabel from '@mui/material/FormLabel';
import Grid from '@mui/material/Grid';
import InputLabel from '@mui/material/InputLabel';
import ListItemText from '@mui/material/ListItemText';
import MenuItem from '@mui/material/MenuItem';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import Select, { type SelectChangeEvent } from '@mui/material/Select';
import Slider from '@mui/material/Slider';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import type { Dimension, EvaluationConfig, Provider, ScoringMode, TestSuite } from '@/types';
import { ALL_DIMENSIONS } from '@/types';
import { DIMENSION_META } from '@/constants/dimensions';
import {
  MAX_COMPARE_MODELS,
  MAX_CONCURRENCY,
  MAX_RETRIES_LIMIT,
  MAX_TIMEOUT_MS,
  MIN_COMPARE_MODELS,
  MIN_CONCURRENCY,
  MIN_STABILITY_SAMPLE_SIZE,
  MIN_TIMEOUT_MS,
} from '@/constants/defaults';
import { BUILTIN_SUITES } from '@/data/testsets';

const SCORING_OPTIONS: ReadonlyArray<{ value: ScoringMode; label: string; hint: string }> = [
  { value: 'rule', label: '规则判分', hint: '零额外成本，完全离线，判分口径固定' },
  { value: 'llm-judge', label: '大模型裁判', hint: '由裁判模型打分，需要额外指定一个 Provider' },
  { value: 'hybrid', label: '混合判分', hint: '规则先筛，再由裁判模型细评' },
];

const MAX_REFINE_ROUNDS = 5;

export interface TaskConfigFormProps {
  value: EvaluationConfig;
  providers: Provider[];
  /**
   * 可选用例集。默认取内置清单；页面通常传入 testConfigStore.suites
   * 以便把用户导入的自定义用例集也纳入选择范围。
   */
  suites?: readonly TestSuite[];
  disabled?: boolean;
  onChange(next: EvaluationConfig): void;
}

/** 受控数字输入：非法值直接回退，避免把 NaN 写进配置。 */
function toInt(raw: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

/** 逗号/空白分隔的 token 阶梯；非正整数一律丢弃后升序去重。 */
function parseLadder(raw: string): number[] {
  const values = raw
    .split(/[,，\s]+/)
    .map((token) => Number.parseInt(token, 10))
    .filter((n) => Number.isFinite(n) && n > 0);
  return Array.from(new Set(values)).sort((a, b) => a - b);
}

/** MUI 多选的 value 在某些浏览器自动填充下会退化成字符串，需要统一收窄。 */
function asStringArray(value: string[] | string): string[] {
  return typeof value === 'string' ? value.split(',').filter((s) => s.length > 0) : value;
}

/**
 * 评测任务配置表单。
 *
 * 完全受控：唯一的内部 state 是上下文阶梯的文本镜像 —— 用户输入「4096, 」这种
 * 中间态时不能立刻回写数组，否则光标会被 re-render 打断。
 */
const TaskConfigForm: React.FC<TaskConfigFormProps> = ({
  value,
  providers,
  suites = BUILTIN_SUITES,
  disabled = false,
  onChange,
}) => {
  const [ladderText, setLadderText] = useState<string>(() => value.contextLadder.join(', '));

  /**
   * 只在「外部把阶梯改成了文本框解析不出的值」时才回灌文本（例如载入模板）。
   * 无条件同步会在用户敲到一半时被排序后的结果顶掉，光标直接跳走。
   */
  useEffect(() => {
    const current = parseLadder(ladderText);
    const incoming = value.contextLadder;
    const same = current.length === incoming.length && current.every((n, i) => n === incoming[i]);
    if (!same) setLadderText(incoming.join(', '));
    // ladderText 只作为比较基准，不能进依赖表，否则清空输入框会被立刻回滚。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.contextLadder]);

  const patch = (delta: Partial<EvaluationConfig>): void => {
    onChange({ ...value, ...delta });
  };

  const toggleDimension = (dim: Dimension): void => {
    const has = value.dimensions.includes(dim);
    patch({ dimensions: has ? value.dimensions.filter((d) => d !== dim) : [...value.dimensions, dim] });
  };

  const handleProviders = (e: SelectChangeEvent<string[]>): void => {
    patch({ providerIds: asStringArray(e.target.value) });
  };

  const handleSuites = (e: SelectChangeEvent<string[]>): void => {
    patch({ suiteIds: asStringArray(e.target.value) });
  };

  const handleLadder = (raw: string): void => {
    setLadderText(raw);
    const parsed = parseLadder(raw);
    // 解析不出任何有效值时保留旧配置，等用户补全再回写。
    if (parsed.length > 0) patch({ contextLadder: parsed });
  };

  const providerName = (id: string): string => {
    const hit = providers.find((p) => p.id === id);
    return hit ? `${hit.name} · ${hit.model}` : id;
  };

  const suiteName = (id: string): string => suites.find((s) => s.id === id)?.name ?? id;

  const judgeNeeded = value.scoring.mode !== 'rule';
  const selectedCount = value.providerIds.length;

  return (
    <Box className="flex flex-col gap-4">
      {/* ───────── 基础 ───────── */}
      <Card>
        <CardContent className="flex flex-col gap-3">
          <Typography variant="h5">基础</Typography>
          <Divider />
          <TextField
            label="任务名称"
            value={value.name}
            disabled={disabled}
            onChange={(e) => patch({ name: e.target.value })}
            helperText="会写入结果快照，用于在历史记录里区分不同批次"
          />
        </CardContent>
      </Card>

      {/* ───────── 范围 ───────── */}
      <Card>
        <CardContent className="flex flex-col gap-3">
          <Typography variant="h5">范围</Typography>
          <Divider />

          <Grid container spacing={2}>
            <Grid item xs={12} md={6}>
              <FormControl fullWidth size="small" disabled={disabled}>
                <InputLabel id="task-config-providers">被测模型</InputLabel>
                <Select<string[]>
                  labelId="task-config-providers"
                  label="被测模型"
                  multiple
                  value={value.providerIds}
                  onChange={handleProviders}
                  renderValue={(selected) => (
                    <Box className="flex flex-wrap gap-1">
                      {selected.map((id) => (
                        <Chip key={id} label={providerName(id)} variant="outlined" />
                      ))}
                    </Box>
                  )}
                >
                  {providers.length === 0 ? (
                    <MenuItem value="" disabled>
                      尚未配置任何 Provider
                    </MenuItem>
                  ) : null}
                  {providers.map((p) => (
                    <MenuItem key={p.id} value={p.id}>
                      <Checkbox size="small" checked={value.providerIds.includes(p.id)} />
                      <ListItemText primary={p.name} secondary={p.model} />
                    </MenuItem>
                  ))}
                </Select>
                <FormHelperText>
                  已选 {selectedCount} 个 · 建议 {MIN_COMPARE_MODELS}-{MAX_COMPARE_MODELS} 个，太少无法横向对比，太多会显著拉长耗时
                </FormHelperText>
              </FormControl>
            </Grid>

            <Grid item xs={12} md={6}>
              <FormControl fullWidth size="small" disabled={disabled}>
                <InputLabel id="task-config-suites">测试集</InputLabel>
                <Select<string[]>
                  labelId="task-config-suites"
                  label="测试集"
                  multiple
                  value={value.suiteIds}
                  onChange={handleSuites}
                  renderValue={(selected) => (
                    <Box className="flex flex-wrap gap-1">
                      {selected.map((id) => (
                        <Chip key={id} label={suiteName(id)} variant="outlined" />
                      ))}
                    </Box>
                  )}
                >
                  {suites.map((suite) => (
                    <MenuItem key={suite.id} value={suite.id}>
                      <Checkbox size="small" checked={value.suiteIds.includes(suite.id)} />
                      <ListItemText
                        primary={suite.name}
                        secondary={`${suite.cases.length} 条用例 · v${suite.version}`}
                      />
                    </MenuItem>
                  ))}
                </Select>
                <FormHelperText>
                  已选 {value.suiteIds.length} / {suites.length} 个用例集
                </FormHelperText>
              </FormControl>
            </Grid>

            <Grid item xs={12}>
              <FormControl component="fieldset" disabled={disabled}>
                <FormLabel component="legend">
                  <Typography variant="subtitle2">评测维度</Typography>
                </FormLabel>
                <Box className="flex flex-col">
                  {ALL_DIMENSIONS.map((dim) => {
                    const meta = DIMENSION_META.find((m) => m.key === dim);
                    if (!meta) return null;
                    return (
                      <Tooltip key={dim} title={meta.description} placement="right">
                        <FormControlLabel
                          control={
                            <Checkbox
                              size="small"
                              checked={value.dimensions.includes(dim)}
                              onChange={() => toggleDimension(dim)}
                            />
                          }
                          label={
                            <Box className="flex items-center gap-1">
                              <span>{meta.label}</span>
                              <Chip label={`权重 ${(meta.weight * 100).toFixed(0)}%`} variant="outlined" />
                            </Box>
                          }
                        />
                      </Tooltip>
                    );
                  })}
                </Box>
                <FormHelperText>
                  未勾选的维度会整体缺席报告；单项 N/A 的指标会自动从加权分母里剔除。
                </FormHelperText>
              </FormControl>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {/* ───────── 执行参数 ───────── */}
      <Card>
        <CardContent className="flex flex-col gap-3">
          <Typography variant="h5">执行参数</Typography>
          <Divider />

          <Grid container spacing={2}>
            <Grid item xs={12} md={6}>
              <Typography variant="subtitle2">并发数：{value.concurrency}</Typography>
              <Slider
                size="small"
                disabled={disabled}
                value={value.concurrency}
                min={MIN_CONCURRENCY}
                max={MAX_CONCURRENCY}
                step={1}
                marks
                valueLabelDisplay="auto"
                onChange={(_e, next) =>
                  patch({ concurrency: Array.isArray(next) ? next[0] : next })
                }
              />
              <Typography variant="caption" color="text.secondary">
                并发过高会放大限流与排队效应，污染延迟指标；性能采样建议 ≤5。
              </Typography>
            </Grid>

            <Grid item xs={12} md={6}>
              <TextField
                label="超时 (ms)"
                type="number"
                disabled={disabled}
                value={value.timeoutMs}
                onChange={(e) =>
                  patch({ timeoutMs: toInt(e.target.value, value.timeoutMs, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS) })
                }
                inputProps={{ min: MIN_TIMEOUT_MS, max: MAX_TIMEOUT_MS, step: 1000 }}
                helperText={`单次请求上限，${MIN_TIMEOUT_MS / 1000}s ~ ${MAX_TIMEOUT_MS / 1000}s`}
              />
            </Grid>

            <Grid item xs={12} md={6}>
              <TextField
                select
                label="重试次数"
                disabled={disabled}
                value={String(value.maxRetries)}
                onChange={(e) => patch({ maxRetries: Number(e.target.value) })}
                helperText="仅对 429 / 5xx 生效，重试成功不计入错误率"
              >
                {Array.from({ length: MAX_RETRIES_LIMIT + 1 }, (_v, i) => i).map((n) => (
                  <MenuItem key={n} value={String(n)}>
                    {n === 0 ? '不重试' : `${n} 次`}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>

            <Grid item xs={12} md={6}>
              <TextField
                label="稳定性样本量"
                type="number"
                disabled={disabled}
                value={value.stabilitySampleSize}
                onChange={(e) =>
                  patch({ stabilitySampleSize: toInt(e.target.value, value.stabilitySampleSize, 1, 500) })
                }
                inputProps={{ min: 1, step: 1 }}
                error={value.stabilitySampleSize < MIN_STABILITY_SAMPLE_SIZE}
                helperText={
                  value.stabilitySampleSize < MIN_STABILITY_SAMPLE_SIZE
                    ? `PERF-02 要求 N ≥ ${MIN_STABILITY_SAMPLE_SIZE}，样本过少时错误率不可信`
                    : 'PERF-02 错误率 / 超时率的采样次数'
                }
              />
            </Grid>

            <Grid item xs={12} md={6}>
              <TextField
                label="时延样本量"
                type="number"
                disabled={disabled}
                value={value.latencySampleSize}
                onChange={(e) =>
                  patch({ latencySampleSize: toInt(e.target.value, value.latencySampleSize, 1, 100) })
                }
                inputProps={{ min: 1, step: 1 }}
                helperText="PERF-01 采样次数，不含被丢弃的预热请求"
              />
            </Grid>

            <Grid item xs={12} md={6}>
              <TextField
                label="上下文细化轮数"
                type="number"
                disabled={disabled}
                value={value.contextRefineRounds}
                onChange={(e) =>
                  patch({
                    contextRefineRounds: toInt(e.target.value, value.contextRefineRounds, 0, MAX_REFINE_ROUNDS),
                  })
                }
                inputProps={{ min: 0, max: MAX_REFINE_ROUNDS, step: 1 }}
                helperText="粗扫命中区间后追加的二分次数，每轮多发一次长上下文请求"
              />
            </Grid>

            <Grid item xs={12}>
              <TextField
                label="上下文阶梯 (tokens，逗号分隔)"
                disabled={disabled}
                value={ladderText}
                onChange={(e) => handleLadder(e.target.value)}
                helperText={`PERF-03 粗扫阶梯，非正整数会被忽略并自动升序去重。当前生效：${value.contextLadder.join(' / ')}`}
              />
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {/* ───────── 评分 ───────── */}
      <Card>
        <CardContent className="flex flex-col gap-3">
          <Typography variant="h5">评分</Typography>
          <Divider />

          <Grid container spacing={2}>
            <Grid item xs={12} md={6}>
              <FormControl disabled={disabled}>
                <FormLabel id="task-config-scoring">
                  <Typography variant="subtitle2">评分模式</Typography>
                </FormLabel>
                <RadioGroup
                  aria-labelledby="task-config-scoring"
                  value={value.scoring.mode}
                  onChange={(e) =>
                    patch({ scoring: { ...value.scoring, mode: e.target.value as ScoringMode } })
                  }
                >
                  {SCORING_OPTIONS.map((o) => (
                    <FormControlLabel
                      key={o.value}
                      value={o.value}
                      control={<Radio size="small" />}
                      label={
                        <Box>
                          <Typography variant="body2">{o.label}</Typography>
                          <Typography variant="caption" color="text.secondary">
                            {o.hint}
                          </Typography>
                        </Box>
                      }
                    />
                  ))}
                </RadioGroup>
              </FormControl>
            </Grid>

            {judgeNeeded ? (
              <Grid item xs={12} md={6}>
                <TextField
                  select
                  label="裁判模型"
                  disabled={disabled}
                  value={value.scoring.judgeProviderId ?? ''}
                  onChange={(e) =>
                    patch({
                      scoring: { ...value.scoring, judgeProviderId: e.target.value || undefined },
                    })
                  }
                  helperText={
                    providers.length === 0
                      ? '尚未配置任何 Provider，先去配置中心新增'
                      : '建议选一个与被测模型无关的稳定模型，避免自己给自己打分'
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
              </Grid>
            ) : null}
          </Grid>
        </CardContent>
      </Card>
    </Box>
  );
};

export default TaskConfigForm;
