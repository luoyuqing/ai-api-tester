import React, { useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined';
import type { AuthStyle, ProviderDraft, ProviderType, ProtocolKind, TransportMode } from '@/types';
import type { ProviderImportItem } from '@/hooks/useProviders';
import { DEFAULT_PROVIDER_TIMEOUT_MS, DEFAULT_TRANSPORT } from '@/constants/defaults';

const TEMPLATE = `[
  {
    "name": "GPT-4o",
    "type": "chat",
    "endpoint": "https://api.openai.com/v1",
    "model": "gpt-4o-mini",
    "transport": "direct",
    "supportsStream": true,
    "auth": { "style": "bearer" },
    "apiKey": "可选，留空则稍后在编辑里补录"
  }
]`;

const TYPES: readonly ProviderType[] = ['chat', 'image', 'multimodal', 'agent'];
const PROTOCOLS: readonly ProtocolKind[] = ['openai-compatible', 'custom'];
const TRANSPORTS: readonly TransportMode[] = ['direct', 'proxy'];
const AUTH_STYLES: readonly AuthStyle[] = ['bearer', 'api-key-header', 'query-param'];

function pickString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** 宽松解析一条导入记录：缺省字段用工程默认值补齐，非法枚举回落到默认值。 */
export function normalizeImportedProvider(raw: unknown, indexLabel: string): ProviderImportItem {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(`${indexLabel}：应为对象`);
  }
  const source = raw as Record<string, unknown>;

  const name = pickString(source, 'name');
  const endpoint = pickString(source, 'endpoint');
  const model = pickString(source, 'model');
  if (!name) throw new Error(`${indexLabel}：缺少 name`);
  if (!endpoint) throw new Error(`${indexLabel}：缺少 endpoint`);
  if (!model) throw new Error(`${indexLabel}：缺少 model`);

  const typeRaw = pickString(source, 'type');
  const protocolRaw = pickString(source, 'protocol');
  const transportRaw = pickString(source, 'transport');

  const authSource =
    typeof source.auth === 'object' && source.auth !== null
      ? (source.auth as Record<string, unknown>)
      : {};
  const authStyleRaw = pickString(authSource, 'style');

  let extraHeaders: Record<string, string> | undefined;
  if (typeof source.extraHeaders === 'object' && source.extraHeaders !== null) {
    extraHeaders = {};
    Object.entries(source.extraHeaders as Record<string, unknown>).forEach(([k, v]) => {
      if (extraHeaders) extraHeaders[k] = String(v);
    });
  }

  const tags = Array.isArray(source.tags)
    ? (source.tags as unknown[]).map((t) => String(t)).filter((t) => t.length > 0)
    : undefined;

  const draft: ProviderDraft = {
    name,
    endpoint: endpoint.replace(/\/+$/, ''),
    model,
    type: TYPES.includes(typeRaw as ProviderType) ? (typeRaw as ProviderType) : 'chat',
    protocol: PROTOCOLS.includes(protocolRaw as ProtocolKind)
      ? (protocolRaw as ProtocolKind)
      : 'openai-compatible',
    transport: TRANSPORTS.includes(transportRaw as TransportMode)
      ? (transportRaw as TransportMode)
      : DEFAULT_TRANSPORT,
    supportsStream: typeof source.supportsStream === 'boolean' ? source.supportsStream : true,
    timeoutMs:
      typeof source.timeoutMs === 'number' && Number.isFinite(source.timeoutMs)
        ? source.timeoutMs
        : DEFAULT_PROVIDER_TIMEOUT_MS,
    auth: {
      style: AUTH_STYLES.includes(authStyleRaw as AuthStyle) ? (authStyleRaw as AuthStyle) : 'bearer',
      headerName: pickString(authSource, 'headerName'),
      queryParamName: pickString(authSource, 'queryParamName'),
    },
    extraHeaders,
    tags: tags && tags.length > 0 ? tags : undefined,
    imageModel: pickString(source, 'imageModel'),
    note: pickString(source, 'note'),
  };

  return { draft, apiKey: pickString(source, 'apiKey') };
}

