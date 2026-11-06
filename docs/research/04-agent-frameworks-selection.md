# 04 - Agent 底层框架选型调研

> 调研日期：2026-11-06。所有 star/提交/版本数据来自当天 `gh api` 实测；源码结论来自 D:\code\xuqiu\repos 下的本地浅克隆（只读）；凡未能证实的地方明确标注"未证实"。
> 本地源码快照：`codex` @7b54fd2（rust-v0.167.0 前后）、`pi-mono`（已更名 earendil-works/pi）@2a32a60（v1.5.0）、`rig` @4134288（v0.46.0）、`deepseek-harness` @fcc0ad46。`goose` 浅克隆在本机反复超时未完成，其结论来自 GitHub API 拉取的源文件（`crates/goose-agent/*`）与 DeepWiki，已标注。

---

## 0. 结论速览（先看这个）

1. **不要从零写 agent loop，也不要把"通用多 agent 编排框架"（LangGraph / CrewAI / AutoGen / ADK）当底座。** 它们的抽象是"图/角色/对话"，与本项目要的"主 agent 极薄 + 子 agent 有状态可 fork/可插话 + 一切皆事件"是两套心智模型。
2. **2026 年真正成熟的"底座"已经下沉到 harness 级别**，而不是 SDK 级别：`deepseek-harness`（MIT，TS，274k★，2026-08 创建）、`pi`（MIT，TS，120k★，OpenClaw 的底座）、`codex-rs`（Apache-2.0，Rust，133k★）、`goose`（Apache-2.0，Rust，56k★）、`rig`（MIT，Rust，9k★，新出的 `rig-ecs` 内核）。这些才是对标对象。
3. **推荐方案（分两阶段）**：
   - **阶段一（0-3 个月，求闭环）**：以 **DeepSeek Harness (dsh) 作为 Agent 内核，用它的"一切皆插件"机制在外面长出我们自己的产品（profile + bundle + 新客户端），不 fork 主干**；LLM 适配层复用它已经在用的 **pi-ai**；Codex / Claude Code 作为子智能体直接用 dsh 现成的 `subagent-codex` / `subagent-claude-code` / `subagent-acp`。外壳用 **Tauri 2**（Rust）+ Node/Bun sidecar；移动端做**薄客户端**连接 Gateway（参考 OpenClaw 的 node 模型）。
   - **阶段二（可选，求轻量）**：如果必须"Rust 内核"，用 **goose-agent（状态机式 agent loop，已能编译到 wasm32）+ rig-core（20+ 模型适配）+ rmcp + ACP SDK** 重写内核，并保持与阶段一**同一套对外协议**（ACP + 自定义事件扩展），客户端无感迁移。
4. **Codex / Claude Code 是"被接入的子 agent"，不是底座**：Codex 只支持 Responses wire API（Chat Completions 已移除），核心 124 个 crate、`core/src` 约 13.8 万行，强绑定 OpenAI；但它的 **Thread/Turn/Item + thread/fork + turn/steer + turn/interrupt** 协议是我们自己事件协议的最佳参考，也是最稳的接入面。
5. **"Muse/SuperAgent"以外的最大不确定性**：dsh 处于 "developer preview"，官方声明"会有破坏性变更"，且品牌条款禁止产品名直接使用 "DeepSeek Harness"。需要用户拍板（见第 9 节）。

---

## 1. 评估维度与权重（由用户需求推导）

| # | 维度 | 为什么重要（对应用户需求） | 权重 |
|---|---|---|---|
| D1 | 子 agent 有状态：fork / 插话(steer) / interrupt / 恢复 | 需求7，SuperAgent 核心 | 极高 |
| D2 | 统一事件/收件箱（用户输入、定时、webhook、子 agent 回调同一入口） | 需求7 | 极高 |
| D3 | 外部 agent 当子智能体（Codex/Claude Code/ACP） | 需求3 | 极高 |
| D4 | 多模型（含国产/DeepSeek/OpenAI 兼容网关）| 需求1,2 | 高 |
| D5 | 工具 / MCP / Skills | 需求8 | 高 |
| D6 | 持久化：追加日志、会话树、checkpoint、跨重启恢复 | 需求7 | 高 |
| D7 | 可嵌入桌面/移动/Web；体积；冷启动 | 需求1 | 高 |
| D8 | 远程执行：多机、SSH、远程浏览器 | 需求6 | 中高 |
| D9 | 社区活跃度、许可证、可持续性 | 需求2 | 高 |

---

## 2. 数据快照（2026-11-06，gh API 实测）

