import { defineConfig, type UserConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

/**
 * Vite configuration.
 * - `@/*` alias maps to `src/*`
 * - base 按运行模式区分：
 *    · dev / preview → '/'（本机 `npm run dev` 直接开 http://localhost:5173/ 即可）
 *    · build        → '/tester/'（部署到服务器一 nginx 的 /tester/ 子路径）
 *   这样同一份代码在本机和服务器子路径都能无错运行。
 * - manual chunks keep the ECharts / MUI vendors out of the main entry
 *
 * manualChunks 只能列出真实安装的包：Rollup 解析不到的包名会直接让构建失败，
 * 所以这里必须与 package.json 的 dependencies 保持同步。
 */
const config: UserConfig = {
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: false,
    open: false,
  },
  preview: {
    port: 4173,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-mui': ['@mui/material', '@mui/icons-material'],
          'vendor-echarts': ['echarts'],
        },
      },
    },
  },
};

export default defineConfig(({ command }) => ({
  ...config,
  // base 可由环境变量覆盖：
  //   - 服务器子路径部署 → /tester/（默认 build 行为）
  //   - 桌面 Electron 构建 → ./ （跟随电子包内本地静态服务器根路径）
  base: process.env.VITE_BASE ?? (command === 'build' ? '/tester/' : '/'),
}));
