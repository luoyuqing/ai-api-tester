import React from 'react';
import { RouterProvider } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import theme from '@/theme';
import { router } from '@/router';
import { useUiStore } from '@/store/uiStore';

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Application-level error boundary. Keeps a crashed page from blanking the
 * whole SPA and offers a one-click recovery.
 */
class AppErrorBoundary extends React.Component<React.PropsWithChildren, ErrorBoundaryState> {
  public state: ErrorBoundaryState = { error: null };

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  public componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('[aiat] Unhandled UI error:', error, info.componentStack);
  }

  private handleReset = (): void => {
    this.setState({ error: null });
    window.location.reload();
  };

  public render(): React.ReactNode {
    const { error } = this.state;
    if (error) {
      return (
        <Box className="flex h-full flex-col items-center justify-center gap-4 p-8">
          <Typography variant="h3" color="error">
            页面渲染出错
          </Typography>
          <Typography variant="body2" color="text.secondary" className="max-w-xl text-center">
            {error.message || '未知错误'}
          </Typography>
          <Button variant="contained" onClick={this.handleReset}>
            重新加载
          </Button>
        </Box>
      );
    }
    return this.props.children;
  }
}

/** Global snackbar bound to uiStore. */
const GlobalSnackbar: React.FC = () => {
  const snackbar = useUiStore((s) => s.snackbar);
  const closeSnackbar = useUiStore((s) => s.closeSnackbar);

  return (
    <Snackbar
      open={snackbar.open}
      autoHideDuration={snackbar.duration}
      onClose={closeSnackbar}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
    >
      <Alert onClose={closeSnackbar} severity={snackbar.severity} variant="filled" sx={{ width: '100%' }}>
        {snackbar.message}
      </Alert>
    </Snackbar>
  );
};

const App: React.FC = () => (
  <ThemeProvider theme={theme}>
    <CssBaseline />
    <AppErrorBoundary>
      <RouterProvider router={router} />
      <GlobalSnackbar />
    </AppErrorBoundary>
  </ThemeProvider>
);

export default App;
