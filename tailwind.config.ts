import type { Config } from 'tailwindcss';

/**
 * Tailwind is used for layout + spacing only (flex/grid/gap/p-*).
 * MUI owns component styling & theming.
 *
 * Coexistence rules (see architecture §7.9):
 *  - `preflight: false` so MUI's CssBaseline stays authoritative
 *  - `important: '#root'` so utility classes win over emotion's injected styles
 *    ONLY inside the app root, never leaking to MUI portals rendered in <body>.
 */
const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  important: '#root',
  corePlugins: {
    preflight: false,
  },
  theme: {
    extend: {
      colors: {
        // Unified status palette (architecture §7.9)
        status: {
          success: '#16a34a',
          warning: '#d79c07',
          danger: '#dc2626',
          unknown: '#64748b',
        },
        brand: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#1e40af',
          600: '#1d4ed8',
          700: '#1e3a8a',
        },
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
