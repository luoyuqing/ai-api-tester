# 部署到 Cloudflare Pages

本应用（纯前端 SPA）可直接部署到 Cloudflare Pages，**比服务器一那套（nginx + node sidecar）更干净**——不需要你维护任何常驻进程，CORS 转发由一个同域的 Pages Function 完成，HTTPS 由 Cloudflare 原生提供。

---

## 一、为什么能上 Cloudflare Pages

| 关注点 | 结论 |
|---|---|
| 静态托管 | ✅ 纯静态产物 `dist/`，Cloudflare Pages 原生托管 |
| 路由 | ✅ 使用 **hash 路由**（`#/page`），所有导航都落在 `/`，**不需要 SPA fallback / rewrite**，Pages 默认行为即可 |
| HTTPS | ✅ Cloudflare 默认 HTTPS，浏览器判定为**安全上下文**，`crypto.subtle` 正常，密钥保险库走强加密（之前明文 HTTP 的兼容降级模式不会触发） |
| CORS 转发 | ⚠️ 原 Web 版依赖的 node sidecar + nginx 反代**不能**直接跑在 Pages 上，但用**同域 Pages Function** 完美替代，契约 100% 一致，前端代码零改动 |

---

## 二、三条构建产线（互不干扰）

| 命令 | base | 用途 |
|---|---|---|
| `npm run build` | `/tester/` | 部署到服务器一（nginx 子路径） |
| `npm run build:pages` | `/` | **部署到 Cloudflare Pages**（本文件） |
| `npm run build:desktop` | `./` | 打包 Windows 桌面 exe |

---

## 三、部署步骤（推荐：Git 连接，自动部署）

1. 打开 **Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git**
2. 选择本仓库 `luoyuqing/ai-api-tester`
3. 构建设置：
   - **Framework preset**：`Vite`
   - **Build command**：`npm run build:pages`
   - **Build output directory**：`dist`
4. **环境变量（关键）**：在构建设置的 **Environment variables** 中添加：
   | 变量名 | 值 | 作用 |
   |---|---|---|
   | `VITE_DEFAULT_TRANSPORT` | `proxy` | 部署后默认用代理转发模式（解决 CORS），用户无需手动切换 |
   | `ELECTRON_SKIP_BINARY_DOWNLOAD` | `1` | 阻止构建环境下载 electron 二进制（见下方「坑位」） |
   | `NODE_VERSION` | `22` | 指定构建 Node 版本（仓库根已有 `.node-version` 兜底） |
5. 点击 **Save and Deploy**
6. 部署完成后会得到一个 `*.pages.dev` 域名，可在 **Custom domains** 绑定自己的域名

> 仓库根目录已放 `.npmrc`（`electron_skip_binary_download=1`）和 `.node-version`（22），即使忘记在 Dashboard 设上面的环境变量，构建也能成功跳过 electron 下载。但 `VITE_DEFAULT_TRANSPORT=proxy` 仍建议在 Dashboard 显式设置，否则用户需手动在配置里把传输方式切到「代理转发」。

---

## 四、Pages Function（CORS 中继）已就位

仓库 `functions/` 目录已包含完整实现，部署后**自动生效**，无需额外配置：

```
functions/
└── tester-proxy/
    ├── proxy.js    # POST /tester-proxy/proxy  + x-target-url 头 → 原样转发并流式回传
    └── health.js   # GET  /tester-proxy/health → 健康检查
```

- 前端默认的代理基址是 `window.location.origin + /tester-proxy`，与此路由完全对齐。
- Function 镜像了原 `proxy/server.mjs` 的契约（CORS 响应头、逐跳头过滤、流式透传、`x-proxy-upstream-status` 透传），前端零改动。
- **同源校验**：Function 会拒绝非同源 `Origin`，第三方网站无法借本中继发请求（防滥用）。
- 流式透传几乎不消耗 Workers CPU 时间（CPU 只算实际计算，不算网络等待），LLM 长响应也远低于限额。

---

## 五、部署后验证

1. 打开分配的 `*.pages.dev` 域名
2. 进入「配置中心」→ 新增 API：填厂商名 / BaseURL / Key → 点「连接并拉取模型」
3. 传输方式应**已默认为「代理转发」**（因 `VITE_DEFAULT_TRANSPORT=proxy`）
4. 点「连通性测试」→ 应显示成功（经 `/tester-proxy/proxy` 转发，无 CORS 报错）
5. 跑一轮测试 → 导出 HTML 报告验证

---

## 六、与现有版本的对比

| | 服务器一（nginx） | Cloudflare Pages | 桌面 exe |
|---|---|---|---|
| 常驻进程 | nginx + node sidecar | 无（Functions 按需） | 无（主进程内发请求） |
| CORS 方案 | node sidecar + nginx 反代 | Pages Function | 无（webSecurity:false） |
| HTTPS | 需自配 | 原生 | 不涉及 |
| 维护成本 | 中（维护服务器/进程） | 低（推送即部署） | 低（双击即跑） |
| 适用 | 团队内网长期服务 | 公网轻量分享/CDN | 个人本机离线 |

---

## 坑位记录（已规避）

1. **electron 二进制下载**：`electron`/`electron-builder` 在 `devDependencies`。Cloudflare 构建跑 `npm install` 会触发 electron postinstall 下载 ~348MB 二进制，极易超时失败。已用 `.npmrc` 的 `electron_skip_binary_download=1` 跳过。
2. **base 路径**：Cloudflare 托管在根路径，必须用 `build:pages`（base=`/`），不能用服务器一的 `build`（base=`/tester/`），否则资源 404。
3. **默认传输**：纯 Web 环境若无 CORS 头的厂商会 `failed to fetch`，必须通过代理模式。已用 `VITE_DEFAULT_TRANSPORT=proxy` 设为默认值。
