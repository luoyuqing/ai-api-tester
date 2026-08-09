# AI API 质量评测平台 — 开发完成度报告

> 生成时间：2026-08-08 22:07（GMT+8）
> 项目代号：`ai_api_tester`
> 技术栈：Vite + React 18 + TS 5(strict) + MUI 5 + Tailwind 3 + Zustand 4 + ECharts 5

---

## 一、结论

**核心功能已开发完成并通过编译验证。** 平台是一个「纯前端 SPA + 浏览器内评测引擎」，三大评测维度（性能 / 功能 / 破限安全）共 **10 个探针**全部实现，5 个页面 + 18 个组件已接通，生产构建一次通过。

但需明确两点边界（详见第六节）：
1. 它是**纯前端**设计（无后端），这是为符合银行内网合规要求（数据不出本机）主动选择的架构，不是"没做完"。
2. **导出只支持 CSV / JSON**，没有原生 `.xlsx` / `.pdf`（早期精简依赖时移除了 `xlsx` / `jspdf`）。

---

## 二、验证结果（实测，非凭记忆）

| 检查项 | 命令 / 位置 | 结果 |
|---|---|---|
| TypeScript 类型检查 | `npx tsc --noEmit -p tsconfig.json` | ✅ **0 错误**（exit 0） |
| 导入关系自检 | `node scripts/check-imports.mjs` | ✅ 0 问题（97 文件，未声明依赖 0） |
| Props 契约自检 | `node scripts/check-props.mjs` | ✅ 0 问题（29 组件） |
| 生产构建 | `npm run build` | ✅ 成功，产物在 `dist/`（1497 模块） |

> 注：上一轮修复的 15 个 `tsc` 类型错误（EvaluationEngine 的 `taskId` 类型、Scheduler 的 `checkpoint()`、normalize 的 boolean 收敛、crypto 的 WebCrypto `BufferSource` 断言）现已稳定为 0 错误。

---

## 三、已实现功能

### 1. 性能维度（perf）— 3 探针
- `LatencyProbe`：TTFT（首 token 时延）/ 总耗时
- `StabilityProbe`：错误率 / 超时率
- `ContextWindowProbe`：上下文窗口长度探测

### 2. 功能维度（func）— 4 探针
- `ChatQualityProbe`：聊天质量
- `ImageGenProbe`：生图能力
- `MultimodalProbe`：多模态（图文输入）
- `AgentCompatProbe`：主流 AI Agent 兼容性握手（WorkBuddy / Hermes 等）

### 3. 破限 / 安全维度（safe）— 3 探针
- `ModerationProbe`：是否有外审
- `SensitiveWordProbe`：限制词触发时的行为（报错 / 拒绝 / 通过）
- `JailbreakProbe`：越狱抵抗率

### 4. 评测引擎（零 React 依赖，`src/engine/`）
- `EvaluationEngine`：任务编排与事件分发（`RunEvent`）
- `Scheduler`：每 provider 一条 lane，**跨 provider 并行、同 provider 串行**（避免并发污染 TTFT 测量），含 `gate()` / `checkpoint()` 协作式暂停
- `ProbeRegistry`：11 处 `register()`，探针统一注册
- `scorers/`：规则打分（默认）+ `LlmJudgeScorer`（LLM-as-judge 可插拔）
- `aggregate/`：`aggregator.ts` + `normalize.ts`（N/A 铁律：不适用子指标 `score=null`，自动剔除权重分母）

### 5. 适配器层（`src/engine/adapters/`，6 个）
OpenAI Chat / OpenAI Image / Multimodal / AgentHandshake 适配器 + `ProviderAdapter` 接口 + `AdapterFactory`。仅支持 **OpenAI 兼容 HTTP 协议**（云端/自托管同构），非兼容协议预留扩展点。

---

## 四、代码结构清单（实测）