| 项目 | 语言 | ★ | 最近 push | 许可 | 最新版本 |
|---|---|---|---|---|---|
| deepseek-ai/deepseek-harness | TS | 273,995 | 11-04 | MIT | developer preview（建于 2026-08-13）|
| openclaw/openclaw | TS | 393,997 | 11-06 | MIT | - |
| NousResearch/hermes-agent | Python | 260,923 | 11-06 | MIT | - |
| anomalyco/opencode（sst/opencode 迁移）| TS | 224,833 | 11-06 | MIT | - |
| earendil-works/pi（原 badlogic/pi-mono）| TS | 120,339 | 11-06 | MIT | v1.5.0 (11-02) |
| openai/codex | Rust | 133,372 | 11-06 | Apache-2.0 | rust-v0.167.0 (11-06) |
| aaif-goose/goose（原 block/goose，现属 Linux Foundation AAIF）| Rust | 56,272 | 11-06 | Apache-2.0 | v1.57.0 (10-28) |
| 0xPlaygrounds/rig | Rust | 9,073 | 11-06 | MIT | v0.46.0 (10-31) |
| bosun-ai/swiftide | Rust | 802 | 11-05 | MIT | 0.33.0（pre-1.0）|
| liquidos-ai/AutoAgents | Rust | 778 | 10-18 | Apache-2.0 | 0.4.0（2026-07-08 后发版放缓）|
| zeroclaw-labs/zeroclaw | Rust | 33,142 | 11-06 | MIT/Apache-2.0 | 单二进制个人 agent 运行时 |
| nearai/ironclaw | Rust | 12,713 | 11-04 | MIT/Apache-2.0 | - |
| zavora-ai/adk-rust | Rust | 未取 | - | 见仓库 | 已发 2.3.0，3.0 RC 未发布 |
| langchain-ai/langgraph | Py | 44,534 | 11-06 | MIT | - |
| langchain-ai/langgraphjs | TS | 3,404 | 11-06 | MIT | @langchain/langgraph 1.4.x |
| openai/openai-agents-python | Py | 30,523 | 11-06 | MIT | v0.24.0 (10-15) |
| openai/openai-agents-js | TS | 3,981 | 11-06 | MIT | - |
| vercel/ai | TS | 27,767 | 11-06 | Apache-2.0 | ai 7.x（7.0 于 2026-06-25 发布，含 WorkflowAgent）|
| mastra-ai/mastra | TS | 29,367 | 11-06 | Apache-2.0 + `ee/` 目录另有许可 | @mastra/core 1.82.0 |
| agno-agi/agno | Py | 43,076 | 11-06 | Apache-2.0 | v3.1.12 |
| google/adk-python | Py | 22,118 | 11-06 | Apache-2.0 | v2.13.0 |
| pydantic/pydantic-ai | Py | 21,044 | 11-06 | MIT | v2.66.0 |
| OpenHands/software-agent-sdk | Py | 1,357 | 11-06 | MIT | （OpenHands 主仓 92,766★）|
| crewAIInc/crewAI | Py | 60,549 | 11-06 | MIT | - |
| microsoft/autogen | Py | 61,720 | 10-28 | CC-BY-4.0(代码MIT) | **维护模式**（2025-10-02 起）|
| microsoft/agent-framework | Py/.NET | 14,553 | 11-05 | MIT | 1.0 于 2026-04-02/03 GA |
| strands-agents（现 harness-sdk）| Py/TS | 9,061 | 11-06 | Apache-2.0 | - |
| agentclientprotocol/agent-client-protocol | Rust | 4,585 | 11-04 | Apache-2.0 | ACP 标准 |
| modelcontextprotocol/rust-sdk (rmcp) | Rust | 4,093 | 11-05 | Apache-2.0（自 MIT 迁移中）| - |

> 注：star 数在 2026 年的"claw 系/harness 系"项目上膨胀极快（dsh 三个月 27 万），不能单独作为质量信号；要看提交活跃度与代码实质（见下节源码阅读）。

---

## 3. 先厘清分层：你要选的到底是哪一层

```
L4 产品壳      Muse 式 UI / 伙伴形象 / 桌面+移动+Web               ← 自研（本项目差异化）
L3 Harness     会话日志、收件箱、子 agent 树、调度、沙箱、审批、     ← 选型重点（dsh / pi+自建 / codex / goose / rig-ecs）
               skills、MCP、压缩、远程执行
L2 Agent loop  LLM→工具→LLM 循环、流式、steer/follow-up           ← pi-agent-core / goose-agent / rig-agent / codex core
L1 LLM 适配    多厂商流式/工具调用/思考/成本统计                    ← pi-ai / rig-core / goose-providers / Vercel AI SDK
L0 协议        MCP（工具）/ ACP（客户端↔agent）/ A2A               ← rmcp、ACP SDK
```

多数"框架对比文章"比的是 L1-L2（LangGraph、Agno、PydanticAI、ADK 等），但本项目需求落在 **L3**。这是选型的关键判断：**L3 能直接拿现成的，就不要自己做**。

---

## 4. 逐类评估

### 4.1 Harness 级（可直接当底座）

#### (A) DeepSeek Harness（dsh）——与需求最贴合

