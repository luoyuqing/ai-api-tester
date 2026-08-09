import React, { useState } from 'react';
import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import DialogContentText from '@mui/material/DialogContentText';
import TextField from '@mui/material/TextField';
import MenuOpenIcon from '@mui/icons-material/MenuOpen';
import MenuIcon from '@mui/icons-material/Menu';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import LockOpenOutlinedIcon from '@mui/icons-material/LockOpenOutlined';
import ScienceOutlinedIcon from '@mui/icons-material/ScienceOutlined';
import { useUiStore } from '@/store/uiStore';

/**
 * Top bar: brand, side-nav toggle, vault unlock entry.
 * The passphrase never leaves memory — it is only used to derive the AES key.
 */
const TopBar: React.FC = () => {
  const sideNavCollapsed = useUiStore((s) => s.sideNavCollapsed);
  const toggleSideNav = useUiStore((s) => s.toggleSideNav);
  const vaultUnlocked = useUiStore((s) => s.vaultUnlocked);
  const unlockVault = useUiStore((s) => s.unlockVault);
  const lockVault = useUiStore((s) => s.lockVault);
  const showSnackbar = useUiStore((s) => s.showSnackbar);

  const [dialogOpen, setDialogOpen] = useState<boolean>(false);
  const [passphrase, setPassphrase] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(false);

  const handleUnlock = async (): Promise<void> => {
    if (passphrase.length < 6) {
      showSnackbar('口令至少 6 位', 'warning');
      return;
    }
    setBusy(true);
    try {
      await unlockVault(passphrase);
      showSnackbar('密钥库已解锁', 'success');
      setDialogOpen(false);
      setPassphrase('');
    } catch (err) {
      showSnackbar(`解锁失败：${(err as Error).message}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleLock = (): void => {
    lockVault();
    showSnackbar('密钥库已锁定', 'info');
  };

  return (
    <>
      <AppBar
        position="fixed"
        color="inherit"
        elevation={0}
        sx={{
          zIndex: (t) => t.zIndex.drawer + 1,
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Toolbar variant="dense" className="gap-2">
          <IconButton size="small" edge="start" onClick={toggleSideNav} aria-label="切换侧栏">
            {sideNavCollapsed ? <MenuIcon fontSize="small" /> : <MenuOpenIcon fontSize="small" />}
          </IconButton>

          <ScienceOutlinedIcon fontSize="small" color="primary" />
          <Typography variant="h6" noWrap className="mr-2">
            AI API 质量评测平台
          </Typography>

          <Chip
            label="本地运行 · 数据不出网"
            size="small"
            color="success"
            variant="outlined"
            sx={{ fontWeight: 500 }}
          />

          <Box className="flex-1" />

          <Tooltip
            title={
              vaultUnlocked
                ? '密钥库已解锁：API Key 使用会话口令派生密钥加密'
                : '未解锁：将使用设备随机密钥（安全等级：弱）'
            }
          >
            <Chip
              icon={vaultUnlocked ? <LockOpenOutlinedIcon /> : <LockOutlinedIcon />}
              label={vaultUnlocked ? '密钥库已解锁' : '密钥库未解锁'}
              color={vaultUnlocked ? 'success' : 'default'}
              variant={vaultUnlocked ? 'filled' : 'outlined'}
              size="small"
            />
          </Tooltip>

          {vaultUnlocked ? (
            <Button size="small" variant="text" onClick={handleLock}>
              锁定
            </Button>
          ) : (
            <Button size="small" variant="outlined" onClick={() => setDialogOpen(true)}>
              解锁
            </Button>
          )}
        </Toolbar>
      </AppBar>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>解锁密钥库</DialogTitle>
        <DialogContent className="flex flex-col gap-3">
          <DialogContentText variant="body2">
            口令用于 PBKDF2-SHA256(200k 迭代) 派生 AES-GCM-256 密钥，仅存在于当前标签页内存中，
            不会被持久化。忘记口令将无法解密已保存的 API Key（需重新录入）。
          </DialogContentText>
          <TextField
            autoFocus
            type="password"
            label="会话口令"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleUnlock();
            }}
            helperText="至少 6 位"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>取消</Button>
          <Button variant="contained" disabled={busy} onClick={() => void handleUnlock()}>
            解锁
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default TopBar;
