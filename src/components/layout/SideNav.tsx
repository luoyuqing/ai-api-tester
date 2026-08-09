import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import Drawer from '@mui/material/Drawer';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Toolbar from '@mui/material/Toolbar';
import Tooltip from '@mui/material/Tooltip';
import Divider from '@mui/material/Divider';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import DashboardOutlinedIcon from '@mui/icons-material/DashboardOutlined';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutline';
import InsightsOutlinedIcon from '@mui/icons-material/InsightsOutlined';
import HistoryOutlinedIcon from '@mui/icons-material/HistoryOutlined';
import { ENGINE_VERSION } from '@/constants/defaults';

interface NavItem {
  path: string;
  label: string;
  icon: React.ReactElement;
  end?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { path: '/', label: '首页', icon: <DashboardOutlinedIcon fontSize="small" />, end: true },
  { path: '/config', label: '配置中心', icon: <SettingsOutlinedIcon fontSize="small" /> },
  { path: '/run', label: '测试执行', icon: <PlayCircleOutlineIcon fontSize="small" /> },
  { path: '/dashboard', label: '结果看板', icon: <InsightsOutlinedIcon fontSize="small" /> },
  { path: '/history', label: '历史记录', icon: <HistoryOutlinedIcon fontSize="small" /> },
];

export interface SideNavProps {
  width: number;
  collapsed: boolean;
}

const isItemActive = (pathname: string, item: NavItem): boolean =>
  item.end ? pathname === item.path : pathname.startsWith(item.path);

const SideNav: React.FC<SideNavProps> = ({ width, collapsed }) => {
  const location = useLocation();

  return (
    <Drawer
      variant="permanent"
      sx={{
        width,
        flexShrink: 0,
        '& .MuiDrawer-paper': {
          width,
          boxSizing: 'border-box',
          borderRight: '1px solid',
          borderColor: 'divider',
          overflowX: 'hidden',
          transition: 'width 180ms ease',
        },
      }}
    >
      <Toolbar variant="dense" />
      <Divider />
      <List dense disablePadding className="pt-2">
        {NAV_ITEMS.map((item) => {
          const active = isItemActive(location.pathname, item);
          const button = (
            <ListItemButton
              key={item.path}
              component={NavLink}
              to={item.path}
              selected={active}
              sx={{
                mx: 1,
                my: 0.25,
                borderRadius: 1.5,
                minHeight: 40,
                justifyContent: collapsed ? 'center' : 'flex-start',
                '&.Mui-selected': {
                  bgcolor: 'primary.main',
                  color: 'primary.contrastText',
                  '& .MuiListItemIcon-root': { color: 'primary.contrastText' },
                  '&:hover': { bgcolor: 'primary.dark' },
                },
              }}
            >
              <ListItemIcon sx={{ minWidth: collapsed ? 0 : 34, justifyContent: 'center' }}>
                {item.icon}
              </ListItemIcon>
              {!collapsed && (
                <ListItemText
                  primary={item.label}
                  primaryTypographyProps={{ fontSize: 13.5, fontWeight: active ? 600 : 400 }}
                />
              )}
            </ListItemButton>
          );

          return collapsed ? (
            <Tooltip key={item.path} title={item.label} placement="right">
              <span>{button}</span>
            </Tooltip>
          ) : (
            button
          );
        })}
      </List>

      <Box className="mt-auto p-3">
        {!collapsed && (
          <Typography variant="caption" color="text.secondary" className="block leading-5">
            引擎版本 v{ENGINE_VERSION}
            <br />
            数据仅存本机 · 内网评测台
          </Typography>
        )}
      </Box>
    </Drawer>
  );
};

export default SideNav;