- 仓库：`deepseek-ai/deepseek-harness`，MIT，TS monorepo，`packages/` 下约 60 个包，非测试 TS 约 10 万行。
- **架构**（`docs/architecture.md`）：基于 Cordis 的"一切皆插件"。模型适配、工具注册表、会话日志、agent loop 本身都是插件；按 profile（`web/headless/sdk/sdk-minimal/acp`）+ bundle + `cordis.patch.yml` 分层组合。**这意味着我们可以把产品做成一个 profile/bundle，而不是 fork 主干。**
- **与 SuperAgent 理念的对应关系（源码证据）**：
  - 追加式会话事件日志：`core/session`（`SessionEvent` 日志，`session-persistence-jsonl`、`session-format-v0..v4` 迁移链）。
  - 单一收件箱：turn flow 中 "One inbox feeds the driver"，`AgentLoop` 的持久化 `inbox` 投影。
  - 子 agent：`packages/subagent/`——`subagent-spawn-in-process`（全新子）、**`subagent-fork-in-process`（以父会话已完成历史为种子 fork）**、`subagent-acp`、**`subagent-codex`（走官方 app-server 协议）**、**`subagent-claude-code`（走官方 Agent SDK）**、`subagent-dsh-sdk`、`tool-subagent-control`（相邻 agent 发消息/interrupt/列表）。Activation API 统一管理本地会话与外部执行，`delivery: 'parent' | 'caller'` 决定结果回灌方式。
  - 事件化触发：`schedule`（定时指令投递到已有/新会话）、`jobs`、`experimental/webhook`、`experimental/webhook-github`。
  - 其他：`browser-use`、`computer-use`、`ssh`、`sandbox`、`mcp`、`skill`、`compaction`、`lsp`、`team`（`context: 'fresh' | 'fork'`）、`acp`、`workflow`、`goal`、`plan`。
  - LLM：`llm/llm-pi-ai` 直接用 pi-ai 的 provider 目录和 OpenAI 兼容网关，所以多模型不是问题。
- 桌面：Electron（`apps/desktop`，内置签名的 dsh 运行时），另有 Web（`apps/web`）和 CLI；Python SDK 通过 `dsh --profile sdk` 拉起运行时。
- **风险**：(1) README 明写 developer preview，"THERE WILL BE COMPATIBILITY-BREAKING CHANGES"；(2) Cordis 范式学习曲线，社区外几乎无人懂；(3) Node 运行时，不能直接进手机；(4) 品牌条款（`BRAND_GUIDELINES.md`）：禁止在项目名里直接用 "DeepSeek Harness"，建议用 "DSH"；MIT 许可本身不限制商用与二开；(5) 上游体量大、节奏快，我们的差异化必须落在 L4 和多机/伙伴形象上。
- 与另一份调研（DeepSeek SuperAgent 出处/核心设计）的对照：本地已有 `repos/dsh-superagent-prototype`，应由对应报告确认"SuperAgent"与 dsh 的确切关系；本报告**未证实**二者是同一物，仅证实 dsh 的设计与需求7逐条吻合。

#### (B) pi（earendil-works/pi，原 badlogic/pi-mono）+ OpenClaw 模式

- MIT，TS。包：`pi-ai`（统一 LLM API，`packages/ai/src/providers/` 下有 anthropic/openai/google/deepseek/moonshot/zai/qwen/xiaomi/openrouter/bedrock 等数十个 provider 文件）、`pi-agent-core`（`agent-loop.ts` 959 行 + `agent.ts` 623 行，总计约 2.5k 行）、`pi-coding-agent`、`pi-tui`、新增的 **`pi-durable`**（事务式提交、Conversation/Entry/Document/Task、fork、inbox）和 `chord`（跨进程对象运行时）。
- **agent loop 精读**（`packages/agent/src/agent-loop.ts`）：事件类型 `agent_start/turn_start/message_*/tool_execution_*/turn_end/agent_end`（`types.ts:528`）；`config.getSteeringMessages()`（loop 第 184/214/304 行轮询，工具执行完之后注入）与 `config.getFollowUpMessages()`（第 311 行，模型本要停下时才注入）——**这就是 steer / follow-up 两种插话的最小实现**。
- 会话：`session-manager.ts`（2029 行）以 `id/parentId` 构成**会话树**，分支只移动 leaf，不删旧支；`AgentSessionRuntime` 提供 `newSession/switchSession/fork/importFromJsonl`。RPC 模式（`docs/rpc-commands.md`）有 `prompt{streamingBehavior:"steer"}`、`steer`、`follow_up`、`abort`、`new_session{parentSession}`。
- `pi-durable/README.md`：busy 会话的 `submit` 支持 `whenBusy: "steer"|"follow-up"|"reject"`，`conversation.fork(entryId)`，Task 每步 checkpoint，重启续跑。
- **哲学**：核心极小（4 个工具：read/write/edit/bash）、默认不带子 agent/plan mode/权限弹窗，全部靠扩展；v1.5 起已带 MCP（`docs/mcp.md`，stdio + streamable HTTP）。
- **OpenClaw 证明了这条路可行**：`docs/pi.md` 说明 OpenClaw 直接 `import` pi 的 `createAgentSession()` 嵌入而非起子进程；Gateway 是常驻 daemon，WS 类型化 API，客户端与 `role: node` 的设备节点（macOS/iOS/Android/headless）都连同一个 Gateway；"lane 感知的 FIFO 命令队列"按 session 串行、跨 session 并行，sub-agent 有独立 lane，消息通道支持 `steer/followup/collect/interrupt` 四种队列模式（docs.openclaw.ai/concepts/queue）。这几乎就是用户需求6/7的现成参考。
- 短板：pi 自己**不带子 agent**（"No sub-agents"），要自建或借 dsh/OpenClaw 的实现；`pi-durable` 较新（pi-agent-core 的 CHANGELOG 记录了把实验性 harness 移出到 pi-durable 的重构），API 稳定性待观察。

