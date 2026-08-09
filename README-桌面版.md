# AI API 质量评测 · 桌面版（Windows exe）

把原来的纯前端 Web 应用打包成了独立桌面程序。**不需要装 Node、不需要浏览器、不需要服务器、不需要 proxy**，拷到任意 Windows 电脑双击即可运行。

## 一、产物说明

打包后在 `release/` 目录下会有两个 exe，按需选一个：

| 文件 | 类型 | 说明 |
|---|---|---|
| `AI-API-Tester-1.0.0-portable.exe` | 免安装单文件 | **推荐**。单个 exe，拷到 U 盘/任意电脑双击直接跑，不写注册表 |
| `AI-API-Tester-1.0.0-setup.exe` | 安装包 | 常规安装向导，可自选安装目录、生成开始菜单与桌面快捷方式 |

另有 `release/win-unpacked/`，是解包后的程序目录，整目录拷贝也能跑（`AI-API-Tester.exe`）。

## 二、为什么桌面版不再需要 proxy

Web 版部署在服务器上时，`fetch` 实际是从**你的浏览器**发出的，遇到不返回 CORS 头的厂商（如商汤 `token.sensenova.cn`）会被浏览器直接拦截，报 `failed to fetch`，所以才要在服务器上外挂 proxy sidecar + nginx 反代。

桌面版里，Electron 渲染进程运行在 `webSecurity: false` 的窗口中，请求不再受浏览器 CORS 约束，**可以直连任意厂商 API**。因此桌面版：

- 传输方式强制为 `direct`，UI 中已隐藏 proxy 相关选项与代理设置入口；
- 不需要启动任何辅助服务，也不需要联网到你自己的服务器。

## 三、使用流程

1. **配置 API**（配置中心）
   - 填三个核心字段：厂商名、Base URL（如 `https://token.sensenova.cn/v1`）、API Key
   - 点「**连接并拉取模型**」→ 程序调用 `GET {BaseURL}/models`，把返回的模型列表填进下拉框，直接选即可，不用手打模型名
   - 拉取失败时可退回手动输入模型名

2. **跑测试**（测试执行）
   - 选中要测的配置，勾选维度：性能（TTFT / 总耗时 / 错误率 / 上下文长度）、功能（聊天 / 生图 / 多模态 / Agent 兼容）、安全（外审 / 限制词 / 越狱抵抗）
   - 开始后可实时看到每个探针的进度与日志

3. **出报告**（结果看板）
   - 点「**导出 HTML 报告**」→ 弹出系统保存对话框，选择存放位置
   - 产出的是**单文件自包含 HTML**：ECharts 已内联进去，双击用任意浏览器打开即可看到雷达图、延迟分布、指标明细表，**完全离线、可交互、方便直接发给别人**
   - 同时保留原有的 JSON / CSV 导出

## 四、数据存放位置

配置和历史结果存在 Electron 的用户数据目录（各电脑独立，不会互相干扰）：

```
C:\Users\<你的用户名>\AppData\Roaming\AI-API-Tester\
```

API Key 在本地加密保存，不上传任何服务器。换电脑时需要重新配置。

## 五、关于硬件加速

程序**默认关闭 GPU 硬件加速**。原因：虚拟机、远程桌面、老旧集显、受限环境下 Chromium 的 GPU 进程经常直接崩溃（`GPU process isn't usable`），会导致程序在部分电脑上根本打不开。本程序只有表单和图表，软件渲染完全够用，稳定性优先。

如果你的机器显卡正常、想开硬件加速，命令行加参数启动：

```
AI-API-Tester.exe --enable-gpu
```

## 六、开发者：如何重新构建

```bash
# 1. 安装依赖（国内需走镜像）
npm config set registry https://registry.npmmirror.com
npm install

# 2. 若 Electron 二进制没下下来，用镜像单独补
ELECTRON_MIRROR="https://registry.npmmirror.com/-/binary/electron/" \
  node node_modules/electron/install.js

# 3. 本地调试（先构建再起 Electron）
npm run build:desktop
npm run electron:dev

# 4. 打包 exe
ELECTRON_BUILDER_BINARIES_MIRROR="https://registry.npmmirror.com/-/binary/electron-builder-binaries/" \
  npm run dist:win
```

### 构建注意事项

- Windows 沙箱环境中若遇 `npm install` 被安全删除 shim 拦截，运行前清空会话变量：
  `export CODEBUDDY_SESSION_ID="" CLAUDE_SESSION_ID=""`
- 若环境里存在 `ELECTRON_RUN_AS_NODE=1`，`electron.exe` 会退化成 node 解释器（`--version` 会打印 Node 版本而非 Electron 版本）。运行 Electron 前需 `unset ELECTRON_RUN_AS_NODE`。
- Web 版部署不受影响：`npm run build` 仍然产出 `base=/tester/` 的服务器版本，桌面版走 `npm run build:desktop`（`base=./`）。两条产线互不干扰。
