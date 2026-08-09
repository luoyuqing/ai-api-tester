import React from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import KeyOutlinedIcon from '@mui/icons-material/KeyOutlined';
import KeyOffOutlinedIcon from '@mui/icons-material/KeyOffOutlined';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import type { ConnectivityResult, Provider, ProviderType } from '@/types';
import { formatDuration } from '@/lib/timer';

const TYPE_LABELS: Record<ProviderType, string> = {
  chat: '对话',
  image: '生图',
  multimodal: '多模态',
  agent: 'Agent',
};

export interface ProviderCardProps {
  provider: Provider;
  /** 最近一次连通性测试结果。 */
  connectivity?: ConnectivityResult;
  /** 本地密钥库里是否已有该 Provider 的密钥。 */
  hasSecret: boolean;
  selected?: boolean;
  testing?: boolean;
  onSelect?(id: string): void;
  onEdit(provider: Provider): void;
  onDelete(provider: Provider): void;
  onTest(provider: Provider): void;
}

/** 单个 Provider 的信息卡：关键连接参数 + 连通性状态 + 操作入口。 */
const ProviderCard: React.FC<ProviderCardProps> = ({
  provider,
  connectivity,
  hasSecret,
  selected = false,
  testing = false,
  onSelect,
  onEdit,
  onDelete,
  onTest,
}) => (
  <Card
    onClick={() => onSelect?.(provider.id)}
    sx={{
      borderColor: selected ? 'primary.main' : 'divider',
      borderWidth: selected ? 2 : 1,
      cursor: onSelect ? 'pointer' : 'default',
      transition: 'border-color 120ms ease',
    }}
  >
    <CardContent className="flex flex-col gap-2">
      <Box className="flex items-start gap-2">
        <Box className="min-w-0 flex-1">
          <Typography variant="h6" noWrap title={provider.name}>
            {provider.name}
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap title={provider.model}>
            {provider.model}
            {provider.imageModel ? ` · 生图模型 ${provider.imageModel}` : ''}
          </Typography>
        </Box>
        <Chip label={TYPE_LABELS[provider.type]} color="primary" variant="outlined" />
      </Box>

      <Typography
        variant="caption"
        color="text.secondary"
        className="break-all font-mono"
        title={provider.endpoint}
      >
        {provider.endpoint}
      </Typography>

      <Box className="flex flex-wrap items-center gap-1">
        <Chip label={provider.transport === 'proxy' ? '代理转发' : '浏览器直连'} variant="outlined" />
        <Chip label={provider.supportsStream ? '支持流式' : '非流式'} variant="outlined" />
        <Chip label={`超时 ${formatDuration(provider.timeoutMs)}`} variant="outlined" />
        <Chip
          icon={hasSecret ? <KeyOutlinedIcon /> : <KeyOffOutlinedIcon />}
          label={hasSecret ? '已存密钥' : '未存密钥'}
          color={hasSecret ? 'success' : 'default'}
          variant="outlined"
        />
        {(provider.tags ?? []).map((tag) => (
          <Chip key={tag} label={tag} />
        ))}
      </Box>

      {provider.note ? (
        <Typography variant="caption" color="text.secondary">
          {provider.note}
        </Typography>
      ) : null}

      {connectivity ? (
        <Box
          className="flex items-start gap-1 rounded px-2 py-1"
          sx={{ bgcolor: connectivity.ok ? '#f0fdf4' : '#fef2f2' }}
        >
          {connectivity.ok ? (
            <CheckCircleOutlineIcon fontSize="small" color="success" />
          ) : (
            <ErrorOutlineIcon fontSize="small" color="error" />
          )}
          <Typography variant="caption" color={connectivity.ok ? 'success.main' : 'error.main'}>
            {connectivity.ok ? `连通正常 · ${formatDuration(connectivity.latencyMs)}` : connectivity.message}
          </Typography>
        </Box>
      ) : null}

      <Divider />

      <Box className="flex items-center gap-1">
        <Button
          size="small"
          variant="outlined"
          disabled={testing}
          startIcon={testing ? <CircularProgress size={12} /> : undefined}
          onClick={(e) => {
            e.stopPropagation();
            onTest(provider);
          }}
        >
          {testing ? '测试中' : '连通性测试'}
        </Button>
        <Box className="flex-1" />
        <Tooltip title="编辑">
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              onEdit(provider);
            }}
          >
            <EditOutlinedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="删除">
          <IconButton
            size="small"
            color="error"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(provider);
            }}
          >
            <DeleteOutlineIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
    </CardContent>
  </Card>
);

export default ProviderCard;