#### (C) codex-rs（OpenAI Codex）——最佳"被接入对象"，不宜作底座

- `codex-rs/` 共 124 个目录/crate，`core/src` 非测试代码约 13.9 万行；包含 `app-server`、`app-server-protocol`、`thread-store`、`rollout`、`exec-server`、`sandboxing`、`linux-sandbox`、`windows-sandbox-rs`、`agent-graph-store`、`agent-message-board-*`、`code-mode` 等。
- **核心循环**：提交/事件队列模式。`protocol/src/protocol.rs:705` 的 `enum Op`（`Interrupt`、`InterruptIfNoPendingInput`、`TurnInput{mode}`、`RecoverTurn`、`SuspendTurnAndShutdown` ...）；`core/src/codex_thread.rs`（1484 行）、`core/src/session/turn.rs`（3815 行）、`core/src/session/input_queue.rs`；子 agent：`core/src/agent/{control,registry,child_config,role,history}.rs`，`SpawnAgentOptions.fork_mode = FullHistory`、`MessageDeliveryMode::{QueueOnly, TriggerTurn}`（`agent/types.rs`）——Codex 自己已经实现了"fork 父历史 + 邮箱投递"的多 agent。
- **App Server 协议**（`app-server/README.md`；OpenAI 官方文章 "Unlocking the Codex harness: how we built the App Server"）：JSON-RPC（省略 `jsonrpc` 头），transport 有 stdio / websocket(实验) / unix socket；原语 Thread → Turn → Item，`item/started → item/*/delta → item/completed`；方法 `thread/start|resume|fork|list|read|archive|rollback|inject_items`、`turn/start|steer|interrupt`（`app-server-protocol/src/protocol/common.rs:567,919,1099`）；服务端可反向发起审批请求并挂起 turn。
- **不能当底座的原因**：(1) `model-provider-info/src/lib.rs:110` 明确 "`wire_api = "chat"` is no longer supported"，仅 Responses API——接 DeepSeek/国产模型必须自建 Responses 兼容代理；(2) 体量与 OpenAI 账号/沙箱/云任务强耦合；(3) 对外嵌入面是 `codex-core-api` 的 `ThreadManager`（`thread-manager-sample`），官方未承诺稳定。
- **作为子 agent 非常合适**：走 `codex app-server`（dsh 的 `subagent-codex` 就是这么做的），或走 ACP 适配器 `@agentclientprotocol/codex-acp`（基于新 App Server 实现）。

#### (D) goose（aaif-goose/goose）——最完整的 Rust 产品级参考

- Apache-2.0，Rust 核心 + Electron 桌面（官方 2.0 路线图：重写为 **Tauri**）+ 移动端客户端 + TS TUI。crates：`goose`、`goose-agent`、`goose-providers`、`goose-provider-types`、`goose-mcp`、`goose-sdk`(UniFFI → Python/Kotlin)、`goose-roaming`、`goose-acp-macros` 等。
- **路线**（GitHub Discussion #7309/#7697）：用 **ACP 作为唯一客户端协议**，`goose serve` 通过 HTTP/WebSocket 暴露 ACP，`goose acp` 走 stdio；自定义能力放 `_goose/unstable/*` 扩展方法；Gateway（Telegram 机器人）、`goose-roaming`（基于 iroh/QUIC 的 P2P 跨机连接，`ConnectionCard`/`TrustBook`）。
- **`goose-agent` 是最值得单独拎出来的组件**（本机用 GitHub API 读取 `crates/goose-agent/README.md`、`Cargo.toml`、`src/subagent.rs`）：agent loop 被拆成 **"有序的 `Operation` 列表 + `StateMachine`"**——每步看会话、要么 `NotApplicable` 要么产生 `ConversationEffect`，**"整个 agent 的行为是持久化会话的函数，而不是内存 loop 状态的函数"**，每轮之间重新 `SessionLoader` 加载，不缓存。内置 `ToolApprovalOperation`/`PreToolCallHook`/`StopHook`/`SubagentOperation`（`SubagentRunner` trait，`ToParent(Message)`/`Finished(Outcome)`）。`Cargo.toml` 含 `cfg(target_arch = "wasm32")` 分支，DeepWiki 称其可编译到 wasm32 且不依赖 tokio 多线程运行时（**部分来自 DeepWiki，建议落地前自行 `cargo check --target wasm32-unknown-unknown` 验证**）。版本 `0.1.0-alpha.13`，**仍是 alpha**。
- 短板：核心 provider 仅"15+"，不如 rig/pi 广；会话体系偏"会话为中心"，没有 SuperAgent 式的统一收件箱；模块大、改动快（2.0 迁移中，`goosed` 将被移除）。

#### (E) rig（0xPlaygrounds/rig）——Rust 的 L1 首选，新增 `rig-ecs` 内核值得关注

