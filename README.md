# AI API 质量评测平台（ai-api-tester）

[![Release](https://img.shields.io/github/v/release/luoyuqing/ai-api-tester?label=%E4%B8%8B%E8%BD%BD&color=blue)](https://github.com/luoyuqing/ai-api-tester/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/luoyuqing/ai-api-tester/total?label=%E4%B8%8B%E8%BD%BD%E9%87%8F)](https://github.com/luoyuqing/ai-api-tester/releases)
[![License](https://img.shields.io/badge/license-MIT-green)](#)

对任意 **OpenAI 兼容** 的 AI API 发起自动化评测，输出 **性能 / 功能 / 破限** 三大维度的可对比量化报告。

> **直接下载**：[AI-API-Tester-1.0.0-portable.exe](https://github.com/luoyuqing/ai-api-tester/releases/download/v1.0.0/AI-API-Tester-1.0.0-portable.exe)（93 MB，免安装，双击即跑）

一套代码，两种形态：

| 形态 | 产物 | 适用场景 |
|---|---|---|
| **桌面版**（推荐） | Windows `.exe`，免安装单文件 | 拷到任意电脑双击即跑。**无 CORS 限制**，可直连任何厂商 API |
| **Web 版** | 静态 `dist/`，Nginx 托管 | 团队共享访问。遇到不返回 CORS 头的厂商需外挂代理 sidecar |

所有评测数据与 API Key **仅存储在本地**（localStorage + IndexedDB / 桌面版本机目录），无任何服务端上报路径。

---

## 1. 快速开始

### 1.1 桌面版（Windows）

从 [Releases 页面](https://github.com/luoyuqing/ai-api-tester/releases/latest) 下载即用，或本地自行构建：

```bash
npm install
npm run dist:win        # 产物在 release/
```

产出两个 exe：

| 文件 | 说明 |
|---|---|
| `AI-API-Tester-<version>-portable.exe` | **推荐**。免安装单文件，不写注册表，可放 U 盘 |
| `AI-API-Tester-<version>-setup.exe` | NSIS 安装向导，可自选目录、建快捷方式 |

调试模式（不打包直接跑）：

```bash
npm run build:desktop   # vite build --base=./
npm run electron:dev
```

> 程序未做代码签名，首次运行 Windows SmartScreen 可能提示「未知发布者」，点 **更多信息 → 仍要运行** 即可。

### 1.2 Web 版

```bash
npm install
npm run dev             # http://localhost:5173
npm run build           # 产物在 dist/，base 默认 /tester/
npm run preview
```

`base` 可通过环境变量覆盖，便于部署到不同子路径：

```bash
VITE_BASE=/ npm run build          # 部署到域名根路径
VITE_BASE=/tester/ npm run build   # 部署到 /tester/ 子路径（默认）
```

---

## 2. 使用流程

1. **配置 Provider** —— 填厂商名、Base URL、API Key 三项即可。
2. **拉取模型** —— 点「连接并拉取模型」，程序调 `GET {BaseURL}/models` 自动填充模型下拉框；接口不支持时可退回手工输入。
3. **选择维度并执行** —— 勾选要跑的性能 / 功能 / 破限子项，实时查看进度与日志。
4. **查看与导出报告** —— 支持 **单文件自包含 HTML 报告**（内联 ECharts，离线可交互）、JSON、CSV。

---

## 3. 为什么桌面版不需要代理

这是本项目最容易踩坑的一点，值得说清楚。

Web 版部署在服务器上时，`fetch` 实际是从**用户的浏览器**发出的，不是从服务器发出的。因此：

- 服务器能不能直连目标 API **不影响结果**——那是两台机器之间的连接。
- 厂商若不返回 `Access-Control-Allow-Origin` 头，浏览器会直接拦截请求，报 `failed to fetch`。
- **CORS 是浏览器独占的安全机制**，只约束浏览器，不约束服务器间请求。

所以 Web 版才需要外挂一个 `proxy/server.mjs`（"补出来的后端"）去代取，再配 Nginx 反代到同源路径。

桌面版里，Electron 渲染进程运行在 `webSecurity: false` 的窗口中，请求不受 CORS 约束，**可直连任意厂商 API**。因此桌面版隐藏了传输方式选项并强制 `direct`，proxy 与 Nginx 反代那一整套都不再需要。

---

## 4. Web 版的 CORS 代理 sidecar

仅 Web 版需要。零依赖（Node 18+，无需 `npm install`）：

```bash
npm run proxy
# 等价于：node proxy/server.mjs --port 8787 --allow-origin http://localhost:5173
```

然后在「配置中心 → Provider」把该 Provider 的**传输方式**改为 `proxy`。业务代码零感知（架构上通过 `Transport` 接口隔离）。

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--port` | `8787` | 监听端口 |
| `--allow-origin` | `http://localhost:5173` | 允许的来源，逗号分隔，`*` 表示全部 |
| `--timeout` | `120000` | 上游请求超时（毫秒） |
| `--verbose` | `false` | 打印每条转发记录（Key 已脱敏） |

调用约定：向 `/proxy` 发请求，用 `x-target-url` 头指定真实目标地址；响应**流式原样透传**（SSE 不缓冲）。

生产部署时用 Nginx 把 sidecar 反代到与页面同源的路径，避免代理本身又产生跨域：

```nginx
location /tester-proxy/ {
    proxy_pass http://127.0.0.1:8787/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_buffering off;          # SSE 必须关闭缓冲
    proxy_read_timeout 600s;
}
```

代理地址可在应用内「配置中心」修改，默认取 `同源 + /tester-proxy`。

---

## 5. 评测维度

| 维度 | 子指标 | 探针 |
|------|--------|------|
| **性能** | TTFT / 总耗时 | `LatencyProbe` |
| | 错误率 / 超时率 | `StabilityProbe` |
| | 上下文窗口探测 | `ContextWindowProbe` |
| **功能** | 聊天连贯性 / 指令遵循 | `ChatQualityProbe` |
| | 生图可用性与相关性 | `ImageGenProbe` |
| | 多模态支持（图 / 音 / 视） | `MultimodalProbe` |
| | Agent 工具调用兼容性 | `AgentCompatProbe` |
| **破限** | 外审机制检测 | `ModerationProbe` |
| | 限制词处理行为 | `SensitiveWordProbe` |
| | 越狱抵抗率 | `JailbreakProbe` |

共 10 个探针，全部继承 `BaseProbe` 并实现 `run(ctx)`。

**N/A 铁律**：模型不具备某能力时该子指标 `score = null`，从权重分母中剔除并按比例放大其余权重，**绝不按 0 分计入**。"不具备该能力"与"该能力差"在报告中必须区分显示。

---

## 6. 目录结构

```
electron/
  main.cjs          Electron 主进程：本地静态服务器 + IPC（保存/打开报告）
  preload.cjs       contextBridge 暴露 window.electronAPI
src/
  types/            类型系统（全项目单一事实来源）
  constants/        错误码 / 维度权重 / 归一化阈值 / 默认值
  lib/              Transport、WebCrypto、Repository、SSE、计时、日志、导出、HTML 报告
  data/testsets/    8 个种子用例集（JSON）
  engine/           评测引擎（纯 TS，零 React 依赖，通过 RunEvent 与 UI 通信）
    adapters/       协议适配（OpenAI 兼容）
    probes/         10 个探针
    scorers/        规则判分 / LLM-as-judge / 行为分类
    aggregate/      归一化 + 维度聚合
  store/            Zustand 状态（provider / result / ui / settings）
  pages/            5 个页面
  components/       layout / provider / execution / dashboard / common
  hooks/            useProviders / useEvaluationRun / useComparison
proxy/server.mjs    零依赖 CORS 流式转发 sidecar（仅 Web 版需要）
scripts/            无 tsc 环境下的静态自检脚本
```

**调度模型**：Scheduler 采用「每 Provider 一条 lane，跨 Provider 并行、lane 内串行」——避免同一端点并发请求相互干扰 TTFT 测量。

---

## 7. 技术栈

Vite 5 · React 18 · TypeScript 5（strict）· MUI 5 · Tailwind 3 · Zustand 4 · ECharts 5 · React Router（hash 模式）· Electron 43 + electron-builder

---

## 8. 可用脚本

| 命令 | 说明 |
|---|---|
| `npm run dev` | Web 开发服务器 |
| `npm run build` | Web 生产构建（tsc 类型检查 + vite build） |
| `npm run preview` | 预览 Web 构建产物 |
| `npm run typecheck` | 仅类型检查 |
| `npm run check` | 静态自检（import 解析 / 具名导出 / 未声明依赖） |
| `npm run proxy` | 启动 CORS 代理 sidecar |
| `npm run build:desktop` | 桌面版前端构建（`--base=./`） |
| `npm run electron:dev` | 本地运行 Electron（需先执行上一步） |
| `npm run dist:win` | 构建并打包 Windows exe |

---

## 9. 安全与合规

1. 评测数据、API Key、结果明细**仅存储在本机**，不存在任何服务端上报路径。
2. API Key 采用 **PBKDF2-SHA256(200k) + AES-GCM-256** 加密落盘。未设置口令时降级为设备随机密钥，UI 明示安全等级为「弱」。日志系统内置 `sk-***` 脱敏正则。
3. **非安全上下文降级**：通过明文 HTTP 访问 Web 版时浏览器禁用 `crypto.subtle`，此时自动降级为兼容模式（口令 XOR 混淆 + 校验和），强度徽标如实显示为「弱」并弹出警告。HTTPS / localhost / 桌面版下仍走 AES-GCM 强加密。
4. **破限维度的内置用例集全部为占位符模板**（如 `{{SENSITIVE_TERM_A}}`），仓库与构建产物中**不含任何违规文本**。真实词表需用户在配置中心手动导入本地 JSON。
5. 勾选破限维度时会弹出合规确认对话框；破限类请求默认强制 `transport=direct`，不经过任何中间代理。

---

## 10. 可复现性

每份评测结果内嵌 `configSnapshot`（完整任务配置）、`engineVersion` 与各用例集 `version`。缺少任一项的结果视为不可用于合规审查。

---

## 11. 构建注意事项

在中国大陆网络环境下构建桌面版时，Electron 二进制默认从 GitHub 下载，通常会失败。请先配置镜像：

```bash
export ELECTRON_MIRROR="https://registry.npmmirror.com/-/binary/electron/"
export ELECTRON_BUILDER_BINARIES_MIRROR="https://registry.npmmirror.com/-/binary/electron-builder-binaries/"
npm config set registry https://registry.npmmirror.com
```

若 `npm install` 阶段镜像未生效导致二进制缺失，可单独补装：

```bash
cd node_modules/electron && node install.js
```

**桌面版默认关闭 GPU 硬件加速**。实测虚拟机、远程桌面、老旧集显环境下 GPU 进程会直接崩溃退出（`FATAL: GPU process isn't usable`），导致程序无法启动。本应用只有表单与图表，软件渲染足够。需要开启硬件加速时用 `AI-API-Tester.exe --enable-gpu`。

---

## 12. 其他文档

- [`README-桌面版.md`](README-桌面版.md) —— 桌面版详细使用说明
- [`REPORT_开发完成度.md`](REPORT_开发完成度.md) —— 功能完成度与已知边界
- [`prd/`](prd/) —— 产品需求文档与架构设计