| 模块 | 数量 | 明细 |
|---|---|---|
| 页面 `src/pages/` | 5 | Home / ConfigCenter / TestExecution / Dashboard / History |
| 看板组件 `dashboard/` | 10 | ComparisonView, DimensionCard, EChart, ExportButtons, GradeBadge, MetricTable, ResultPicker, ScoreBars, ScoreOverview, ScoreRadar |
| 执行组件 `execution/` | 8 | LogConsole, ProbeMatrix, ProgressPanel, ProviderProgressList, RunControls, RunSummary, SafetyNoticeDialog, TaskConfigForm |
| 探针 `probes/` | 10 | 见第三节 |
| 适配器 `adapters/` | 6 | 见第三节 |
| 打分器 `scorers/` | 5 | Rule / LlmJudge / Composite / classify / Scorer |
| 状态 `store/` | 5 | provider / result / run / testConfig / ui |
| 源码文件 | 97 | `.ts` + `.tsx` |

---

## 五、已具备的辅助能力

- **CORS 代理 sidecar**：`proxy/server.mjs`，**零依赖** Node 脚本，解决部分 Provider 不返回 `Access-Control-Allow-Origin` 的问题；UI 中每个 Provider 可单独选 `direct` / `proxy` 传输模式（`npm run proxy` 启动）。
- **密钥保险库**：`src/lib/crypto.ts`，WebCrypto AES-GCM，会话口令经 PBKDF2 派生密钥加密 API Key，UI 全程掩码。
- **持久化**：localStorage（配置/模板/结果索引）+ IndexedDB（大体积结果明细、生图 base64）；每个 Probe 结果增量落盘，支持断点恢复。
- **设计文档齐备**：`prd/` 含 PRD、系统架构设计、类图、时序图（4 份 `.md`/`.mermaid`）。
- **导出**：`ExportButtons` 支持 CSV（带 UTF-8 BOM，可直接 Excel 打开）与完整 JSON 导出。

---

## 六、当前限制 / 未做项（诚实清单）

| 项 | 状态 | 说明 |
|---|---|---|
| **后端服务** | 无（设计如此） | 纯前端架构，无集中式 Key 存储、无数据出境，符合银行内网合规。若需多人共享/定时巡检，需后续替换 `Transport` 与 `Repository` 两个实现。 |
| **原生 .xlsx / .pdf 导出** | ❌ 未实现 | 依赖精简时移除了 `xlsx`/`jspdf`，目前仅 CSV/JSON。CSV+BOM 可在 Excel 正常打开，但无多 sheet / 样式 / PDF 排版。 |
| **内置 Mock / Demo 数据** | ❌ 无 | 跑评测必须填入真实 endpoint + key；没有"一键演示"模式。 |
| **自动化测试套件** | ❌ 无 | 移除 vitest，改用两个零依赖静态自检脚本兜底（导入关系 + props 契约），但无运行时单测。 |
| **LLM-as-judge** | ⚠️ 已实现接口，需配置 | `LlmJudgeScorer` 存在，但需额外配置一个 judge Provider 才能启用；默认走规则打分。 |
| **历史结果持久化** | ✅ 代码就绪 | IndexedDB 落盘已实现，但未做跨会话"历史查看"的完整回归验证（代码层面接通）。 |

---

## 七、如何运行

```bash
npm install          # 已装 199 包（12 运行时 + 9 dev，npmmirror 镜像）
npm run dev          # 开发模式（默认 5173）
npm run build        # 类型检查 + 生产构建
npm run preview      # 预览 dist/ 产物
npm run proxy        # 可选：启动 CORS 代理 sidecar（8787 端口）
```

首次使用：打开「配置中心」填入目标 API 的 endpoint 与密钥 → 在「测试执行」页勾选探针与 provider → 启动任务 → 在「看板」查看雷达图/评分/对比，并导出 CSV/JSON。

---

## 八、建议的下一步（按性价比排序）

1. **补 `.xlsx` 导出**：装回 `xlsx`（或纯前端 `sheetjs`），让看板/对比表一键生成真实 Excel，银行汇报最常用。
2. **加一个 Demo/Mock Provider**：让未接真实 API 时也能跑通完整链路做演示。
3. **历史页回归**：用一条真实 provider 跑完，确认 IndexedDB 结果能在「历史」页加载、对比、再导出。
4. **（可选）vitest 单测**：至少覆盖 `normalize` / `Scheduler` / `CompositeScorer` 三个纯函数模块。

> 一句话：**平台"能评测"的能力已经做完，剩下的是"导出格式、演示模式、回归验证"这类增值项。** 需要我直接动手补哪一块，说一声即可。