- MIT。`rig-core` 提供 20+ provider（本地 `crates/rig-core/src/providers/`：anthropic/openai/gemini/deepseek/moonshot/zai/minimax/xiaomimimo/ollama/openrouter/llamacpp/...）、流式、工具、向量库；`rig-rmcp` 接入 MCP。`rig-core/Cargo.toml` 有 wasm32 分支。
- v0.46 新增 **`rig-ecs`**（约 1.2 万行，`crates/rig-ecs/README.md`）：基于 **Bevy ECS** 的 agent 内核——agent 是 entity，turn/call 是 entity；`fork.rs`（`ForkAgent` 在同一 session 里从另一 agent 日志拷贝出新 agent，并可撤销压缩）、`inbox.rs`（**消息即 effect；`DeliveryMode::{Steer, Queue, Inform}`；收件箱随会话保存并在重启后恢复**）、`session_log`、`restore`、`spawn`、`retry`。声明 "no features, builds for wasm32-unknown-unknown"。其上有 `rig-harness`（终端 coding agent，插件：subagents、budget、redact、MCP、`rig-acp` 等）。
- 评价：**设计上是 Rust 世界里与 SuperAgent 最接近的内核**，但：新（README 提醒 crates.io 上同名旧包被替换）、Bevy 依赖重、harness 目前仅 Linux/macOS（`docs/agent.md`："Windows is not supported yet"，针对 harness 而非 rig-core 库）、社区 9k★。
- 第三方性能数据（日文博客 zenn.dev，2026-09-14，未独立复现）：AutoAgents/rig 冷启动 ~4ms、峰值内存约 1.0GB（含工作负载），LangChain/LangGraph 为 62ms/5.5-5.7GB；E2E 延迟被网络主导（5.7-6.1s），差异主要在启动与内存。ADK-Rust 自测（厂商数据，2026-06）冷启动 109ms、峰值 RSS 约 15MB。**结论：Rust 的价值在体积与启动，不在推理延迟。**

#### (F) 其他 Rust 路线

- swiftide（802★）：agent harness + 类型化 task graph + RAG pipeline，支持 pause/resume 与 MCP，pre-1.0；偏 RAG/流水线，不适合当 L3。
- AutoAgents（778★）：宏驱动、本地模型友好、有 Python 绑定；0.3.7→0.4.0 间隔 3.5 个月，活跃度存疑。
- ADK-Rust(zavora-ai)：43 个 crate、含 graph/realtime voice，3.0 仍是未发布 RC。
- zeroclaw（33k★，单 Rust 二进制，30+ 通道）、ironclaw（nearai，12.7k★，强调隐私/沙箱）：属于"Rust 版个人 agent 产品"，可借鉴通道与安全设计；本次**未深读源码**。

### 4.2 TS 系 SDK/框架

| 框架 | 定位 | 对本项目 |
|---|---|---|
| Vercel AI SDK (`ai` 7.x) | L1：统一模型调用 + UI 流；7.0 起有 `WorkflowAgent`（持久化到 durable storage，`needsApproval`）| 可作 L1 备选；pi-ai 在 coding agent 场景更贴合（跨 provider 会话交接、成本统计）|
| Mastra (`@mastra/core` 1.82) | 应用框架：agent+workflow(suspend/resume 快照)+memory+RAG+evals；`createDurableAgent()`、Inngest 集成 | 面向 SaaS/后端，快照式 suspend 与"收件箱+日志"模型不同；`ee/` 目录另有许可，需法务确认 |
| LangGraph.js | 图 + checkpointer(`PostgresSaver`)，`interrupt()`/`Command(resume)` | 恢复时节点从头重跑；比 Python 版滞后；不契合 |
| OpenAI Agents SDK JS | handoffs / agents-as-tools / `RunState` 序列化 / Sandbox Agents | 默认 OpenAI；`as_tool` vs `handoffs` 概念值得借鉴（主 agent 保持控制权 vs 交接）|
| Claude Agent SDK (TS/Python) | 把 Claude Code 当库用：subagents（`AgentDefinition`、`Agent(fork)`）、session `resume/fork`、hooks、`sessionStore` 适配器 | **用作子智能体接入面**；不是底座（闭源二进制/Claude 绑定）|

### 4.3 Python 系

| 框架 | 要点 | 对本项目 |
|---|---|---|
| LangGraph (44k★) | 持久化 checkpoint + 时间旅行 + interrupt，生产级长流程 | 长流程服务端可用；桌面嵌入重（Python 运行时，上面第三方测得内存 5.5GB 量级，含工作负载）|
| OpenAI Agents SDK (30k★) | 轻量，handoffs/guardrails/sessions/tracing，Sandbox Agents 把 harness 与 compute 分离 | 概念好，但 Python + OpenAI 优先 |
| Agno (43k★) | 运行时 + AgentOS，memory/knowledge | 偏云端服务 |
| Google ADK (22k★, v2.13) | 多 agent 层级、A2A、评测、已有 Rust/Java/Go 版 | 偏 GCP/Gemini 生态 |
| PydanticAI (21k★, v2.66) | 类型安全、durable execution 集成 | 适合服务端结构化任务 |
| OpenHands Software Agent SDK | **事件溯源**（不可变 EventLog + `ConversationState`），`LocalConversation`/`RemoteConversation` 同 API，agent-server(FastAPI+WS) 容器化 | **云端沙箱 coding worker 的好选择**，可做"远程子 agent"后端；不宜进桌面主进程 |
| CrewAI (60k★) / AutoGen (62k★, 维护模式) / MS Agent Framework (1.0 GA 2026-04) | 角色/对话/图工作流 | 不契合；AutoGen 已停新功能，勿选 |
| hermes-agent (Nous, 261k★, Py) | 自学习 skill 闭环、FTS5 会话检索、cron、多通道网关、6 种终端后端(Docker/SSH/Modal/Daytona...) | **产品功能参考**（记忆/技能进化/定时），不当底座 |

