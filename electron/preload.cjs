'use strict';

/**
 * Electron 预加载脚本：在隔离上下文中向渲染进程暴露最小受控 API。
 * 渲染层通过 window.electronAPI 判断是否为桌面环境，并调用保存/打开报告等能力。
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isDesktop: true,
  platform: process.platform,
  /** 保存 HTML 报告到用户选择路径，返回实际路径或 null（取消）。 */
  saveReport: (html, defaultName) => ipcRenderer.invoke('report:save', html, defaultName),
  /** 使用系统默认程序打开文件/路径。 */
  openPath: (p) => ipcRenderer.invoke('shell:openPath', p),
  /** 取系统路径（如 'downloads' / 'userData'）。 */
  getPath: (name) => ipcRenderer.invoke('app:getPath', name),
});
