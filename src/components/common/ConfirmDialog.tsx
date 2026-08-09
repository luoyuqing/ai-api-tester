import React from 'react';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** 正文，字符串会被包在 DialogContentText 中。 */
  content?: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  /** 危险操作使用红色主按钮。 */
  danger?: boolean;
  busy?: boolean;
  onConfirm(): void;
  onCancel(): void;
}

/** 通用二次确认弹窗（删除、清空等破坏性操作统一走这里）。 */
const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  content,
  confirmText = '确认',
  cancelText = '取消',
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}) => (
  <Dialog open={open} onClose={onCancel} maxWidth="xs" fullWidth>
    <DialogTitle>{title}</DialogTitle>
    <DialogContent>
      {typeof content === 'string' ? (
        <DialogContentText variant="body2">{content}</DialogContentText>
      ) : (
        content
      )}
    </DialogContent>
    <DialogActions>
      <Button onClick={onCancel} disabled={busy}>
        {cancelText}
      </Button>
      <Button
        variant="contained"
        color={danger ? 'error' : 'primary'}
        onClick={onConfirm}
        disabled={busy}
      >
        {confirmText}
      </Button>
    </DialogActions>
  </Dialog>
);

export default ConfirmDialog;