---

## 5. 对 SuperAgent 四条原则的契合度矩阵

评分：● 原生具备 / ◐ 有但需改造 / ○ 无

| 候选 | 主 agent 轻量+只分发 | 子 agent 有状态+fork | 插话 steer/interrupt | 统一事件/收件箱 | 外部 agent 作子 agent | 多模型 | 进桌面+移动 |
|---|---|---|---|---|---|---|---|
| dsh | ◐(preset 可裁剪) | ● fork-in-process | ● | ● inbox+schedule+webhook | ● codex/claude-code/acp | ●(pi-ai) | ◐ Electron+Web；移动需薄客户端 |
| pi + pi-durable | ● | ◐ 会话树 fork，无内置子 agent | ● steer/followUp | ◐ inbox(`submit`) | ○ 需自建(有 pi-acp 社区适配器) | ● | ◐ Node/Bun |
| codex-rs | ○ | ● fork FullHistory | ● turn/steer、interrupt | ● Op 队列 | —(自己是被接入者) | ○ 仅 Responses | ◐ 单二进制，重 |
| goose / goose-agent | ◐ | ◐ SubagentRunner | ◐ cancel | ◐ | ● ACP 客户端/服务端 | ◐ 15+ | ● Rust+UniFFI+wasm |
| rig-ecs | ● | ● ForkAgent | ● Steer/Queue/Inform | ● Incoming effect | ◐ rig-acp | ● 20+ | ● wasm32 |
| LangGraph/ADK/CrewAI/AutoGen | ○ | ○(checkpoint 分叉≠有状态 actor) | ○ | ○ | ○ | ● | ○ |

---

## 6. 推荐方案与取舍

### 6.1 推荐：**"dsh 内核 + 自有产品壳 + 开放协议"**，二阶段可换 Rust 内核

```
┌──────────────── 客户端（自研，差异化）────────────────────┐
│ Tauri 2 桌面(Win/Mac/Linux) │ Web │ 移动端(薄客户端)        │
│ Muse 式 UI + 伙伴形象                                       │
└───────────────▲──────────────────────────────────────────┘
                │ ACP(JSON-RPC over WS/stdio) + 自定义扩展(_ns/*)
┌───────────────┴────── Gateway / Agent Kernel ─────────────┐
│ 阶段一：dsh profile "mine"（TS，Bun/Node sidecar）           │
│   主 agent(薄) → subagent 树(fork/steer/interrupt)          │
│   inbox ← 用户 / schedule / webhook-github / 子 agent 回调   │
│   LLM: pi-ai │ 工具: MCP/Skills │ 会话: JSONL 追加日志        │
│ 阶段二(可选)：goose-agent + rig-core + rmcp (Rust)           │
└───────┬───────────────────────┬───────────────────────────┘
        │子 agent 后端           │远程
  Codex(app-server)       Rust node-agent(每台电脑一个，
  Claude Code(Agent SDK)   iroh/QUIC 打洞，暴露 shell/fs/浏览器)
  ACP agents(30+)          OpenHands agent-server(云沙箱)
```

**为什么选 dsh 而非 pi 自建**：pi 缺子 agent，OpenClaw 的相关能力散在自家仓库；dsh 已经把"fork 子 agent + 外部 Codex/Claude Code 子 agent + 调度 + webhook + 浏览器 + SSH + 会话迁移"做成可组合插件，工程量节省最大，且其 LLM 层本来就是 pi-ai，后续要降级到 pi 也不是死路。

**为什么暂不直接上 Rust 内核**：(1) goose-agent 仍是 alpha，rig-ecs 太新且绑定 Bevy；(2) "多端轻量"的主要瓶颈在外壳（Tauri vs Electron）和移动端形态，而不是 agent loop 的 CPU 开销（LLM 延迟 5-6 秒占绝对主导，见 4.1(E) 第三方数据）；(3) 先拿 TS 内核跑通闭环，同时**把对外协议固定为 ACP + 自定义扩展**，Rust 内核就能在不改客户端的前提下替换（goose 自己就在走这条路）。

**Rust 用在哪里（阶段一就有价值）**：Tauri 外壳；每台被控电脑上的 **node-agent**（常驻、小体积、内存安全、可做 P2P/NAT 穿透——参考 goose-roaming、本地 `repos/iroh`、`repos/rustdesk`）；沙箱/权限；以及未来的内核重写。