/** 支持顶层数组或 `{ providers: [...] }` 两种结构。 */
export function parseProviderImport(text: string): ProviderImportItem[] {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new Error(`JSON 解析失败：${(err as Error).message}`);
  }
  const list = Array.isArray(json)
    ? json
    : typeof json === 'object' && json !== null && Array.isArray((json as { providers?: unknown }).providers)
      ? ((json as { providers: unknown[] }).providers)
      : null;
  if (!list) throw new Error('结构不正确：应为数组或 { "providers": [...] }');
  if (list.length === 0) throw new Error('文件中没有任何 Provider');
  return list.map((item, i) => normalizeImportedProvider(item, `第 ${i + 1} 条`));
}

export interface ProviderImportDialogProps {
  open: boolean;
  onClose(): void;
  onImport(items: ProviderImportItem[]): Promise<number>;
}

/** 从 JSON 文件 / 粘贴文本批量导入 Provider。 */
const ProviderImportDialog: React.FC<ProviderImportDialogProps> = ({ open, onClose, onImport }) => {
  const [text, setText] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [parsed, setParsed] = useState<ProviderImportItem[]>([]);
  const [busy, setBusy] = useState<boolean>(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const handleParse = (value: string): void => {
    setText(value);
    if (value.trim().length === 0) {
      setParsed([]);
      setError('');
      return;
    }
    try {
      setParsed(parseProviderImport(value));
      setError('');
    } catch (err) {
      setParsed([]);
      setError((err as Error).message);
    }
  };

  const handleFile = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    const content = await file.text();
    handleParse(content);
  };

  const handleImport = async (): Promise<void> => {
    if (parsed.length === 0) return;
    setBusy(true);
    try {
      await onImport(parsed);
      setText('');
      setParsed([]);
      setError('');
      onClose();
    } catch (err) {
      setError(`导入失败：${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle>批量导入 Provider</DialogTitle>
      <DialogContent dividers className="flex flex-col gap-3">
        <Alert severity="info" variant="outlined">
          <AlertTitle>格式说明</AlertTitle>
          顶层为数组或 <code>{'{ "providers": [...] }'}</code>；每条至少包含 <code>name</code>、
          <code>endpoint</code>、<code>model</code>。<code>apiKey</code> 为可选字段，导入后会立即加密落盘，
          <strong>不会保留在这段文本之外的任何地方</strong>。
        </Alert>

        <Box className="flex items-center gap-2">
          <Button
            variant="outlined"
            startIcon={<UploadFileOutlinedIcon />}
            onClick={() => fileRef.current?.click()}
            disabled={busy}
          >
            选择 JSON 文件
          </Button>
          <Button size="small" onClick={() => handleParse(TEMPLATE)} disabled={busy}>
            填充示例模板
          </Button>
          {parsed.length > 0 ? (
            <Chip color="success" label={`已解析 ${parsed.length} 条`} variant="outlined" />
          ) : null}
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              void handleFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </Box>

        <TextField
          label="JSON 内容"
          value={text}
          onChange={(e) => handleParse(e.target.value)}
          multiline
          minRows={10}
          spellCheck={false}
          InputProps={{ sx: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 12 } }}
        />

        {error ? <Alert severity="error">{error}</Alert> : null}

        {parsed.length > 0 ? (
          <Box className="flex flex-wrap gap-1">
            {parsed.map((item, i) => (
              <Chip
                key={`${item.draft.name}-${i}`}
                label={`${item.draft.name} · ${item.draft.model}${item.apiKey ? ' · 含密钥' : ''}`}
                variant="outlined"
              />
            ))}
          </Box>
        ) : (
          <Typography variant="caption" color="text.secondary">
            解析成功后这里会列出即将导入的条目。
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          取消
        </Button>
        <Button
          variant="contained"
          onClick={() => void handleImport()}
          disabled={busy || parsed.length === 0}
        >
          导入 {parsed.length > 0 ? `(${parsed.length})` : ''}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ProviderImportDialog;
