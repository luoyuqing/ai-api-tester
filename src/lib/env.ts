/**
 * 运行环境探测：区分「桌面 Electron」与「纯前端 Web」。
 * 桌面环境下渲染层据此隐藏 proxy UI、强制 direct 传输、并调用主进程保存报告。
 */

export interface ElectronAPI {
  isDesktop: boolean;
  platform: string;
  /** 保存 HTML 报告到用户选择路径，返回实际路径或 null（取消）。 */
  saveReport(html: string, defaultName: string): Promise<string | null>;
  /** 使用系统默认程序打开文件/路径。 */
  openPath(p: string): Promise<boolean>;
  /** 取系统路径（如 'downloads' / 'userData'）。 */
  getPath(name: string): Promise<string>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export const IS_DESKTOP: boolean =
  typeof window !== 'undefined' && Boolean(window.electronAPI?.isDesktop);

export const PLATFORM: string =
  typeof window !== 'undefined' && window.electronAPI ? window.electronAPI.platform : 'web';
