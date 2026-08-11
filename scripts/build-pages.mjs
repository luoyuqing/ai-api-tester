// 跨平台本地 Pages 构建包装器（Windows / Linux 均可）。
// 设置 VITE_BASE=/ 让产物以根路径托管，并标记 CF_PAGES 以与 Cloudflare 环境一致。
import { execSync } from 'node:child_process';

const env = {
  ...process.env,
  VITE_BASE: process.env.VITE_BASE || '/',
  CF_PAGES: process.env.CF_PAGES || 'true',
};

execSync('vite build', { stdio: 'inherit', env });
