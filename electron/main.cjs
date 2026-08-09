'use strict';

/**
 * AI API 质量评测 · Electron 主进程
 *
 * 设计要点：
 *  - 用 Node http 把构建产物 dist/ 提供在 127.0.0.1:随机端口，
 *    让渲染进程的 localStorage / IndexedDB 处于正常 http 源（file:// 下 IndexedDB 会被禁）。
 *  - BrowserWindow 设 webSecurity:false，渲染进程即可直连任意外部 API，
 *    不再受浏览器 CORS 约束，因此此前那套 proxy 转发 + nginx 反代可以彻底移除。
 *  - 程序的"主进程"本身完成 HTTP 请求，从根本上解决了纯前端场景下浏览器 CORS 的问题。
 */

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, '..', 'dist');

/**
 * 稳定性优先：默认关闭硬件加速。
 * 本程序只有表单与图表，软件渲染足够；而虚拟机、远程桌面、老旧集显、
 * 受限沙箱等环境下 GPU 进程常直接崩溃（"GPU process isn't usable"），
 * 会让程序在部分电脑上完全打不开。需要硬件加速时用 --enable-gpu 启动。
 */
const wantGpu = process.argv.includes('--enable-gpu');
if (!wantGpu) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-compositing');
  app.commandLine.appendSwitch('disable-software-rasterizer');
  app.commandLine.appendSwitch('in-process-gpu');
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

/** 极简静态服务器，仅服务本应用产物，不暴露任何外部路由。 */
function createStaticServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
        if (urlPath === '/') urlPath = '/index.html';
        const filePath = path.normalize(path.join(distDir, urlPath));
        // 防目录穿越：解析后必须仍位于 distDir 内。
        if (!filePath.startsWith(distDir)) {
          res.writeHead(403);
          res.end('Forbidden');
          return;
        }
        fs.readFile(filePath, (err, data) => {
          if (err) {
            // SPA 兜底：未知路径回退到 index.html（hash 路由无需服务端改写）。
            const fallback = path.join(distDir, 'index.html');
            fs.readFile(fallback, (e2, d2) => {
              if (e2) {
                res.writeHead(404);
                res.end('Not found');
              } else {
                res.writeHead(200, { 'Content-Type': MIME['.html'] });
                res.end(d2);
              }
            });
            return;
          }
          const ext = path.extname(filePath).toLowerCase();
          res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
          res.end(data);
        });
      } catch (e) {
        res.writeHead(500);
        res.end('Internal error');
      }
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function createWindow(port) {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'AI API 质量评测',
    backgroundColor: '#0b1020',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // 让渲染进程直连任意外部 API，绕过浏览器 CORS；本程序为本地单用户工具，可接受。
      webSecurity: false,
      sandbox: false,
    },
  });

  win.loadURL(`http://127.0.0.1:${port}/`);
  win.once('ready-to-show', () => win.show());

  if (process.env.ELECTRON_DEVTOOLS === '1') {
    win.webContents.openDevTools();
  }
  return win;
}

function registerIpc() {
  ipcMain.handle('report:save', async (_e, html, defaultName) => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: '保存评测报告',
      defaultPath: defaultName || 'ai-api-report.html',
      filters: [{ name: 'HTML 报告', extensions: ['html'] }],
    });
    if (canceled || !filePath) return null;
    fs.writeFileSync(filePath, html, 'utf-8');
    return filePath;
  });

  ipcMain.handle('shell:openPath', async (_e, p) => {
    try {
      await shell.openPath(p);
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('app:getPath', (_e, name) => app.getPath(name));
}

async function main() {
  if (!fs.existsSync(path.join(distDir, 'index.html'))) {
    console.error('[electron] 未找到 dist/index.html，请先运行构建（npm run build）');
    app.quit();
    return;
  }

  await app.whenReady();
  registerIpc();
  const server = await createStaticServer();
  const { port } = server.address();
  createWindow(port);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(port);
  });

  app.on('window-all-closed', () => {
    try {
      server.close();
    } catch {
      /* ignore */
    }
    if (process.platform !== 'darwin') app.quit();
  });
}

main().catch((err) => {
  console.error('[electron] 启动失败:', err);
  app.quit();
});