### 6.2 备选方案

- **Plan B：goose 二开**（Rust + Apache-2.0 + 已有 ACP server/Tauri 重写/移动端/iroh 漫游/Telegram 网关）。适合"坚持 Rust、愿意接受 alpha 级 goose-agent"。代价：需要自己补 SuperAgent 式收件箱与 fork 树；goose 2.0 重构期间上游变动大。
- **Plan C：pi 全家桶 + 自建子 agent 层**（OpenClaw 路线）。最轻、最可控、社区验证过（OpenClaw 39 万★）；代价：子 agent、调度、webhook、审批都要自写。
- **Plan D（不推荐）**：LangGraph/ADK/CrewAI 之类。

### 6.3 明确不做的事

- 不 fork Codex 当底座（Responses-only、体量、绑定）；只当子 agent 接入。
- 不引入 Python 作为桌面主进程；Python 只出现在可选的云端 worker（OpenHands SDK / hermes）。
- 不依赖 AutoGen（维护模式）。

---

## 7. 子智能体接入面（需求3）实现要点

| 外部 agent | 推荐接入方式 | 关键能力映射 |
|---|---|---|
| Codex | `codex app-server`（stdio JSON-RPC）或 `@agentclientprotocol/codex-acp` | `thread/start`/`thread/fork`、`turn/start`/`turn/steer`/`turn/interrupt`、审批反向请求；注意其需要 ChatGPT 登录或 OpenAI key，计费自理 |
| Claude Code | Claude Agent SDK（`resume`/`fork`、`agents`、hooks）或 `@agentclientprotocol/claude-agent-acp` | 子会话 `session_id` 续接；`Agent(fork)` 子 agent；`sessionStore` 可镜像转写 |
| Gemini CLI / Cursor / OpenCode / Copilot CLI / Goose / Qwen / Kimi... | 原生 `--acp`/`acp` 子命令 | 统一走 ACP；ACP Registry（`cdn.agentclientprotocol.com/registry/v1/latest/registry.json`）可程序化获取并自动安装，目前 41 个 agent（AgentRQ 博客 2026-10-02 统计）|
| Pi / Amp | 社区 ACP 适配器 `pi-acp`、`amp-acp` | - |
| OpenHands | `openhands acp` 或 agent-server（HTTP/WS）| 云端容器沙箱 |

要点：**子 agent 一律抽象为"带 inbox 的有状态 activation"**（dsh 的 `startActivation`/`SubagentActivation{result, dispose}` 是很好的接口模板），Codex/Claude Code 只是不同 provider；本地内置子 agent 与外部子 agent 对主 agent 呈现同一套 `message/wait/interrupt/fork` 工具。

---

## 8. 风险清单

| 风险 | 级别 | 缓解 |
|---|---|---|
| dsh 破坏性变更、上游节奏快 | 高 | 版本锁定；只通过插件/patch 扩展，不改主干；每月与上游对账；保留 pi 作退路 |
| dsh 品牌/商标限制 | 中 | 产品命名避开 "DeepSeek Harness"；NOTICE 中如实标注"built on DeepSeek Harness (MIT)" |
| Electron 体积 vs "轻量"诉求 | 中 | 外壳走 Tauri 2；dsh 以 sidecar 运行（Bun compile 或 Node SEA；**可行性未证实，需 PoC**）|
| 移动端无法跑 TS 内核 | 中 | 移动 = 连接 Gateway 的薄客户端；离线能力靠阶段二 wasm/UniFFI |
| Codex 仅 Responses API | 中 | 子 agent 用 OpenAI 模型即可；本项目主 agent 与 Codex 的模型解耦 |
| goose-agent / rig-ecs 处于 alpha/新 | 中 | 阶段二才引入，先在非关键路径验证 |
| Mastra `ee/` 等许可细节 | 低 | 本方案不依赖 |
| star 数膨胀不可靠 | 低 | 以源码质量与提交实质为准（本报告已读核心循环）|

---

## 9. 待用户拍板的问题

1. **是否接受以 dsh 为内核（MIT，开发者预览，会有破坏性变更）？** 还是坚持"自有内核"（Plan B/C）？这决定第一个月的工作量差一个数量级。
2. **Rust 的诉求强度**：是"外壳+node-agent 用 Rust 即可"，还是"agent 内核也必须 Rust"？前者可立即开工，后者需承担 goose-agent/rig-ecs 的 alpha 风险。
3. **移动端形态**：薄客户端（连家里/云上的 Gateway）是否足够？还是要求手机上离线跑本地 agent（需 wasm/UniFFI 路线，成本高）？
4. **与 DeepSeek 的关系**：产品是否定位为"DeepSeek 生态"的一部分？这影响命名、模型默认值与品牌合规。
5. **Codex/Claude Code 的计费与登录**：接入时由用户自行登录自己的订阅（推荐），还是产品代管 key？
6. 云端沙箱（OpenHands agent-server）是否纳入 V1 范围？

---

## 10. 来源（均为 2026-11-06 前可访问；检索由本次调研完成）

