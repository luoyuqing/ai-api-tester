import React from 'react';
import { Outlet } from 'react-router-dom';
import Box from '@mui/material/Box';
import Toolbar from '@mui/material/Toolbar';
import SideNav from '@/components/layout/SideNav';
import TopBar from '@/components/layout/TopBar';
import { useUiStore } from '@/store/uiStore';

export const SIDENAV_WIDTH = 216;
export const SIDENAV_WIDTH_COLLAPSED = 60;

/**
 * Application shell: fixed top bar + collapsible side navigation + scrollable
 * content area rendered through react-router's <Outlet />.
 */
const AppLayout: React.FC = () => {
  const sideNavCollapsed = useUiStore((s) => s.sideNavCollapsed);
  const width = sideNavCollapsed ? SIDENAV_WIDTH_COLLAPSED : SIDENAV_WIDTH;

  return (
    <Box className="flex h-full w-full" sx={{ bgcolor: 'background.default' }}>
      <TopBar />
      <SideNav width={width} collapsed={sideNavCollapsed} />
      <Box
        component="main"
        className="flex min-w-0 flex-1 flex-col"
        sx={{ transition: 'margin 180ms ease' }}
      >
        <Toolbar variant="dense" />
        <Box className="min-h-0 flex-1 overflow-auto p-4">
          <Outlet />
        </Box>
      </Box>
    </Box>
  );
};

export default AppLayout;
