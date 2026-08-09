import React, { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import SettingsIcon from '@mui/icons-material/Settings';
import type {
  AuthStyle,
  ConnectivityResult,
  Provider,
  ProviderDraft,
  ProviderType,
  ProtocolKind,
  TransportMode,
} from '@/types';
import { DEFAULT_PROVIDER_TIMEOUT_MS, DEFAULT_TRANSPORT, MAX_TIMEOUT_MS, MIN_TIMEOUT_MS, getDefaultProxyBase } from '@/constants/defaults';
import { getProxyBase } from '@/lib/runtimeConfig';
import { pingProxySidecar } from '@/lib/http';
import { repository } from '@/lib/storage';
import { IS_DESKTOP } from '@/lib/env';
import { useSettingsStore } from '@/store/settingsStore';

const TYPE_OPTIONS: ReadonlyArray<{ value: ProviderType; label: string }> = [
  { value: 'chat', label: '对话 (chat)' },
  { value: 'image', label: '生图 (image)' },
  { value: 'multimodal', label: '多模态 (multimodal)' },
  { value: 'agent', label: 'Agent (agent)' },
];

const PROTOCOL_OPTIONS: ReadonlyArray<{ value: ProtocolKind; label: string }> = [
  { value: 'openai-compatible', label: 'OpenAI 兼容' },
  { value: 'custom', label: '自定义（预留扩展）' },
];

const TRANSPORT_OPTIONS: ReadonlyArray<{ value: TransportMode; label: string }> = [
  { value: 'direct', label: '浏览器直连 (direct)' },
  { value: 'proxy', label: '本地代理转发 (proxy)' },
];

const AUTH_OPTIONS: ReadonlyArray<{ value: AuthStyle; label: string }> = [
  { value: 'bearer', label: 'Authorization: Bearer' },
  { value: 'api-key-header', label: '自定义请求头' },
  { value: 'query-param', label: 'URL 查询参数' },
];

function emptyDraft(): ProviderDraft {
  return {
    name: '',
    type: 'chat',
    protocol: 'openai-compatible',
    endpoint: 'https://api.openai.com/v1',
    model: '',
    auth: { style: 'bearer' },
    transport: DEFAULT_TRANSPORT,
    supportsStream: true,
    timeoutMs: DEFAULT_PROVIDER_TIMEOUT_MS,
  };
}

function toDraft(provider: Provider): ProviderDraft {
  return {
    id: provider.id,
    secretRef: provider.secretRef,
    name: provider.name,
    type: provider.type,
    protocol: provider.protocol,
    endpoint: provider.endpoint,
    model: provider.model,
    auth: { ...provider.auth },
    transport: provider.transport,
    supportsStream: provider.supportsStream,
    extraHeaders: provider.extraHeaders,
    timeoutMs: provider.timeoutMs,
    tags: provider.tags,
    imageModel: provider.imageModel,
    note: provider.note,
  };
}

export interface ProviderFormProps {
  open: boolean;
  /** null 表示新建。 */
  initial: Provider | null;
  /** 该 Provider 在本地密钥库中是否已有密钥（编辑时留空即保持原值）。 */
  hasExistingSecret?: boolean;
  onClose(): void;
  onSubmit(draft: ProviderDraft, plainKey?: string): Promise<void>;
  onTest(draft: ProviderDraft, plainKey?: string): Promise<ConnectivityResult>;
}

/**
 * Provider 新建 / 编辑表单。
 * API Key 只在提交那一刻作为参数传出，组件卸载后不再保留。
 */
const ProviderForm: React.FC<ProviderFormProps> = ({
  open,
  initial,
  hasExistingSecret = false,
  onClose,
  onSubmit,
  onTest,
}) => {
  const [draft, setDraft] = useState<ProviderDraft>(emptyDraft);
  const [apiKey, setApiKey] = useState<string>('');
  const [headersText, setHeadersText] = useState<string>('');
  const [tagsText, setTagsText] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [testResult, setTestResult] = useState<ConnectivityResult | null>(null);
  const [testing, setTesting] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [proxyDialogOpen, setProxyDialogOpen] = useState<boolean>(false);
  const [proxyProbe, setProxyProbe] = useState<'idle' | 'probing' | 'up' | 'down'>('idle');
  // Bump on settings change to re-derive the proxy base label.
  const [proxyTick, setProxyTick] = useState<number>(0);
  // 连接后从 /models 拉取的模型列表
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState<boolean>(false);
  const [modelError, setModelError] = useState<string>('');
  const proxyOverride = useSettingsStore((s) => s.proxyBaseUrl);
  const proxyBase = (proxyOverride && proxyOverride.length > 0)
    ? proxyOverride.replace(/\/+$/, '')
    : getDefaultProxyBase();

  useEffect(() => {
    if (!open) return;
    const next = initial ? toDraft(initial) : emptyDraft();
    // 桌面环境下无需 proxy，固定为直连。
    if (IS_DESKTOP) next.transport = 'direct';
    setDraft(next);
    setApiKey('');
    setHeadersText(next.extraHeaders ? JSON.stringify(next.extraHeaders, null, 2) : '');
    setTagsText((next.tags ?? []).join(', '));
    setError('');
    setTestResult(null);
    setTesting(false);
    setSaving(false);
  }, [open, initial]);

  const patch = (part: Partial<ProviderDraft>): void => setDraft((d) => ({ ...d, ...part }));

  /** 收集表单 → ProviderDraft，返回 null 表示校验未通过。 */
  const buildDraft = (): ProviderDraft | null => {
    if (draft.name.trim().length === 0) {
      setError('请填写显示名称');
      return null;
    }
    if (!/^https?:\/\//i.test(draft.endpoint.trim())) {
      setError('Endpoint 需以 http:// 或 https:// 开头');
      return null;
    }
    if (draft.model.trim().length === 0) {
      setError('请填写模型名');
      return null;
    }
    if (draft.auth.style === 'api-key-header' && !draft.auth.headerName) {
      setError('自定义请求头模式需填写 Header 名称');
      return null;
    }
    if (draft.auth.style === 'query-param' && !draft.auth.queryParamName) {
      setError('查询参数模式需填写参数名');
      return null;
    }

    let extraHeaders: Record<string, string> | undefined;
    const raw = headersText.trim();
    if (raw.length > 0) {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          throw new Error('必须是 JSON 对象');
        }
        extraHeaders = {};
        Object.entries(parsed as Record<string, unknown>).forEach(([k, v]) => {
          if (extraHeaders) extraHeaders[k] = String(v);
        });
      } catch (err) {
        setError(`附加请求头格式错误：${(err as Error).message}`);
        return null;
      }
    }

    const tags = tagsText
      .split(/[,，]/)
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    setError('');
    return {
      ...draft,
      name: draft.name.trim(),
      endpoint: draft.endpoint.trim().replace(/\/+$/, ''),
      model: draft.model.trim(),
      imageModel: draft.imageModel?.trim() ? draft.imageModel.trim() : undefined,
      note: draft.note?.trim() ? draft.note.trim() : undefined,
      extraHeaders,
      tags: tags.length > 0 ? tags : undefined,
    };
  };

  const handleTest = async (): Promise<void> => {
    const built = buildDraft();
    if (!built) return;
    setTesting(true);
    setTestResult(null);
    try {
      const result = await onTest(built, apiKey || undefined);
      setTestResult(result);
    } catch (err) {
      setTestResult({
        ok: false,
        latencyMs: 0,
        errorCategory: 'unknown',
        message: (err as Error).message,
      });
    } finally {
      setTesting(false);
    }
  };

  const handleProbeProxy = async (): Promise<void> => {
    setProxyProbe('probing');
    const ok = await pingProxySidecar(4000).catch(() => false);
    setProxyProbe(ok ? 'up' : 'down');
  };

  /** 按 Endpoint 调用 /models 拉取模型列表并填充下拉。 */
  const handleFetchModels = async (): Promise<void> => {
    const built = buildDraft();
    if (!built) return;
    setFetchingModels(true);
    setModelError('');
    try {
      const key =
        apiKey ||
        (hasExistingSecret
          ? await repository.getSecret(built.secretRef ?? '').catch(() => '')
          : '');
      const url = new URL(`${built.endpoint}/models`);
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (built.auth.style === 'bearer') {
        if (!key) throw new Error('请先填写 API Key');
        headers['Authorization'] = `Bearer ${key}`;
      } else if (built.auth.style === 'api-key-header') {
        if (!key) throw new Error('请先填写 API Key');
        headers[built.auth.headerName || 'Authorization'] = key;
      } else if (built.auth.style === 'query-param') {
        if (!key) throw new Error('请先填写 API Key');
        url.searchParams.set(built.auth.queryParamName || 'key', key);
      }
      const res = await fetch(url.toString(), { method: 'GET', headers });
      if (!res.ok) throw new Error(`拉取模型失败：HTTP ${res.status}`);
      const json = (await res.json()) as { data?: unknown[]; models?: unknown[] };
      const list: unknown[] = Array.isArray(json?.data)
        ? json.data
        : Array.isArray(json?.models)
          ? json.models
          : [];
      const ids = list
        .map((m) => (m && typeof m === 'object' ? (m as { id?: unknown }).id : undefined))
        .filter((x): x is string => typeof x === 'string' && x.length > 0);
      if (ids.length === 0) {
        throw new Error('接口未返回模型列表（data[] 为空或非标准格式）');
      }
      setModelOptions(ids);
      if (!built.model) patch({ model: ids[0] });
    } catch (err) {
      setModelOptions([]);
      setModelError((err as Error).message);
    } finally {
      setFetchingModels(false);
    }
  };

  const transportOptions = IS_DESKTOP
    ? TRANSPORT_OPTIONS.filter((o) => o.value === 'direct')
    : TRANSPORT_OPTIONS;

  const isProxyMode = draft.transport === 'proxy' && !IS_DESKTOP;
  // proxyTick is referenced to re-evaluate proxyBase when the user updates
  // the override in the dialog.
  void proxyTick;

  const handleSubmit = async (): Promise<void> => {
    const built = buildDraft();
    if (!built) return;
    setSaving(true);
    try {
      await onSubmit(built, apiKey || undefined);
      onClose();
    } catch (err) {
      setError(`保存失败：${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle>{initial ? `编辑 Provider · ${initial.name}` : '新增 Provider'}</DialogTitle>
      <DialogContent dividers className="flex flex-col gap-3">
        {error ? <Alert severity="error">{error}</Alert> : null}

        <Box className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <TextField
            autoFocus
            label="显示名称"
            required
            value={draft.name}
            onChange={(e) => patch({ name: e.target.value })}
            placeholder="例如 GPT-4o"
          />
          <TextField
            select
            label="类型"
            value={draft.type}
            onChange={(e) => patch({ type: e.target.value as ProviderType })}
            helperText="决定可运行哪些功能探针"
          >
            {TYPE_OPTIONS.map((o) => (
              <MenuItem key={o.value} value={o.value}>
                {o.label}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            label="Endpoint"
            required
            value={draft.endpoint}
            onChange={(e) => patch({ endpoint: e.target.value })}
            helperText="Base URL，不含结尾斜杠，例如 https://api.openai.com/v1"
          />
          {modelOptions.length > 0 ? (
            <TextField
              select
              label="模型名（已拉取）"
              required
              value={draft.model}
              onChange={(e) => patch({ model: e.target.value })}
            >
              {modelOptions.map((m) => (
                <MenuItem key={m} value={m}>
                  {m}
                </MenuItem>
              ))}
            </TextField>
          ) : (
            <TextField
              label="模型名"
              required
              value={draft.model}
              onChange={(e) => patch({ model: e.target.value })}
              placeholder="gpt-4o-mini"
            />
          )}

          <TextField
            select
            label="协议"
            value={draft.protocol}
            onChange={(e) => patch({ protocol: e.target.value as ProtocolKind })}
          >
            {PROTOCOL_OPTIONS.map((o) => (
              <MenuItem key={o.value} value={o.value}>
                {o.label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="生图模型（可选）"
            value={draft.imageModel ?? ''}
            onChange={(e) => patch({ imageModel: e.target.value })}
            helperText="留空则复用主模型执行 FUNC-02 生图探针"
          />
        </Box>

        <Box className="flex flex-wrap items-center gap-2">
          <Button
            variant="outlined"
            size="small"
            onClick={() => void handleFetchModels()}
            disabled={fetchingModels}
          >
            {fetchingModels ? '拉取中…' : '连接并拉取模型'}
          </Button>
          <Typography variant="caption" color="text.secondary">
            按上方 Endpoint 调用 /models 拉取模型列表，自动填充模型名下拉
          </Typography>
        </Box>
        {modelError ? <Alert severity="error">{modelError}</Alert> : null}

        <Divider textAlign="left">
          <Typography variant="caption" color="text.secondary">
            鉴权
          </Typography>
        </Divider>

        <Box className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <TextField
            select
            label="鉴权方式"
            value={draft.auth.style}
            onChange={(e) => patch({ auth: { ...draft.auth, style: e.target.value as AuthStyle } })}
          >
            {AUTH_OPTIONS.map((o) => (
              <MenuItem key={o.value} value={o.value}>
                {o.label}
              </MenuItem>
            ))}
          </TextField>

          {draft.auth.style === 'api-key-header' ? (
            <TextField
              label="Header 名称"
              value={draft.auth.headerName ?? ''}
              onChange={(e) => patch({ auth: { ...draft.auth, headerName: e.target.value } })}
              placeholder="x-api-key"
            />
          ) : null}

          {draft.auth.style === 'query-param' ? (
            <TextField
              label="查询参数名"
              value={draft.auth.queryParamName ?? ''}
              onChange={(e) => patch({ auth: { ...draft.auth, queryParamName: e.target.value } })}
              placeholder="key"
            />
          ) : null}

          <TextField
            label="API Key"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            autoComplete="new-password"
            helperText={
              hasExistingSecret
                ? '已存有密钥，留空表示保持不变；填写则覆盖'
                : 'AES-GCM-256 加密后仅存本机，日志中会自动脱敏'
            }
          />
        </Box>

        <Divider textAlign="left">
          <Typography variant="caption" color="text.secondary">
            传输与超时
          </Typography>
        </Divider>

        <Box className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <TextField
            select
            label="传输方式"
            value={draft.transport}
            onChange={(e) => patch({ transport: e.target.value as TransportMode })}
            helperText="遇到 CORS 拦截时切换为 proxy，并确保对应地址的 sidecar 已启动"
          >
            {transportOptions.map((o) => (
              <MenuItem key={o.value} value={o.value}>
                {o.label}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            label="超时 (ms)"
            type="number"
            value={draft.timeoutMs}
            onChange={(e) => patch({ timeoutMs: Number(e.target.value) || DEFAULT_PROVIDER_TIMEOUT_MS })}
            inputProps={{ min: MIN_TIMEOUT_MS, max: MAX_TIMEOUT_MS, step: 1000 }}
            helperText={`范围 ${MIN_TIMEOUT_MS} - ${MAX_TIMEOUT_MS}`}
          />

          <FormControlLabel
            control={
              <Switch
                checked={draft.supportsStream}
                onChange={(e) => patch({ supportsStream: e.target.checked })}
              />
            }
            label="支持 SSE 流式（决定能否采集 TTFT）"
          />

          <TextField
            label="标签（逗号分隔）"
            value={tagsText}
            onChange={(e) => setTagsText(e.target.value)}
            placeholder="国内, 高并发"
          />
        </Box>

        {isProxyMode ? (
          <Alert
            severity={proxyProbe === 'down' ? 'warning' : 'info'}
            icon={false}
            action={
              <Stack direction="row" spacing={0.5} alignItems="center">
                <Tooltip title="ping 一次 /health，验证代理可达">
                  <span>
                    <Button
                      size="small"
                      onClick={() => void handleProbeProxy()}
                      disabled={proxyProbe === 'probing'}
                    >
                      {proxyProbe === 'probing' ? '检测中…' : '测试代理'}
                    </Button>
                  </span>
                </Tooltip>
                <Tooltip title="修改代理地址">
                  <IconButton size="small" onClick={() => setProxyDialogOpen(true)}>
                    <SettingsIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Stack>
            }
          >
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" rowGap={0.5}>
              <Typography variant="body2">代理地址：</Typography>
              <Chip
                size="small"
                variant="outlined"
                label={proxyBase}
                sx={{ fontFamily: 'ui-monospace, SFMono-Regular, monospace' }}
              />
              {proxyProbe === 'up' ? <Chip size="small" color="success" label="可达" /> : null}
              {proxyProbe === 'down' ? <Chip size="small" color="warning" label="不可达" /> : null}
            </Stack>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
              浏览器会请求 <code>{proxyBase}/proxy</code>，并把目标 URL 放在 <code>x-target-url</code> 头里。
              若同源部署（如当前 <code>{typeof window !== 'undefined' ? window.location.origin : ''}</code>），
              需先用 nginx 把 <code>/tester-proxy/</code> 反代到 127.0.0.1:8787。
            </Typography>
          </Alert>
        ) : null}

        <TextField
          label="附加请求头（JSON 对象，可选）"
          value={headersText}
          onChange={(e) => setHeadersText(e.target.value)}
          multiline
          minRows={3}
          placeholder={'{\n  "X-Custom": "value"\n}'}
        />

        <TextField
          label="备注（可选）"
          value={draft.note ?? ''}
          onChange={(e) => patch({ note: e.target.value })}
        />

        {testResult ? (
          <Alert severity={testResult.ok ? 'success' : 'error'}>
            {testResult.ok
              ? `连通正常，握手耗时 ${Math.round(testResult.latencyMs)}ms`
              : testResult.message}
          </Alert>
        ) : null}
      </DialogContent>

      <DialogActions>
        <Button
          onClick={() => void handleTest()}
          disabled={testing || saving}
          startIcon={testing ? <CircularProgress size={14} /> : undefined}
        >
          {testing ? '测试中…' : '连通性测试'}
        </Button>
        <Box className="flex-1" />
        <Button onClick={onClose} disabled={saving}>
          取消
        </Button>
        <Button variant="contained" onClick={() => void handleSubmit()} disabled={saving}>
          保存
        </Button>
      </DialogActions>

      <ProxySettingsDialog
        open={proxyDialogOpen}
        onClose={() => {
          setProxyDialogOpen(false);
          setProxyTick((t) => t + 1);
          setProxyProbe('idle');
        }}
      />
    </Dialog>
  );
};

/** Compact dialog for editing the runtime proxy base URL. */
const ProxySettingsDialog: React.FC<{
  open: boolean;
  onClose(): void;
}> = ({ open, onClose }) => {
  const override = useSettingsStore((s) => s.proxyBaseUrl);
  const setOverride = useSettingsStore((s) => s.setProxyBaseUrl);
  const clearOverride = useSettingsStore((s) => s.clearProxyBaseUrl);
  const [text, setText] = useState<string>(override);

  useEffect(() => {
    if (open) setText(override);
  }, [open, override]);

  const save = (): void => {
    const trimmed = text.trim();
    if (trimmed.length === 0) clearOverride();
    else setOverride(trimmed);
    onClose();
  };

  const useDefault = (): void => {
    setText(getDefaultProxyBase());
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>代理地址</DialogTitle>
      <DialogContent dividers className="flex flex-col gap-3">
        <Alert severity="info">
          浏览器在「proxy 传输」下会向 <code>{'<base>'}/proxy</code> 发送请求，并把目标 URL
          放在 <code>x-target-url</code> 头里，proxy 进程原样转发。
        </Alert>
        <TextField
          autoFocus
          label="代理 Base URL"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={getDefaultProxyBase()}
          helperText="留空 = 使用默认（部署版：同源 /tester-proxy，开发版：http://localhost:8787）"
        />
        <Stack direction="row" spacing={1}>
          <Button size="small" onClick={useDefault}>填入默认值</Button>
          <Button size="small" onClick={() => setText('')}>清空</Button>
        </Stack>
        <Typography variant="caption" color="text.secondary">
          部署到服务器时，建议用 nginx 把 <code>/tester-proxy/</code> 反代到
          127.0.0.1:8787，这样走同源，零 CORS。
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>取消</Button>
        <Button variant="contained" onClick={save}>保存</Button>
      </DialogActions>
    </Dialog>
  );
};

export default ProviderForm;
