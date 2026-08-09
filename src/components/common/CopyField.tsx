import React, { useState } from 'react';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import VisibilityOffOutlinedIcon from '@mui/icons-material/VisibilityOffOutlined';
import { useUiStore } from '@/store/uiStore';

export interface CopyFieldProps {
  value: string;
  label?: string;
  /** 敏感值默认打码，提供「显示/隐藏」切换。 */
  secret?: boolean;
  helperText?: string;
  /** 多行展示（如 JSON 片段）。 */
  multiline?: boolean;
  rows?: number;
}

/** 复制到剪贴板，降级到 execCommand 以兼容非安全上下文。 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 继续走降级路径 */
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

/** 只读展示 + 一键复制的字段，用于 Endpoint / ID / 密钥引用等。 */
const CopyField: React.FC<CopyFieldProps> = ({
  value,
  label,
  secret = false,
  helperText,
  multiline = false,
  rows = 3,
}) => {
  const showSnackbar = useUiStore((s) => s.showSnackbar);
  const [revealed, setRevealed] = useState<boolean>(false);

  const masked = secret && !revealed;
  const display = masked ? '•'.repeat(Math.min(Math.max(value.length, 8), 24)) : value;

  const handleCopy = async (): Promise<void> => {
    const ok = await copyToClipboard(value);
    showSnackbar(ok ? '已复制到剪贴板' : '复制失败，请手动选择文本', ok ? 'success' : 'warning');
  };

  return (
    <TextField
      label={label}
      value={display}
      helperText={helperText}
      multiline={multiline}
      minRows={multiline ? rows : undefined}
      InputProps={{
        readOnly: true,
        endAdornment: (
          <InputAdornment position="end">
            <Box className="flex items-center">
              {secret ? (
                <Tooltip title={revealed ? '隐藏' : '显示'}>
                  <IconButton size="small" onClick={() => setRevealed((v) => !v)}>
                    {revealed ? (
                      <VisibilityOffOutlinedIcon fontSize="small" />
                    ) : (
                      <VisibilityOutlinedIcon fontSize="small" />
                    )}
                  </IconButton>
                </Tooltip>
              ) : null}
              <Tooltip title="复制">
                <IconButton size="small" onClick={() => void handleCopy()}>
                  <ContentCopyOutlinedIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>
          </InputAdornment>
        ),
      }}
    />
  );
};

export default CopyField;