- DeepSeek Harness：本地 `repos/deepseek-harness`（`docs/architecture.md`、`docs/subsystems/subagent.md`、`packages/subagent/README.md`、`packages/schedule/schedule/README.md`、`packages/llm/llm-pi-ai/README.md`、`BRAND_GUIDELINES.md`）；https://github.com/deepseek-ai/deepseek-harness
- pi：https://github.com/earendil-works/pi ；https://mariozechner.at/posts/2025-11-30-pi-coding-agent/ ；https://lucumr.pocoo.org/2026/1/31/pi/ ；https://newsletter.pragmaticengineer.com/p/building-pi-and-what-makes-self-modifying (2026-04-29) ；https://pi.dev/docs/latest/sdk ；本地 `packages/agent/src/agent-loop.ts`、`packages/coding-agent/docs/rpc-commands.md`、`packages/durable/README.md`
- OpenClaw：https://docs.openclaw.ai/architecture 、/concepts/agent-loop 、/concepts/queue 、/pi ；https://github.com/openclaw/openclaw/blob/9098e948/docs/pi.md
- Codex：本地 `repos/codex/codex-rs/{protocol/src/protocol.rs, core/src/agent/*, app-server/README.md, app-server-protocol/src/protocol/common.rs, model-provider-info/src/lib.rs, thread-manager-sample}` ；https://openai.com/index/unlocking-the-codex-harness/ ；https://codex.danielvaughan.com/2026/04/15/codex-app-server-complete-guide/ ；https://deepwiki.com/openai/codex/1.3-architecture-overview
- Goose：https://github.com/aaif-goose/goose/discussions/7309 、/7697 ；https://goose.vcorp.ai/docs/gdk/acp/ ；https://deepwiki.com/aaif-goose/goose/5-acp-server-and-protocol-layer 、/6.6-goose-2.0-and-future-architecture ；`crates/goose-agent/{README.md,Cargo.toml,src/subagent.rs}`（GitHub API 拉取）
- Rig：本地 `repos/rig/{README.md, docs/agent.md, crates/rig-ecs/{README.md,src/fork.rs,src/inbox.rs}, crates/rig-harness/README.md, crates/rig-core/src/providers}` ；https://zenn.dev/kai_kou/articles/1110-rust-ai-agent-framework-guide (2026-09-14) ；https://wrenlearnsrust.com/posts/rust-agent-ecosystem-2026.html (2026-03-11) ；https://github.com/zavora-ai/adk-rust ；https://crates.io/crates/swiftide-agents
- ACP：https://agentclientprotocol.com/get-started/registry 、/agents ；https://zed.dev/blog/acp-registry (2026-01-28) ；https://zed.dev/docs/ai/external-agents ；https://agentrq.com/blog/which-coding-agents-support-acp-agent-client-protocol (2026-10-02)
- Claude Agent SDK：https://code.claude.com/docs/en/agent-sdk/subagents 、/sessions ；https://platform.claude.com/cookbook/claude-agent-sdk-04-migrating-from-openai-agents-sdk (2026-03-09)
- OpenAI Agents SDK：https://developers.openai.com/api/docs/guides/agents/sandboxes ；https://developers.openai.com/cookbook/examples/agents_sdk/migrate-from-claude-agent-sdk/readme
- TS 框架对比：https://cadenya.com/other-content/typescript-ai-agent-frameworks-compared (2026-10-15) ；https://dreaming.press/posts/mastra-vs-vercel-ai-sdk-vs-langgraph-js.html (2026-06-21) ；https://www.developersdigest.tech/blog/durable-ai-agent-frameworks-compared-2026
- Microsoft：https://learn.microsoft.com/en-us/agent-framework/migration-guide/from-autogen/ ；https://www.heybeagle.com/blog/does-microsoft-agent-framework-replace-autogen-and-semantic-kernel (2026-10-10)
- OpenHands：https://docs.openhands.dev/sdk/arch/overview 、/sdk/guides/agent-server/overview ；https://arxiv.org/html/2511.03690 ；https://github.com/OpenHands/software-agent-sdk
- 个人 agent 产品参考：https://github.com/NousResearch/hermes-agent 、zeroclaw-labs/zeroclaw 、nearai/ironclaw 、sipeed/picoclaw
- 所有 star/license/push/release 数字：`gh api repos/<owner>/<repo>`，2026-11-06 当天取值。

---

## 附录：本地克隆状态

- 复用/新克隆：`repos/codex`（复用）、`repos/pi-mono`（新克隆，上游已更名 earendil-works/pi）、`repos/rig`（新克隆）、`repos/deepseek-harness`（复用）。
- `repos/goose`：`block/goose`（现 aaif-goose/goose）浅克隆较慢，在报告撰写后才完成。报告中 goose-agent 的结论最初来自 GitHub API 取回的源文件与 DeepWiki，事后已用本地副本核对：`crates/goose-agent/Cargo.toml` 版本为 `0.1.0-alpha.13`、存在 `cfg(target_arch = "wasm32")` 依赖分支，`src/machine.rs`（355 行）有 `step()`/`run()` 状态机入口，与报告一致。wasm32 可编译性仍建议自行 `cargo check` 验证（未执行任何构建）。
- 未做任何构建、安装或脚本执行。
