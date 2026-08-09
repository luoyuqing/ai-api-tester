import React, { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import Typography from '@mui/material/Typography';
import SecurityOutlinedIcon from '@mui/icons-material/SecurityOutlined';

export interface SafetyNoticeDialogProps {
  open: boolean;
  onAccept(): void;
  onDecline(): void;
}

const CLAUSES: readonly string[] = [
  '本维度仅用于评估模型自身的安全防护能力（外审机制、限制词处理、越狱抵抗），不用于获取、生成或传播任何违规内容。',
  '内置测试样本全部为占位符模板，不含真实违禁内容；若需导入本地词表，词表只驻留内存、不写入磁盘，刷新页面即失效。',
  '评测结果仅供内部风控与选型参考，不构成对任何模型合规性的第三方认证结论，也不应对外发布为安全性背书。',
  '使用者须自行确认已获得所在机构的授权，并遵守适用的法律法规与服务商的使用条款。',
  '禁止将测试样本、提示词或评测过程中产生的模型输出用于任何实际越权、绕过审核或其他非授权用途。',
];

/**
 * 破限/安全维度的合规确认弹窗。
 *
 * 勾选状态每次重新打开都会归零 —— 合规确认必须是一次显式的当次动作，
 * 不能因为上次点过就默认沿用。
 */
const SafetyNoticeDialog: React.FC<SafetyNoticeDialogProps> = ({ open, onAccept, onDecline }) => {
  const [agreed, setAgreed] = useState<boolean>(false);

  useEffect(() => {
    if (open) setAgreed(false);
  }, [open]);

  return (
    <Dialog open={open} onClose={onDecline} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Box className="flex items-center gap-2">
          <SecurityOutlinedIcon color="warning" />
          <span>破限维度合规声明</span>
        </Box>
      </DialogTitle>

      <DialogContent dividers>
        <Alert severity="warning" variant="outlined" className="mb-3">
          <AlertTitle>请先阅读并确认</AlertTitle>
          你已勾选「破限/合规」维度，启动前需要完成一次合规确认。
        </Alert>

        <Box component="ol" className="m-0 flex list-decimal flex-col gap-2 pl-5">
          {CLAUSES.map((clause) => (
            <Typography key={clause} component="li" variant="body2">
              {clause}
            </Typography>
          ))}
        </Box>

        <Divider className="my-3" />

        <FormControlLabel
          control={<Checkbox checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />}
          label="我已阅读并同意上述声明，并确认在授权范围内开展破限评测"
        />
      </DialogContent>

      <DialogActions>
        <Button onClick={onDecline}>取消</Button>
        <Button variant="contained" color="warning" disabled={!agreed} onClick={onAccept}>
          同意并继续
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default SafetyNoticeDialog;
