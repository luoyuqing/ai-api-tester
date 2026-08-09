import React, { Suspense, lazy } from 'react';
import { createHashRouter, Navigate, type RouteObject } from 'react-router-dom';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import AppLayout from '@/components/layout/AppLayout';

// Lazy-loaded pages keep the initial bundle small.
const HomePage = lazy(() => import('@/pages/HomePage'));
const ConfigCenterPage = lazy(() => import('@/pages/ConfigCenterPage'));
const TestExecutionPage = lazy(() => import('@/pages/TestExecutionPage'));
const DashboardPage = lazy(() => import('@/pages/DashboardPage'));
const HistoryPage = lazy(() => import('@/pages/HistoryPage'));

const PageFallback: React.FC = () => (
  <Box className="flex h-full min-h-[320px] w-full items-center justify-center">
    <CircularProgress size={28} />
  </Box>
);

const NotFound: React.FC = () => (
  <Box className="flex h-full min-h-[320px] flex-col items-center justify-center gap-3">
    <Typography variant="h2">404</Typography>
    <Typography variant="body2" color="text.secondary">
      页面不存在
    </Typography>
    <Button variant="outlined" href="#/">
      返回首页
    </Button>
  </Box>
);

const withSuspense = (node: React.ReactNode): React.ReactElement => (
  <Suspense fallback={<PageFallback />}>{node}</Suspense>
);

/**
 * Hash routing is used on purpose: the built SPA must also work when served
 * from a plain file server / file:// without rewrite rules.
 */
export const routes: RouteObject[] = [
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: withSuspense(<HomePage />) },
      { path: 'config', element: withSuspense(<ConfigCenterPage />) },
      { path: 'run', element: withSuspense(<TestExecutionPage />) },
      { path: 'dashboard', element: withSuspense(<DashboardPage />) },
      { path: 'history', element: withSuspense(<HistoryPage />) },
      { path: 'index.html', element: <Navigate to="/" replace /> },
      { path: '*', element: <NotFound /> },
    ],
  },
];

export const router = createHashRouter(routes);

export default router;
