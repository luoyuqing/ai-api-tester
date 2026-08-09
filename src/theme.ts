import { createTheme, type Theme } from '@mui/material/styles';
import { zhCN } from '@mui/material/locale';

/** Unified status palette — architecture §7.9. Never hardcode these elsewhere. */
export const STATUS_COLORS = {
  success: '#16a34a',
  warning: '#d97706',
  danger: '#dc2626',
  unknown: '#64748b',
} as const;

/** Score badge palette — ≥85 green / 70-84 blue / 50-69 orange / <50 red / N/A grey. */
export const SCORE_COLORS = {
  excellent: '#16a34a',
  good: '#2563eb',
  fair: '#d97706',
  poor: '#dc2626',
  na: '#94a3b8',
} as const;

/** Stable series palette used by every chart so a model keeps its colour across views. */
export const SERIES_COLORS: readonly string[] = [
  '#1e40af',
  '#0891b2',
  '#7c3aed',
  '#db2777',
  '#ea580c',
  '#059669',
];

const FONT_STACK = [
  '-apple-system',
  'BlinkMacSystemFont',
  '"Segoe UI"',
  'Roboto',
  '"PingFang SC"',
  '"Hiragino Sans GB"',
  '"Microsoft YaHei"',
  '"Helvetica Neue"',
  'Arial',
  'sans-serif',
].join(',');

/**
 * Enterprise-blue MUI theme with a compact density suited to dense data screens.
 */
export const theme: Theme = createTheme(
  {
    palette: {
      mode: 'light',
      primary: {
        main: '#1e40af',
        light: '#3b82f6',
        dark: '#1e3a8a',
        contrastText: '#ffffff',
      },
      secondary: {
        main: '#0891b2',
        contrastText: '#ffffff',
      },
      success: { main: STATUS_COLORS.success },
      warning: { main: STATUS_COLORS.warning },
      error: { main: STATUS_COLORS.danger },
      info: { main: '#2563eb' },
      background: {
        default: '#f1f5f9',
        paper: '#ffffff',
      },
      text: {
        primary: '#0f172a',
        secondary: '#475569',
      },
      divider: '#e2e8f0',
    },
    typography: {
      fontFamily: FONT_STACK,
      fontSize: 13,
      h1: { fontSize: '1.75rem', fontWeight: 600 },
      h2: { fontSize: '1.5rem', fontWeight: 600 },
      h3: { fontSize: '1.25rem', fontWeight: 600 },
      h4: { fontSize: '1.125rem', fontWeight: 600 },
      h5: { fontSize: '1rem', fontWeight: 600 },
      h6: { fontSize: '0.9375rem', fontWeight: 600 },
      button: { textTransform: 'none', fontWeight: 500 },
    },
    shape: {
      borderRadius: 8,
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            backgroundColor: '#f1f5f9',
          },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: { borderRadius: 6 },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: { backgroundImage: 'none' },
        },
      },
      MuiCard: {
        defaultProps: { variant: 'outlined' },
        styleOverrides: {
          root: { borderColor: '#e2e8f0' },
        },
      },
      MuiTextField: {
        defaultProps: { size: 'small', fullWidth: true },
      },
      MuiSelect: {
        defaultProps: { size: 'small' },
      },
      MuiChip: {
        defaultProps: { size: 'small' },
      },
      MuiTable: {
        defaultProps: { size: 'small' },
      },
      MuiTooltip: {
        defaultProps: { arrow: true },
      },
      MuiAlert: {
        styleOverrides: {
          root: { borderRadius: 6 },
        },
      },
    },
  },
  zhCN,
);

export default theme;
