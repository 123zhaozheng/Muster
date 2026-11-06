# 03 - 技术架构设计（工作代号：Muster）

> 日期：2026-11-06。本文基于 `docs/research/01~08` 八份调研报告，以及 `D:\code\xuqiu\repos` 下已克隆源码的抽查（codex-rs、iroh、rig、goose、rust-sdk/rmcp、deepseek-harness 的目录与 Cargo 元数据）。
> 凡标注"【未证实】"的是没有被亲自验证的判断，落地前必须用 spike 验证；"【目标】"是设计目标值，不是实测值。
> **评审修订（05-review-roadmap.md）**：本文已按评审结论修订——MVP 切线与里程碑以 05 为准（§16 已改）；AvatarState/presence 与 UI 的分工、风险分级与 UI 展示分级的映射、沙箱 vendoring 的依赖链风险、适配器运行时分发、PWA 的 secure-context 约束、ACP Rust crate 已核实等处见各节“【评审】”标注。
> 本文是架构层的"可执行蓝图"：回答用什么、分几层、事件和会话怎么建模、接口长什么样、先做什么。UI/形象/产品形态见另外的设计文档，这里只在边界处对接。

---

## 0. 摘要与关键决策（ADR 速览）

产品定位：用户自己的"多 Bot 个人 Agent 网格"。一个轻量的主 Agent（Router/Concierge）只做分发和对人沟通；真正干活的是一组**有名字、有头像、有状态**的 Bot（原生 Worker，或 Claude Code / Codex / OpenCode / Goose 等外部编程 Agent）。Bot 可以跑在用户的任意一台电脑上，可以驱动本机或远程浏览器。一切输入（用户消息、定时器、GitHub PR、IM、子 Agent 回调、设备上下线、审批结果）统一成**持久化事件**。

| 编号 | 决策 | 一句话理由 | 与调研报告的关系 |
|---|---|---|---|
| ADR-01 | **Rust 核心 daemon（`musterd`）+ 协议化薄 UI 壳**，UI 只依赖自有 WS 协议 | 多端、轻量、可无头部署到 VPS/其他电脑；壳可替换 | 采纳 07 |
| ADR-02 | **自建小而硬的事件内核**（SQLite WAL 单写者 + domain event + per-session 追加日志 + effect outbox），语义对齐 DSH Session 层与 SuperAgent 原型领域模型；**不 fork 任何整仓** | 本产品的差异化恰好在内核；DSH 是 TS 开发者预览且频繁破坏性变更；Rust 才能做 node-agent/单二进制/移动端共享协议类型 | **偏离 04 的"阶段一用 dsh 内核"**，见 §3.3 的论证与止损闸门 |
| ADR-03 | 外部编程 Agent：**ACP 为南向主干 + 内部 canonical 事件 + Codex app-server / Claude SDK 原生 Driver 逃生舱**；能力矩阵 + 降级 | 没有单一外部协议覆盖 fork+steer+回调+触发 | 采纳 03、07 |
| ADR-04 | 内部事件模型自建 **Thread / Turn / Item / Event**（Codex app-server 三原语 + ACP v2 + AG-UI 的 parent run 思想）；北向提供自有 WS、后续 ACP-server 与 AG-UI 适配 | fork/steer/回调在内部必须是一等公民 | 采纳 07 |
| ADR-05 | 多机：**Hub / Node / Operator** 三角色；Node 主动外连；设备身份 = Ed25519 公钥；传输做成 trait，v0 WebSocket，v1 默认 iroh，WS relay 供 Web | 与 OpenClaw Node、Eigent Brain/Hands 同构 | 采纳 06 |
| ADR-06 | 远程浏览器统一为 `browser.*` 工具面，三档后端（本机隔离 profile / 真实 Chrome 扩展桥 / 云 CDP）；v1 只做 A + C | 先做隔离、可审计的 | 采纳 06 |
| ADR-07 | 安全三件套：**确定性策略引擎 + 凭据代理（模型只见句柄）+ 沙箱/worktree**；不可信来源污点标记；审批卡是原生确定性 UI；无人值守触发的审批默认不放行 | 安全是用户第一痛点，也是对 Meta Muse 的差异化 | 采纳 01、05、06 |
| ADR-08 | 记忆：**文件为真相**（Markdown + git，用户可读可改）+ SQLite FTS5/向量作派生索引 + 夜间"梦境"整理子 Agent | 可审计、可迁移、抗"记忆膨胀" | 借鉴 Muse SOUL/MEMORY、Letta MemFS、SuperAgent Inline&Spill |
| ADR-09 | 桌面壳 **Tauri 2** 起步，`musterd` 独立进程；WebKit/Chromium 双内核 CI；Electron 为回退 | 体积优势明显，决策可逆 | 采纳 07 |
| ADR-10 | 移动端：阶段 1 PWA 遥控器（经出站中继），阶段 2 Tauri mobile 壳；Agent 永不在手机上运行 | 控制面薄，风险小 | 采纳 07 |

**要用户拍板的关键点**（详见 §19）：ADR-02（自建内核 vs dsh）、Claude/Codex 订阅合规姿态、代号与域名、是否做云端 Hub 托管。

---

## 1. 目标、约束与非目标

### 1.1 必须满足的目标（来自用户 9 条诉求）

1. 多端：Win/Mac/Linux 桌面一等公民；Web/移动为遥控器；无头 Hub/Node 可跑在 VPS、家用服务器、另一台电脑。
2. 轻量高质量：安装包与常驻内存显著低于 Electron 全家桶路线（目标见 §15）。
3. 不从零造 LLM/协议轮子：LLM 适配、MCP、ACP、P2P 传输、沙箱均复用成熟库；自研集中在**事件内核、调度、策略、产品面**。
4. 外部编程 Agent 作为一等子智能体；自身也有原生子智能体。
5. SuperAgent 哲学：主 Agent 轻量只分发；子 Agent 全部有状态，可从任意点分支、可插话/中断；一切触发皆事件。
6. 多电脑与远程浏览器。
7. 安全默认、成本透明、可自托管、可审计（对 Meta Muse 的差异化）。

### 1.2 工程约束

- 个人/小团队开发：核心 crate 数量控制；先 monolith daemon，后拆；每个抽象必须有至少两个真实实现才引入 trait（Driver、Transport、BrowserBackend 满足；其余先具体类型）。
- Windows 是一等公民（用户本机即 Windows 11）：命名管道/loopback+token、ConPTY（`portable-pty`）、Job Object 杀进程树、Windows 沙箱 crate。
- 协议与外部依赖高速演进（MCP 2026-07-28 破坏性大版本、ACP v2 Draft、Codex app-server 实验性）：每个外部协议只在一个 adapter crate 内出现。

### 1.3 非目标（v1 明确不做）

- 不自研：打洞/relay、远程桌面、浏览器内核、LLM 提供商 SDK 长尾、IDE。
- 不做写实/NSFW 3D 伴侣；不做 eBPF 污点追踪；不开放式技能市场（签名 + 权限清单 + 沙箱，后置）。
- 手机端不跑 Agent。
- 不做多写数据复制/CRDT（每个线程有唯一写者设备）。
- computer-use（桌面 GUI 操控）默认关闭、后置。

---

## 2. 总体架构

### 2.1 逻辑分层图

```
┌──────────────────────────────── Operator 层（人机界面，可多个同时连接）─────────────────────────────────┐
│  Tauri 2 桌面壳(托盘/全局快捷键/deep-link/桌宠窗口/updater)   Web/PWA(手机遥控器)   CLI(`muster`)        │
│  React+TS UI：Bot 花名册 | 异构时间线 | 审批卡 | 收件箱 | 电脑/浏览器面板 | Diff/终端/产物 | 分支树       │
└───────────────▲──────────────────────────────────────────────────────────────────────────────────────┘
                │  自有 WS 事件协议 v1（JSON，schema 由 Rust 类型生成 TS）；北向适配：ACP-server / AG-UI（P1）
┌───────────────┴────────────────────────  Hub：musterd（Rust 单进程，可无头）  ──────────────────────────┐
│                                                                                                        │
│  Gateway(axum)            认证 / 设备配对 / 订阅(from_seq 补发) / MCP-bridge 入口 / relay 客户端           │
│        │                                                                                               │
│  ┌─────▼──────────────── Event Ingress ─────────────────────┐                                          │
│  │ Source 适配器: ui | schedule | github(轮询/relay webhook) | im(飞书/微信...) | fs-watch              │
│  │               | agent-callback | device | approval | watchdog                                       │
│  │ 规范化 → 幂等(source,idem_key) → 信任标注(Trust) → 落库 → 快路径过滤                                  │
│  └─────┬────────────────────────────────────────────────────┘                                          │
│        │ append (单写者事务: 事件 + 投影 + effect 入队)                                                   │
│  ┌─────▼───────────────────────────────────────────────────────────────────────────────┐              │
│  │ Kernel：Journal(SQLite WAL) + Projections + Effect Outbox + Lease + Schedule 定时器    │              │
│  └─────┬──────────────┬─────────────────────┬───────────────────────────────────────────┘              │
│        │ 订阅直通(代码)  │ 未订阅/需评估        │ 控制命令 (steer/fork/interrupt/approve)                    │
│  ┌─────▼─────┐   ┌─────▼──────────┐   ┌──────▼──────────┐   ┌──────────────┐                          │
│  │ Worker    │   │ Router(主Agent)│   │ Policy Engine   │   │ Watchdog     │                          │
│  │ Sessions  │◀──│ 轻量, 无Bash,   │   │ 风险分级/污点/   │   │ (Schedule驱动 │                          │
│  │ 有状态    │   │ 批处理积压事件   │   │ 预算/审批        │   │ 的独立Session)│                          │
│  └─────┬─────┘   └────────────────┘   └─────────────────┘   └──────────────┘                          │
│        │  AgentDriver (统一 trait + 能力矩阵)                                                            │
│  ┌─────▼───────────────────────────────────────────────────────────────────────────────┐              │
│  │ NativeDriver(自带loop) │ AcpDriver(stdio/隧道) │ CodexAppServerDriver │ ClaudeSdkDriver │ ...      │
│  └─────┬───────────────────────────────────────────────────────────────────────────────┘              │
│        │ Tool Host: 内置工具 | MCP 客户端(rmcp) | Skills(SKILL.md) | node.invoke | browser.* | memory.*   │
│        │ Model Router(rig-core + openai_compat 薄客户端) | Credential Broker | Egress Proxy | Memory     │
└────────┼───────────────────────────────────────────────────────────────────────────────────────────────┘
         │  Hub↔Node 协议：JSON-RPC 2.0 双向 + 事件流；ALPN 分流 ctl/evt/blob/screen
         │  传输 trait：WebSocket(v0) → iroh QUIC(v1 默认) → Tailscale/自带 overlay 地址
┌────────▼────────────────────────────  Node：muster-node（同一代码库的精简二进制）  ─────────────────┐
│  只暴露 execute，不存会话状态：exec/pty | fs | agent-host(拉起 claude/codex/opencode… 并隧道其 stdio)  │
│  | browser-host(本机隔离 Chromium/CDP) | screen.snapshot | notifications；本机强制执行审批与沙箱       │
│  Node 本机也可跑在 Hub 同一台机器上（Hub 自身即一个 Node）                                           │
└───────────────────────────────────────────────────────────────────────────────────────────────────────┘
        云档: 云浏览器(CDP URL, steel-browser 自托管) │ 云沙箱 worker(OpenHands agent-server，可选 P2)
```

### 2.2 进程与部署形态

| 形态 | 进程 | 说明 |
|---|---|---|
| 桌面（默认） | `Muster.app/exe`（Tauri 壳）+ `musterd`（sidecar，**独立于 UI 生命周期**，用户级常驻服务）| 关掉窗口，daemon 继续跑定时任务和事件监听（托盘图标）。开机自启：Windows 计划任务/Run 键、macOS LaunchAgent、Linux `systemd --user` |
| 无头 Hub | `musterd --headless` | VPS / 家庭服务器常开；Docker 镜像；一键部署脚本。桌面 UI 与手机都作为 Operator 连接 |
| 附加 Node | `muster-node` | 另一台电脑/NAS/CI 机；`muster-node pair "<code>"` 配对 |
| 云浏览器/沙箱 | 外部服务 | 通过 CDP URL / HTTP 接入，不进核心 |

Hub 与 Node 同一台机器时，Hub 内部以进程内通道直接调用本地 Node 能力模块（`HostNode`），不走网络。

### 2.3 数据面 / 控制面 / 真相归属

- **真相在日志**：domain event journal 与 per-session 日志是唯一事实源；Router/Worker 的模型历史、UI 时间线、Bot 头像状态、收件箱、任务看板都是它们的**投影**。
- **控制命令也是事件**：`steer/fork/interrupt/approve` 先落库得到 `command.*` 事件，再执行；这样可审计、可幂等（`request_id`）、可重放。
- **外部 Agent 的会话日志以其自身为真相**（Codex rollout / Claude jsonl / OpenCode 事件日志）；本项目只存 `backend_ref` + 事件摘要镜像（mirror），需要迁移时才导出。
- **Node 无状态**（除正在运行的进程与小缓冲）：凭据只在 Node/凭据代理侧，模型上下文里只有句柄。

---

## 3. 技术选型结论

### 3.1 选型总表

| 层 | 选型 | 理由 | 备选 / 回退 |
|---|---|---|---|
| 核心语言 | **Rust 2024，tokio**；`serde` + `schemars`（协议 schema 单一来源）| 单二进制 sidecar，Win/Mac/Linux 沙箱 crate 现成；与 Codex、Goose、rmcp、ACP crate、iroh 同栈；协议类型可生成 TS 供 UI 与 Node 共用 | TS 内核（dsh）作 Plan B |
| 事件内核 | 自建：`rusqlite`（bundled，FTS5）+ 专用写线程；每个 Session/Task 为 tokio task + mpsc 邮箱；手写监督（restart with backoff）| 只有 3 类长寿 actor（Router/Worker/Watchdog），不引 actor 框架；避免过早依赖 | 1 周 spike 对比 `ractor`/`kameo`（02 的建议），默认结论是不用；Restate 仅云端控制面可选（BSL，**不进桌面**）|
| LLM 调用层 | **`rig-core`（MIT，20+ provider 含 deepseek/moonshot/zai/minimax/ollama/openrouter）封装在自有 `ModelClient` trait 后**，另备 `openai_compat` 薄客户端（SSE + tool calls，几百行）直连国产/自托管网关 | 不重造 provider 长尾；trait 隔离后可替换。国产模型全走 OpenAI 兼容 | 直接自写 Anthropic/OpenAI/Gemini 三家客户端；goose-providers（Apache-2.0）。【未证实】rig-core 对 Anthropic prompt-cache 断点、流式 tool-call 增量的控制粒度是否够用，列入 M0 spike |
| Agent loop（原生 Worker）| **自写薄 loop**（约 2~3k 行量级），形态参照 pi `agent-loop.ts`（`getSteeringMessages`/`getFollowUpMessages` 两个注入点）与 goose-agent 的"行为是持久化会话的函数"思想 | 原生 loop 必须与我们的 Session 日志/inbox/策略引擎深度耦合；pi 是 TS、goose-agent alpha、rig-ecs 绑 Bevy | goose-agent + rig-core（04 的阶段二）作为后续可替换内核 |
| 外部 Agent 接入 | `agent-client-protocol`（ACP 官方 Rust SDK/schema）+ Codex `app-server-protocol` 类型（pin 版本、`generate-json-schema` 生成绑定）+ Claude 走 `claude-agent-acp` 或官方 Agent SDK | 见 §5 | 手写 control protocol：不做 |
| MCP | **`rmcp` 3.x**（客户端宿主 + 内置服务器）| 对 2025-11-25 与 2026-07-28 两套一致性 100% | — |
| 存储 | **SQLite WAL**（`synchronous=FULL` 仅 journal 库）；`FTS5`；`sqlite-vec` 可选加载；Markdown+git 记忆库；blob 文件 CAS | 单文件、可备份、可迁移；Codex/Claude Desktop/Eigent 同类选择 | Postgres（仅云端 Hub 的可选后端，不优先）|
| 对 UI 通信 | 自有 **WS + JSON 事件协议**（`/v1/ws`），16~32ms 批量下发；UI 禁止直接调 Tauri command | 换壳零返工；PWA/手机同源 | AG-UI/ACP-server 北向适配 |
| Hub↔Node | JSON-RPC 2.0 双向 + 事件流（可映射为 MCP 工具），传输 trait | 与 OpenClaw `node.invoke`、Codex exec-server 同类 | iroh QUIC 为 v1 默认 |
| P2P/传输 | **iroh 1.x**（MIT/Apache-2.0，本地源码 1.4.1）+ 自托管 `iroh-relay`；v0 先 WebSocket | 公钥即身份；约 9/10 直连，其余加密 relay | libp2p（过重）、WebRTC（仅浏览器端点）、Tailscale/Headscale（用户自带 overlay）|
| 桌面壳 | **Tauri 2.12+** | 安装包体积；`src-tauri` 极薄 | Electron / Tauri 3 CEF（alpha）|
| UI | React 19 + TS + Vite + Tailwind + shadcn/ui（含 AI Elements 模式）+ `streamdown` + xterm.js + CodeMirror 6 + `@tanstack/react-virtual` + `@xyflow/react`（分支树/子 Agent 拓扑）+ Rive/SVG（头像）+ assistant-ui（BranchPicker/external-store 运行时，按需）| 生态资产；MCP Apps iframe 宿主 | GPUI/Dioxus/Slint/Flutter：不选（07）|
| 沙箱 | Linux：bubblewrap+Landlock/seccomp；Windows：受限令牌/沙箱；macOS：Seatbelt——**直接 vendoring Codex 的 `linux-sandbox`、`windows-sandbox-rs`、`sandboxing` crate**（Apache-2.0）；重任务可选 Docker/Podman（office-runtime 镜像）| 不重造最难的部分 | 容器优先、无 Docker 回退"受限本地模式"|
| 密钥 | OS 钥匙串（`keyring` crate；参考 Codex `keyring-store`）| — | 加密文件（用户口令）作回退 |
| 终端 | `portable-pty`（ConPTY/PTY）+ xterm.js | Windows 可用 | — |
| 可观测 | `tracing` + 可选 OpenTelemetry 导出；事件日志本身即 trace | 见 §11 | — |
| 序列化/ID | ULID（事件/任务）、UUIDv7（会话）；`blake3` 哈希链 | 可排序 | — |
| Git | 调用系统 `git` CLI 做 worktree/快照（不引入 libgit2）；读操作可用 `gix` | 轻量、行为与用户一致 | — |

### 3.2 "基于谁二开 / 复用哪些库"（明确清单）

结论：**不 fork 整仓**。借鉴 OpenClaw 的协议与概念、DSH 的 Session 语义，**以库的方式复用**可独立的 Rust 组件，内核另起。

| 对象 | 许可 | 处理方式 | 具体取用 |
|---|---|---|---|
| `rmcp`（modelcontextprotocol/rust-sdk）| Apache-2.0 | **依赖** | MCP 客户端/内置服务器 |
| `agent-client-protocol`（运行时）/ `agent-client-protocol-schema` / `-http` | Apache-2.0 | **依赖** | ACP 客户端。【评审已核实】crates.io 运行时 crate 名为 `agent-client-protocol`（独立仓库 agentclientprotocol/rust-sdk；`repos/goose/Cargo.toml` 实际依赖 `agent-client-protocol = 2.2.0`、`agent-client-protocol-http = 2.2.0`、`agent-client-protocol-schema = =1.9.1`）；本地 `repos/agent-client-protocol` 仅含 schema crate 1.15.1 与文档；注意 `repos/rust-sdk` 是 **rmcp（MCP）**，不是 ACP SDK（03 号调研报告该处标注有误）。crate 主版本号 2.x 不等于 ACP 协议 v2。M0 仍需实测 `_session/steering` 等扩展方法的可用性 |
| `iroh` / `iroh-relay` | MIT OR Apache-2.0 | **依赖** | Endpoint、`EndpointHooks::after_handshake` 白名单、relay `AccessControl`+Bearer |
| `rig-core`（+`rig-rmcp` 视情况）| MIT | **依赖**（trait 后）| 多 provider 流式调用 |
| Codex `codex-rs/{linux-sandbox,windows-sandbox-rs,sandboxing,apply-patch,keyring-store}` | Apache-2.0 | **【评审下调】不再按“直接 vendor 即用”规划**。本地 Cargo.toml 核查：这些 crate 依赖 `codex-protocol`、`codex-network-proxy`、`codex-otel`、`codex-exec-server`、`codex-utils-*`、`codex-uds` 等同 workspace 的内部 crate（版本 `0.0.0`，未见 crates.io 发布），vendoring 会拖入一大片 Codex 内部依赖，维护成本接近 fork。**M0 限时 1 天评估三条路**：①git 依赖 + 精简 patch；②只借鉴思路自写 bubblewrap/Landlock 薄封装；③直接调用用户已安装 `codex` 的沙箱子命令/或容器（是否存在待核）。MVP 不依赖任何 OS 级沙箱（见 §10.5）；保留 NOTICE |
| Codex `app-server-protocol` | Apache-2.0 | **pin + 生成绑定**（`codex app-server generate-json-schema`）| CodexAppServerDriver 的类型 |
| Codex `exec-server` 协议（`--remote URL --environment-id`）| Apache-2.0 | **借鉴设计**：Node 出站注册 | Environment 抽象 |
| Goose `goose-roaming`（`ConnectionCard`/`TrustBook`）、`acp/handoff.rs`、`acp/provider.rs` | Apache-2.0 | **读码借鉴**，必要时移植 | 配对名片/信任簿；摘要交接降级 |
| OpenClaw | MIT | **借鉴协议**：Gateway/Node、配对挑战、幂等键、队列四模式、`cron/event-source.ts`、`crates/` 里的 Rust node-host/gateway-client | 不整仓 fork（src 非测试 TS 约 1.43 万文件、60+ CVE、默认沙箱关闭）|
| DeepSeek Harness（dsh，MIT）| MIT | **借鉴语义** + **作为可选外部子 Agent**（其 `acp` profile 可被 AcpDriver 驱动）| Session 日志/fork/closers/steer/Activation；品牌条款：不在产品名中用 "DeepSeek Harness" 全称 |
| `dsh-superagent-prototype` | MIT | 借鉴领域模型 | Source/Trigger/Thread/Eval/Mandate/Ticket/Assignment/Subscription、observe 默认、effect outbox |
| OpenHands SDK | MIT | 借鉴 `parent_id` 树形日志；**可选**云端 worker（P2）| fork 的省空间实现 |
| Eigent | Apache-2.0 | 借鉴 | `Action` 协议、Brain/Hands、`RemoteSubAgentProvider` 事件形状、`ToolSafetyClass/TimeoutScope`、持久收件箱字段 |
| DeerFlow 2.0 | MIT | 借鉴；**可选**作为办公/研究子 Agent 后端服务 | `ChildInputGate` 边界注入+不可信标记、租约定时任务、GitHub binding 显式 opt-in、skills |
| OpenCode | MIT | 借鉴 + **驱动**（`opencode serve`/`acp`）| inbox 持久化、`delivery: steer|queue`、durable 事件 |
| AIRI | MIT | 借鉴 | 语义情绪→渲染器映射范式 |
| `desktop-cc-gui` | **MIT**（评审核实：仓库根 LICENSE，Copyright 2026 zhukunpenglinyutong；其 `THIRD_PARTY_NOTICES.md` 另列第三方依赖，复用具体文件前仍需逐文件核对） | **仅参考结构**；若拷贝须保留版权声明 | `event_sink.rs` 批量下发、`web.rs` 局域网桥、`relay.rs`+Worker 出站中继、`dsh_host.rs`（及其误杀端口进程的教训）、`pet_overlay.rs` |
| Anthropic Skills（docx/xlsx/pptx/pdf）| source-available，禁止复制/派生 | **严禁复制**；自写办公技能 | 仅学写法 |
| RustDesk | AGPL-3.0 | **只借鉴设计** | 能力逐项开关、受信设备只存哈希、并发上限 |
| Skyvern（AGPL）、Pandoc（GPL）、Browserless（SSPL）、NetBird 服务端（AGPL）、Restate（BSL）| 限制性 | 不链接；Pandoc 仅子进程调用 | — |
| Playwright MCP、Chrome DevTools MCP、browser-use、steel-browser | Apache/MIT 等 | **按需拉起的 sidecar / 外部服务** | 远程浏览器 |

### 3.3 与 04 号报告的偏离：为什么不直接用 dsh 做内核

> **【评审提示】** 用户原始诉求 #2 是“基于开源/成熟项目二次开发，而不是从零造轮子”。本节选择自建内核，与该诉求存在张力，评审结论：①MVP 不写原生编码 agent loop（编码全部交外部 Agent，这才是最大的“轮子”）；②内核限定为“journal/outbox/inbox/调度/Driver 监督”的薄层，其余全部库级复用；③M0 闸门把“切换到 DSH 作 Router 内核”保持为一等选项；④此项列为用户待拍板 Q1，最终以用户决定为准。

04 建议"阶段一以 dsh 为内核（Bun/Node sidecar），阶段二再换 Rust 内核"。本文选择**直接用 Rust 自建内核**，理由与风险如下，请用户确认（见 §19 Q1）：

1. **dsh 不是稳定依赖**：官方声明 developer preview 且会有破坏性变更；Cordis 范式社区外几乎无人掌握；上游节奏快（~60 个包，非测试 TS 约 10 万行）。"产品差异化落在内核之外"的前提不成立——我们的差异化（多机 Hub/Node、统一事件网格、策略/凭据、Bot 花名册语义）恰恰需要改内核语义。
2. **轻量与多端诉求**：Bun/Node 打单文件 sidecar 的可行性未验证【未证实】；运行时 + 依赖会显著抬高安装包与常驻内存；Node 又不能进 node-agent/手机共享的协议层。Rust 内核与 Node、协议类型一份代码。
3. **内核其实不大**：需要自写的只有"journal + 投影 + outbox + inbox + 原生 loop + 调度"。原生 loop 参考 pi（约 2.5k 行）；重活（编码）交给外部 Agent，原生 Worker 在 v1 只承担办公/研究/调度类任务。工作量被外部 Agent 生态摊薄。
4. **保留 dsh 的全部价值**：语义直接移植（§4）；运行时上 dsh 可作为"又一个 ACP 子 Agent"被驱动，随时可用。
5. **止损闸门**：M0 的 2 周 spike 若满足任一条件则切换到 Plan B（dsh sidecar 内核，对外协议不变）：(a) 原生 loop + journal + 重启恢复 + steer/fork 全链路在 3 周内做不到可演示；(b) rig-core 无法满足流式 tool-call/缓存控制且自写 openai_compat 也过于耗时；(c) Windows 上 sidecar/沙箱集成出现阻断问题。由于**UI 只依赖自有 WS 协议**，换内核对前端无感。

---

## 4. 核心运行时设计

### 4.1 内核并发模型

```
                 ┌─────────────── musterd 进程 ────────────────┐
 Source 适配器 ─▶│ ingress_tx (mpsc)                             │
 Operator WS  ─▶│                                               │
 Driver 事件  ─▶│       ┌──────────────┐                        │
 Node 事件    ─▶│       │ KernelActor  │ 单线程命令处理器          │
                │       │  (唯一写者)   │ apply(cmd)->txn:        │
                │       └──┬───────┬───┘  1.追加 events           │
                │          │       │      2.更新投影              │
                │  Journal │       │      3.入 effect outbox     │
                │  writer  │       │   提交后:                    │
                │  thread  │       │   a.广播给订阅者(按 seq)      │
                │          │       │   b.唤醒 SessionTask 邮箱     │
                │          ▼       ▼   c.EffectWorker 执行副作用   │
                │   SQLite(WAL)   SessionTask × N (Router/Worker/  │
                │   读连接池(只读)  Watchdog/ExternalProxy)        │
                └───────────────────────────────────────────────┘
```

- **单写者**：所有对 journal 库的写由一个专用线程串行执行（`rusqlite` 连接，批量 group-commit，`synchronous=FULL`）；读走只读连接池（WAL 并发读）。命令处理 `apply(cmd) -> Vec<Event>` 在**一个事务内**完成"追加事件 + 更新投影 + 入 effect 队列"，提交后才广播与执行外部副作用（发消息、拉进程、调模型、写文件）。直接移植 SuperAgent 原型的 `Effects/afterCommit`。
- **SessionTask**：每个活跃 Session 一个 tokio task + 有界 mpsc 邮箱（inbox 的内存镜像，真相在 `session_inbox` 表）。同一 Session 至多一个 Activation，天然串行（actor 语义）。监督：崩溃按指数退避重启；超过阈值转 `failed` 并发 `session.failed` 事件。
- **背压**：邮箱有界；Collect 模式去抖合并；Operator 订阅按 seq 游标消费，慢客户端不会阻塞内核（被丢弃后重连用 `from_seq` 补发）。
- **关机/崩溃**：见 §4.12。

### 4.2 事件模型

**两类日志，分工明确**（采纳 02 §5.2-3）：

| | Domain Event Journal（`event` 表）| Session Log（`session_event` 表）|
|---|---|---|
| 内容 | 触发、决策、任务、设备、审批、策略、预算、通知——业务事实 | 某个 Agent 会话内部的消息/步骤/工具调用/压缩 |
| 谁读 | 内核、UI 收件箱、审计、Router | 该 Session 的模型上下文投影、UI 时间线 |
| 序号 | 全局单调 `seq` | 会话内连续 `seq`（可有父前缀）|
| 外部 Agent | 全量（含回调通知）| 仅摘要镜像（`mirror.*`）|

**事件信封**（Rust，schemars 生成 JSON Schema 与 TS 类型）：

```rust
pub struct Event {
    pub id: EventId,                  // ULID
    pub seq: u64,                     // 全局单调，由 journal 在提交时分配
    pub ts: Timestamp,                // UTC，毫秒
    pub kind: EventKind,              // 判别联合，见下表；wire 上为 {"kind":"user.message","data":{..}}
    pub source: Source,               // { type: "ui"|"cron"|"github"|"channel"|"agent"|"device"|"system", id: String }
    pub idem_key: Option<String>,     // 来源原生 ID；UNIQUE(source, idem_key) 保证幂等
    pub actor: Actor,                 // Human{operator_id} | Agent{session_id} | Device{device_id} | System
    pub trust: Trust,                 // Principal | Delegated | Untrusted  （见 §10.3 污点）
    pub thread: Option<ThreadKey>,    // "{source}:{native_id}"，如 "github:o/r#pr/123"
    pub task: Option<TaskId>,
    pub session: Option<SessionId>,
    pub cause: Option<EventId>,       // 因果链（这个事件由谁引起）
    pub trace: TraceCtx,              // trace_id/span_id，贯穿 UI→内核→Driver→Node
    pub prev_hash: [u8; 32], pub hash: [u8; 32],   // blake3 哈希链（审计）
    pub payload_ref: Option<BlobRef>, // 大载荷溢出（Inline & Spill）
}
```

**EventKind 全集（v1）**——"一切触发皆事件"的具体落点：

| 族 | kind | 说明 / 关键载荷 |
|---|---|---|
| 用户 | `user.message` `user.steer` `user.interrupt` `user.approve` `user.takeover` | 用户输入**只是一种触发**，UI 看到的是投影。`user.steer` 带 `mode: steer\|followup\|collect\|interrupt`、`expected_turn_id`、`request_id` |
| 定时 | `schedule.fired` | `schedule_id`、`fire_time`；idem_key=`schedule_id@fire_time`（错过补跑策略 skip/once/all）|
| 外部 | `github.pull_request.*` `github.review.*` `github.check_run.*` `github.issue_comment.*` | idem_key=`X-GitHub-Delivery`（webhook）或 `event_id`（轮询）；`trust=Untrusted` |
| 渠道 | `channel.im.message` `channel.email.received` | 飞书/钉钉/微信/邮件（P1）；`Untrusted` 除非发送者在白名单 |
| 子 Agent 回调 | `session.turn_started` `session.turn_ended{reason}` `session.idle` `session.failed` `session.needs_input` `session.background_finished` `session.child_spawned` | **回调通知即事件**，与上面同构，同样走订阅直通/Router |
| 审批 | `approval.requested` `approval.resolved` `approval.expired` | 见 §10.2 |
| 任务 | `task.created` `task.updated` `task.reported{state,summary}` `task.ended` `attention.raised` `attention.cleared` | 任务生命周期独立于 Agent 状态；Agent 只"上报" |
| 控制 | `command.steer_accepted` `command.fork_created` `command.interrupt_applied` `command.rejected{reason}` | 每个控制命令的落账与结果 |
| 设备 | `device.pair.requested` `device.pair.resolved` `device.online` `device.offline` `device.caps.changed` | 并入同一总线；Node 上线可触发"等待该设备的任务" |
| 浏览器 | `browser.download` `browser.dialog` `browser.crash` `browser.takeover.requested/granted/released` | 由 Node 上报 |
| 策略/预算 | `policy.changed` `budget.warning` `budget.exceeded` `loop.detected` | 预算/循环检测见 §11 |
| 监控 | `watchdog.alert` | 由 Watchdog Session 产生 |
| 记忆 | `memory.proposed` `memory.committed` `memory.rejected` | 记忆写入也走事件，可审计 |

约束：
1. 事件**不可变**；更正通过追加新事件。`payload` 对内核大多不透明（来源原生数据），内核只解析信封与少数控制类事件。
2. 大载荷（日志、截图、大 diff、网页快照）写 blob CAS，事件中只留 `BlobRef + 摘要`（Inline & Spill）。
3. 审计哈希链覆盖 domain journal 全部事件；`muster audit verify` 校验。

### 4.3 数据流：从触发到完成

```
 (1) 触发 ──▶ Source 适配器规范化 ──▶ Ingress：幂等(source,idem_key) → 信任标注 → append
 (2) 快路径（代码）：
       - 该 thread 已被某 Task 订阅(mode=owner|context)? ─是─▶ 订阅直通：写入对应 Session 的 inbox，不经 Router
       - 命中静态规则(丢弃机器人评论/去重/节流)? ─▶ 记录 dropped，结束
       - 否则 ─▶ 进入 thread.pending（等待 Router 批处理）
 (3) 慢路径：Router Session（轻量）被唤醒，批量读取积压 Trigger，调用其少量工具：
       route_to_task / create_task(+选Bot、选后端) / attach(订阅) / reply_to_user / note / ask_user / ignore
 (4) Worker Session 被激活(Activation)：从 inbox 取输入 → 跑 turn → 工具调用经 Policy Engine → Hands 执行
 (5) Worker 上报 task.reported / 回调事件 ──▶ 回到 (1)，由订阅或 Router 决定是否打扰用户 / 继续派发
 (6) NotifyGate 决定是否推送给用户（§4.9）
```

关键性质：**用户输入、Cron、GitHub PR、子 Agent 回调**在 (1) 之后完全同构，没有任何特殊通道。

### 4.4 Router（主 Agent）

- 本质：一个常驻 Session（`role=router`），**无 Bash、无文件写**，只有少量调度工具；负责 (a) 对人对话（"主线程"，像 Muse 的 Main chat / 联系人式界面）；(b) 批处理积压 Trigger 并分派。
- 工具集（硬编码白名单）：`task.create/attach/route/end`、`agent.list/message/interrupt/fork`、`bot.create/select`、`reply`、`ask_user`、`note`、`ignore`、`schedule.create`（需审批）、`memory.search`（只读）、`read_status`。
- **模型路由**：对话用中档模型；批处理 triage 与心跳用小模型且**不带全量上下文**（只给 Trigger 摘要 + 任务/Bot 简表），成本透明（§11）。
- **规则优先、LLM 兜底**：去重、机器人过滤、已订阅直通、静态路由（"某仓库的 PR → Bot X"，存于 `source_binding`）全在代码里；只有无法判断的才进 LLM（SuperAgent 的快/慢路径）。个人场景早期甚至可以让"首次遇到的新来源"由用户一次性确认并固化为 binding。
- 批处理：同一 thread 的积压事件合并为一次 Eval（`thread.evaluating` 至多一个，`pending` 累积，Eval 结束再取下一批）。
- Router 自身受预算约束（单批 token 上限、单日上限），超限降级为"只记录、等待用户"。

### 4.5 Bot / Task / Session / Activation 的模型

四个实体，避免把"一个对话"混同"一个会话"（呼应 SuperAgent 文章 §8.2）：

```
Bot（UI 花名册的一等公民，有身份）
  ├─ id, name, avatar_spec, persona(SOUL 片段), backend 绑定(native|claude|codex|opencode|…)
  ├─ 默认设备/工作区、记忆作用域、默认权限档位、预算
  └─ 一个"主线 Session" + 任意个"侧线/分支 Session"
Task（授权的工作单元；状态独立于 Agent）
  ├─ mandate(不可变)：{autonomy: observe|ask|auto, scope{paths,devices,domains}, budget, policy_version, basis}
  └─ state: open | waiting | ready | blocked | failed | ended
Session（有状态的 Agent 会话 = 持久日志；可冷恢复）
  ├─ role: router | worker | watchdog | subagent
  ├─ backend + backend_ref（外部 Agent 的 thread/session id）
  ├─ parent_session / forked_from(session, seq) / worktree
  └─ state: idle | running | waiting_approval | waiting_input | waiting_child | parked | failed | archived
Activation（一次进程内/远端的"常驻执行"，易失）
  ├─ 取消/清理只作用于 Activation，Session 保留并可再次激活（dsh 的 Activation 与 Session 分离）
  └─ 受 ActivationPool 限制（默认同时活跃 8 个；本机/远程共用；超限以 ACTIVATION_LIMIT_REACHED 拒绝或排队）
```

- Task↔Session 通过 `assignment` 多对多、可更换（Worker 换后端不换任务）。
- **子 Agent 深度**：默认 `maxDepth = 2`（Router → Bot Worker → 一层 helper）；外部 Agent 默认是叶子（其内部子 Agent 只镜像可见，不接管）。
- **订阅与授权分离**：`subscription(thread → task, mode)` 只授予上下文；`mandate` 才授予权限。订阅直通是代码行为，不经 LLM。
- **默认 `autonomy=observe` 的主动行为**：来自外部来源（GitHub、IM、定时的"自作主张"）的行动，首发只记录"would-do"，用户按来源白名单逐步放到 `ask`/`auto`（SuperAgent 的 speculative observe 默认）。

Session 状态机（只展示关键边）：

```
idle ──inbox有项──▶ running ──工具需审批──▶ waiting_approval ──approval.resolved──▶ running
running ──ask_user──▶ waiting_input ──user.message──▶ running
running ──等待子Agent(显式wait)──▶ waiting_child ──child回调──▶ running
running ──turn.end──▶ idle ──空闲超时──▶ parked(释放Activation; 日志保留)
parked/idle ──新inbox──▶ (冷恢复/新Activation) ──▶ running
任意 ──不可恢复错误/监督超限──▶ failed ──用户或Watchdog重试──▶ idle
```

### 4.6 Session Log 与上下文投影

采纳 DSH 的"**日志是真相，模型视图是投影；凡模型可见必已记录**"。

- `session_event.type`：`system/message` `developer/message` `user/message` `assistant/message` `tool/call` `tool/result`（带 `surfaceOp: append | replace{start_seq,end_seq}`）；执行类 `turn/start` `step/start` `step/end` `turn/end{reason}`；控制类 `steer/accepted` `interrupt` `approval/…`；`session/end-seed`（fork 继承段的结束标记）；`compaction/replace`。
- **压缩 = 一条 `replace` 事件遮蔽旧节点，原日志保留**（`source_seqs` 必须覆盖所有被遮蔽节点）。人类时间线读 append 事件；模型读 surface。
- **Inline & Spill / Chain of Recall**：大于阈值的工具输出写 blob，上下文中只放摘要 + `spill://<ref>`；提供 `recall(ref, query|range)` 工具按需取回。压缩/摘要事件保留指向原始事件的回指，使"回忆"可追溯。
- **外部 Agent 镜像**：`mirror.message` `mirror.tool` `mirror.turn` 等，只存摘要（≤2KB）+ `blob_ref`（需要时才抓全文）；真相在其自身日志，由 `backend_ref` 定位。

### 4.7 插话（Steer / Followup / Collect / Interrupt）

沿用 OpenClaw 队列模式词汇与 Codex 的乐观并发：

| 模式 | 语义 | 原生 Worker 的实现点 | 外部 Agent 映射（经 Driver 能力矩阵）|
|---|---|---|---|
| `steer` | 注入**当前 turn 的下一步**；需 `expected_turn_id`，不匹配则降级为 `followup` 并返回 `command.rejected{stale_turn}` 提示 | loop 在每批工具执行完成、下一次调用模型前调用 `inbox.take_steer()`（pi 的 `getSteeringMessages` 同位点）；以 `user/message{steer:true}` 追加；对 DeerFlow 式"不可信输入"在边界处加标记 | Codex `turn/steer{expectedTurnId}`；Claude 流式输入 `priority:"next"` / `claude-agent-acp` 的 `_session/steering`；OpenCode `delivery:"steer"`；无 → 降级 |
| `followup` | 下一个 turn 开始时消费；空闲则立即开新 turn | loop 想停时 `take_followups()`（pi `getFollowUpMessages` 同位点）| Claude `priority:"later"`、Codex `thread/queue`/`turn/start`、OpenCode `delivery:"queue"`；无 → Core 侧排队等 `idle` |
| `collect` | 去抖窗口（默认 500ms，cap 20，超出 summarize）内多条合并成一条 followup | `collect_buffer` | 合并后按 followup |
| `interrupt` | 取消当前 turn；`keep_inbox` 可选；即发即返 | `CancellationToken` 向模型流与工具传播；未完成 step 补合成 tool result；发 `turn/end{reason: interrupted}` | Codex `turn/interrupt`；Claude `interrupt()`（返回 `still_queued`，可 `cancel_queued`）；ACP `session/cancel` |

规则：
1. **所有插话先落库**（`user.steer` → `command.steer_accepted`），ack 在 flush 之后；`request_id` 幂等。
2. 已被认领的 inbox 项不重复入队；中断保留未认领 inbox 与已发布的后代 Session（dsh `interrupt` 语义）。
3. 授权：`interrupt/steer` 可由"人"或"存活的祖先 Agent"或"Watchdog"发起（Watchdog 权限仅限 steer/interrupt/retry，不能改文件）。
4. 降级必须**向用户显性展示**（"硬插话：已取消并重新提示"），避免静默行为差异。
5. 运行中输入框永不禁用；Stop 与"等待审批"区分。

### 4.8 分支（Fork）

**原生 Session：前缀共享的树形分支**（OpenHands `parent_id` 思想 + DSH 悬空补全）：

```rust
pub struct ForkRequest {
    pub source: SessionId,
    pub at: ForkPoint,                 // Seq(u64) | Turn(TurnId) | Latest
    pub open_tail: OpenTailPolicy,     // CloseWithSyntheticResults(默认) | Reject
    pub workspace: WorkspacePolicy,    // NewWorktree(默认,写类任务) | Share(只读任务) | Snapshot
    pub backend: Option<BackendKind>,  // 默认同后端
    pub request_id: RequestId,         // 幂等
}
```

算法（`fork(source, at)`）：
1. 校验 `at`：边界必须是事件边界；前缀不得结束在开放 turn 内——若在，则按 `open_tail` 处理：默认**闭合**，不是拒绝。
2. 新建子 Session：`forked_from_session/seq`，`inherited_count`；**不复制事件**，读取视图 = 沿 `forked_from` 链走到根，取各自前缀 + 自己的事件（O(1) 创建；链深度超过 N（默认 8）时后台物化一次）。
3. 子日志的前几条自有事件：`session/end-seed{inherited:true}`，随后 `openTurnClosers`：对悬空 step 补**合成 tool result**（`TOOL_NOT_STARTED` / `TOOL_OUTCOME_UNKNOWN`，措辞明确"父会话可能在切点之后已执行该调用，重试前请检查幂等性/外部状态"），补 `step/end`、`turn/end{reason: forked}`。**崩溃恢复复用同一算法，只是 cause 不同。**
4. **文件系统隔离是 fork 的一部分**：需要写入的分支默认 `git worktree add`（分支名 `muster/<bot>/<fork-id>`）；Share 仅用于只读。所有主流编程 Agent 的 fork 都只分历史不分文件（03、02 已确认）。
5. **副作用账本**：`side_effect_ledger(effect_id, session_id, kind, target, status, inherited_from)`；fork 继承父账本并标记 `inherited`，**不会重放**；对相同 `(kind,target)` 的重复发送在 Policy Engine 处触发"重复副作用"提醒/拒绝，防止分支重复发邮件、重复开 PR。
6. Prompt cache 经济性：fork 尽量保持请求前缀字节级不变（模型路由、system、工具定义顺序稳定），Anthropic 类 provider 在前缀末尾设缓存断点。

**外部 Agent 分支**：走其原生接口（Codex `thread/fork{lastTurnId, ephemeral}`；Claude `forkSession({upToMessageId})`；OpenCode `fork{before}`；ACP `session/fork`(unstable)）；返回新的 `backend_ref`；能力不足降级为"会话级 fork"或"新会话 + 摘要交接"（Goose `handoff.rs` 思路），并在 UI 上标注降级。外层仍统一做 worktree 与副作用账本。

**Checkpoint**：
- `checkpoint = { id, session_id, seq, workspace_ref, ledger_hwm, label, auto }`。
- 对有写类工具的 Session，**每个 turn 开始自动打点**；`workspace_ref` 是隐藏 ref `refs/muster/ckpt/<id>` 指向的快照提交（临时 index + `git write-tree/commit-tree`，不污染用户分支）；非 git 目录 v2 再做（按编辑钩子记录触碰文件的写时复制）。
- 回退 = "以该 checkpoint 为 `at` 的 fork + 恢复工作区"，或原地 `revert`（需确认）。UI 的"从此处分支"、分支选择器、分支树都落在这一原语上。

### 4.9 回调通知与打扰门槛

子 Agent → 主 Agent/用户的路径：

1. 子 Session 产生 `session.turn_ended / needs_input / failed / background_finished` 事件。
2. **订阅直通**：父 Session（或拥有该 Task 的 Worker）的 inbox 收到 `child_report`，投递模式由规则决定：父空闲 → `followup`（立即开 turn）；父运行中且事件为 `needs_input/failed` → `steer`；纯进度 → `collect`。
3. **NotifyGate**（打扰用户的门槛，借鉴 Muse）：默认只在 (a) 需要人决定（审批/问题/blocked）、(b) 任务到达 ready 且有新产物、(c) 失败且重试耗尽 时通知；其余只更新 Feed/头像状态。门槛 = 规则 + 小模型打分，可按 Bot 调松紧。
4. 外部子 Agent 想主动联系主 Agent：通过注入的 **MCP 工具** `muster.notify_parent / muster.spawn_peer / muster.emit_event`（§5.5），事件带该 Session 的 token，内核知道调用者身份与作用域。

### 4.10 定时与外部触发

- **Schedule**：`schedule(id, target(bot|task|router), cron/interval, payload, catch_up: skip|once|all, enabled)`；内核维护下一次触发时间的最小堆；触发 = 追加 `schedule.fired` 事件（idem_key 含触发时间，重启补触发不重复）。定时指令投递到已有 Session 或新建 Session（dsh `schedule` 同款）。
- **GitHub**：本地无公网入口，所以默认**轮询**（Notifications/Events API + ETag，节流）；可选"出站中继 webhook"（Worker 收 webhook → 经 Hub 的出站 WSS 转发）。**binding 显式 opt-in**（DeerFlow 做法）：仓库/事件类型 → Bot 的 `source_binding`；`Untrusted` 默认；PR 正文/评论内容永不当指令执行，只作为数据。
- **IM**（P1）：飞书/钉钉/微信 Source 适配器；发送者白名单；回复通道记录在 `task.channels`。
- **fs-watch**、**设备上线**（`device.online` 可唤醒等待该设备的任务）均为 Source。

### 4.11 Watchdog

由 `schedule.fired` 驱动的独立 Session（`role=watchdog`）：输入是各 Task 的进度快照事件（最后事件时间、token/成本、重复调用计数），可执行 `steer/interrupt/retry` 与 `attention.raise`；无写文件/执行权限。检测：卡死（无事件超过阈值）、循环（`loop.detected`：相同工具+参数重复 N 次）、预算逼近、"进度谎报"（声称完成但无产物/测试证据——交由规则校验：`task.reported{ready}` 必须附产物引用，否则退回）。

### 4.12 崩溃恢复与一致性

- 启动序：打开 journal → 校验哈希链尾 → 扫描 `effect` outbox 重放未完成项（指数退避；`(kind,key)` 主键去重）→ 对状态为 `running` 的 Session 写 `turn/end{reason: crashed}`（共用 §4.8 的闭合算法）→ 外部 Agent 通过 `backend_ref` 探活并 `resume`；Node 持有的进程重连后用 `task.resume(last_event_seq)` 补拉 → 按 `resume_on_crash` 策略决定是否自动续跑（默认：发恢复说明给 Session 并等待用户/任务策略）。
- 已知缺口（承认）：已被接受但未落库的 inbox 消息在崩溃时可能丢失——本设计把"先落库后 ack"作为硬约束，将窗口压到 0（代价是 ack 延迟 1 次 fsync）。
- Lease：`lease(resource, holder, expires)` 用于 Activation（尤其 Node 上的 Activation）与 Schedule 单实例触发。

---

## 5. 外部 Agent 适配层

### 5.1 统一抽象：`AgentDriver`

采纳 03 的混合方案：**ACP 为南向主干；内部 canonical 事件/命令；Codex 与 Claude 在 ACP 不足处走原生 Driver**。所有 Driver 把外部事件翻译为 canonical `AgentEvent`，再由内核写入 `session_event(mirror)` + `event`（回调通知）。

```rust
#[async_trait]
pub trait AgentDriver: Send + Sync {
    fn kind(&self) -> DriverKind;                                   // Native | Acp | CodexAppServer | ClaudeSdk | OpenCodeHttp
    async fn connect(&self, spec: DriverSpec, env: EnvHandle) -> Result<Connected>; // 握手+能力探测
    async fn start(&self, spec: SessionSpec) -> Result<BackendRef>;
    async fn resume(&self, r: &BackendRef) -> Result<()>;
    async fn fork(&self, r: &BackendRef, at: ForkAt) -> Result<BackendRef>;       // 能力不足返回 Unsupported，由 Core 降级
    async fn send(&self, r: &BackendRef, input: Input, mode: Delivery,
                  expected_turn: Option<TurnId>) -> Result<Accepted>;              // Steer|Followup|Collect|Interrupt
    async fn interrupt(&self, r: &BackendRef, keep_inbox: bool) -> Result<()>;
    async fn respond_permission(&self, r: &BackendRef, id: PermId, d: PermDecision) -> Result<()>;
    async fn set_mode(&self, r: &BackendRef, mode: AgentMode) -> Result<()>;
    fn events(&self, r: &BackendRef) -> BoxStream<'static, AgentEvent>;
    fn caps(&self) -> &DriverCaps;
    async fn close(&self, r: &BackendRef) -> Result<()>;
}

pub struct DriverCaps {
    pub steer: Support, pub queue: Support, pub interrupt: Support,
    pub fork: ForkSupport,              // None | Session | AtMessage | AtTurn
    pub background: bool, pub subagent_sessions: bool, pub resume: bool,
    pub permission_remember: bool, pub plan_events: bool, pub diff_events: bool,
}
```

`AgentEvent`（canonical，ACP `session/update` 的超集）：`MessageChunk/ThoughtChunk/Plan/Usage/SessionInfo`、`ToolCall{id,kind,title,status,input,content,locations}`（**upsert 语义**，对齐 ACP v2）、`PermissionRequest/Resolved`、`Elicitation`、`TurnStarted/TurnEnded{reason}/Idle/Error{retryable}`、`SubAgentSpawned/Updated`、`Forked`、`BackgroundTaskStarted/Updated/Ended`、`Diff`。每个事件带 `agent_id, session_id, parent_session_id?, seq, ts, origin`。

### 5.2 Driver 选择与具体接入

| 外部 Agent | Driver | 接入方式 | 备注 |
|---|---|---|---|
| **Codex** | `CodexAppServerDriver`（首选）；`AcpDriver(codex-acp)` 作快速通道 | `codex app-server`（JSON-RPC，stdio；远程时隧道）。`thread/start|resume|fork`、`turn/start|steer|interrupt`、审批反向请求、`item/*` 事件、diff/plan | pin 版本 + `generate-json-schema` 生成绑定 + 握手校验 `userAgent`；WS 传输标注 experimental，不裸露端口；`clientInfo.name` 需向 OpenAI 登记【待办】|
| **Claude Code** | `AcpDriver(claude-agent-acp)`（默认）；`ClaudeSdkDriver` 在需要 hooks/`rewindFiles`/`priority:now` 时启用 | `CLAUDE_CODE_EXECUTABLE` 指向**用户本机已登录的官方 `claude`**；可选 API Key / Bedrock / Vertex | 合规见 §5.4；UI 称 "Claude Agent"，不用 Claude Code 商标/吉祥物 |
| **OpenCode** | `OpenCodeHttpDriver` 或 `AcpDriver(opencode acp)` | `opencode serve`（HTTP+SSE+OpenAPI；inbox/`delivery`/fork/durable 事件）| 形状最接近 SuperAgent；BYOK，合规风险最低，**默认内置推荐** |
| **Goose / Cline / Gemini(agy) / Copilot / Qwen / Kimi …** | `AcpDriver` | 原生 `--acp`/`acp` 子命令；从 ACP Registry（`cdn.agentclientprotocol.com/registry/v1/latest/registry.json`）拉取画像与分发信息 | 长尾；Gemini CLI 个人用户已迁往 Antigravity CLI（`agy`）|
| **dsh** | `AcpDriver`（`dsh --profile acp`）| 作为"又一个 ACP 子 Agent"，可用于验证我们与其语义对齐 | — |
| **OpenHands / DeerFlow（云端 worker，P2）** | `AcpDriver`（`openhands acp`）或 HTTP | 办公/研究沙箱后端 | 可选 |
| **原生 Worker** | `NativeDriver` | 自带 loop，同一 trait | 办公/研究/调度类任务 |

**【评审】适配器运行时分发（原稿遗漏）**：`claude-agent-acp` 是 npm 包（依赖 `@anthropic-ai/claude-agent-sdk`），需要 Node；`codex-acp` 为 Rust 二进制；`opencode` 自带运行时；Playwright MCP 亦需 Node。与“安装包 ≤60 MB、单二进制”并不冲突的前提是：**首次使用时由 `musterd` 下载固定版本的 Node + 适配器到应用数据目录（`runtimes/`），校验哈希，不依赖用户系统 `npx`**；ACP Registry 的 distribution 字段仅用于长尾 agent 的发现。M0 验证：下载体验、Windows 路径/杀进程树、离线与企业代理环境。安装包体积口径明确为“不含按需下载件”。

### 5.3 能力矩阵与降级（Core 侧统一执行）

| 请求 | 原生支持 | 降级路径 |
|---|---|---|
| steer | Codex `turn/steer`、Claude `priority:next`/`_session/steering`、OpenCode `delivery:steer`、Native | `interrupt` 后带上下文重新 prompt（标记"硬插话"）|
| followup/queue | Codex、OpenCode、Claude `later`、Native | Core 侧排队，等 `Idle` 再 `send` |
| fork@message/turn | Claude `upToMessageId`、Codex `lastTurnId`、OpenCode `before`、Native | 会话级 fork（ACP unstable）→ 摘要交接新会话 |
| interrupt | 全部 | — |
| 子 Agent 可见 | Claude/Codex/OpenCode child session、Native | 当作不透明工具 |
| 权限"记住" | 各自语义不同 | **所有审批上收**到 Core 策略引擎；**【评审修订】Agent 内部 `bypass/yolo` MVP 一律禁止**；git worktree 只保证文件不互相覆盖，**不是安全隔离**（agent 仍可读写 worktree 之外的路径）。仅当存在真正的沙箱（Codex 自带 sandbox 模式 / 容器，P1）且路径被限制在 worktree 内时，才允许对该 Bot 开启 bypass |

### 5.4 合规姿态（产品设计阶段即确定）

1. 默认让用户在自己的机器上安装并登录官方 `claude`；**本产品不接触、不存储、不中转订阅 OAuth token**，不代付、不转售用量。提供 API Key / Bedrock / Vertex 选项，不内置共享 Key。
2. 不修改 Claude Code 二进制，不移除其内置认证；产品命名/Logo 不使用 Claude Code/Anthropic 标识。
3. Codex：走官方 app-server 集成面；`clientInfo.name` 登记；第三方分发条款需法务确认【未核查】。
4. 默认内置推荐的是 OpenCode/Goose/Cline 等 BYOK Agent（合规风险最低），Claude/Codex 作为"已安装则自动出现"的一等 Bot。
5. **【评审】灰区说明**：`claude-agent-acp` 构建于 Agent SDK 之上，而 Anthropic 条款要求“使用 Agent SDK 开发产品/服务的第三方应使用 API Key、不得提供 claude.ai 登录或路由订阅额度”；“不限制终端用户登录未修改的 Claude Code 二进制”的豁免是否覆盖“第三方应用经 SDK 适配器驱动用户已登录的二进制”**未证实**。因此：验收与演示默认走 API Key / Bedrock / Vertex；订阅模式默认关闭，经合规 Gate（PRD P0-31）显式确认，并在法务确认前不作为宣传点。UI 来源标注允许纯文本“Claude Code/Codex”，不使用其 Logo/吉祥物，不进产品名。

### 5.5 反向通道：把本产品能力暴露给子 Agent

- 在每个子 Agent 的 `session/new.mcpServers`（Codex 另有 `dynamic_tools`、OpenCode 另有 `POST /api/mcp`）注入 **`muster-mcp-bridge`**——一个由 `muster` 二进制提供的 stdio MCP 服务器，经本地 socket/命名管道连 `musterd`，使用**该 Session 专属 token**。工具：`notify_parent`、`ask_user`、`spawn_peer`、`emit_event`、`memory.search/write(proposed)`、`browser.*`、`device.list/exec`、`task.report`。
- token 决定调用者身份与 scope：Policy Engine 对这些调用同样做风险分级；这是外部 Agent 回调主 Agent 的标准、与具体 Agent 无关的通道（OpenClaw `mcp serve`、Codex message-board-mcp 同款思路）。
- 目录/文件隔离：Driver 在 Node 上以 `cwd=worktree` 启动；`.git` 之外的路径通过 Node 侧沙箱策略限制。

### 5.6 远程外部 Agent（与多机统一）

`AgentHost` 是 Node 的一种 capability：Node 在本机 spawn `claude-agent-acp` / `codex app-server` / `opencode acp`，并把其 **stdio 作为字节流隧道**回 Hub（Hub 侧 `AcpDriver` 把隧道当作 transport）。这样"连接多台电脑"与"驱动子 Agent"是同一抽象：本地用 stdio，远程用 Node 隧道（对齐 ACP 远程传输 RFD 的方向，落地后可切换为标准 WS）。

可靠性：Node 为每个 Agent 进程维护带序号的帧环形缓冲（内存 + 溢出到磁盘，上限 64MB）；Hub 断线重连时 `task.resume(last_seq)` 补拉；Hub 超时未重连的进程按策略挂起/终止（默认保留 15 分钟）。

---

## 6. 工具与 MCP 体系

### 6.1 统一 Tool Host

所有工具（无论来源）在 Tool Host 里是同一接口，必须声明**风险分级**与**执行位置**：

```rust
pub struct ToolSpec {
    pub name: String,                 // 命名空间: fs.read / shell.run / browser.click / mcp:<server>.<tool> / agent.spawn …
    pub schema: JsonSchema,
    pub risk: RiskClass,              // 见 §10.1
    pub place: Place,                 // Hub | Node(DeviceSel) | Cloud
    pub timeout: TimeoutScope,        // call / turn / wall-clock 三级（Eigent TimeoutScope）
    pub idempotent: bool,             // 影响 fork/重放与重试
    pub effect: Option<EffectKind>,   // 对外副作用类型（进入 side_effect_ledger）
}
#[async_trait] pub trait Tool { fn spec(&self) -> &ToolSpec; async fn call(&self, ctx: ToolCtx, args: Value) -> ToolResult; }
```

工具来源：

| 来源 | 说明 |
|---|---|
| 内置（Rust）| `fs.read/list/search/write/patch`（patch 用 vendored `apply-patch`）、`shell.run`（PTY）、`web.fetch`（经 Egress Proxy）、`agent.*`（spawn/send/wait/interrupt/fork/list）、`task.*`、`schedule.*`、`memory.*`、`notify`/`ask_user`、`recall`、`artifact.present`（交付回执，DeerFlow `present_files` 思想）|
| MCP 客户端（rmcp 3.x）| stdio + Streamable HTTP；`2026-07-28` 与旧版双栈（`server/discover` 与 `initialize` 回落）；OAuth（受保护资源元数据→CIMD→DCR 回落，`iss` 校验）；MRTR `input_required` 映射到 `ask_user`；Roots/Sampling 已弃用，不实现 |
| Skills | `SKILL.md` + 渐进披露（agentskills.io 标准），读取 `~/.agents/skills` 与 `.claude/skills`；脚本在沙箱执行；技能清单声明所需权限；首批自写办公技能（文档读取转换、Word、Excel、可编辑 PPTX、PDF、深度研究+引用、文件整理、数据可视化），**严禁复制 Anthropic 四件套** |
| Node 能力 | `node.invoke(device, command, args)` 暴露为带 `device` 参数的工具（`device.exec`、`device.fs.*`、`device.screen.snapshot`…）|
| 浏览器 | `browser.*`（§8）|

### 6.2 Router 与 Worker 的工具集差异

- Router：白名单极小（§4.4），无执行类工具。
- Native Worker：由 Bot 配置 + Mandate.scope 裁剪；默认只读 + 受限写，执行类默认 Ask。
- 外部 Agent：用它们自带的工具集；我们只通过审批上收、沙箱、MCP 注入影响其行为。

### 6.3 MCP Apps 与 UI 工具

UI 作为 MCP Apps 宿主（`ui://` 预取 + 沙箱 iframe + CSP/permissions 审核 + postMessage JSON-RPC 桥），用于第三方工具自带交互 UI。**审批卡、凭据保险箱、权限变更不得由 MCP Apps 渲染**——必须是原生确定性 UI。

### 6.4 工具结果的不可信处理

一切来自网页、PR、邮件、MCP 的内容在上下文中带 `untrusted` 包裹标记；会话因此被标记为 tainted（§10.3）。DeerFlow 的 `ChildInputGate` 思路：插话与子 Agent 回报在 turn 边界注入且标注来源。

---

## 7. 多设备拓扑与协议

### 7.1 角色（采纳 06）

| 角色 | 说明 |
|---|---|
| Hub | `musterd`：事件内核、编排、审批队列、审计、设备注册表。可在桌面、家庭服务器、VPS。一个 Hub = 一个信任边界（不做多租户）|
| Operator | UI 客户端（桌面/Web/手机/CLI），可同时多个；通过 WS 连 Hub |
| Node | `muster-node`：能力提供者；**主动外连** Hub；断线指数退避重连（上限 30s）|
| AgentHost / BrowserHost | Node 上的 capability（§5.6、§8）|

### 7.2 设备身份、注册与配对

- 每设备首次启动生成 **Ed25519** 密钥对，私钥入 OS 钥匙串；`device_id = 公钥`（与 iroh `EndpointId` 同一把钥）。
- Hub 注册表 `device(id=pubkey, name, platform, roles[], approved_caps[], pending_caps[], last_seen, revoked_at, policy)` 是**唯一授权来源**（连接成功≠被授权）。

配对流程：

```
[Hub UI] 添加设备 → 生成一次性 bootstrap { hub_endpoint_id, relay_hint, token(单次,10min,仅存哈希), scopes_preview }
         → 二维码 / 短码 / 命令 `muster-node pair "<code>"` / deep-link muster://pair?...
[Node]   用 hub_endpoint_id 拨号（iroh 或 WS relay）→ 出示设备公钥 + 对 Hub challenge-nonce 的签名 + token
[Hub]    校验 → 创建 pending(device, roles, 声明的 caps)
         → UI 显示：设备名/平台/公钥短指纹(SAS 词组, 双方各显示供目视核对)/请求的能力 → 用户逐能力勾选批准
[之后]   Node 重连仅用设备密钥签名；声明的能力面变宽 → 回到 pending（两层：设备准入 + 能力面审批）
自动批准仅两条窄通道：①局域网 + SSH 已验证公钥 ②管理员预签发；公钥变化/权限升级永不自动批准
撤销：device.remove 立即吊销、断连、使能力 token 失效、relay AccessControl 拉黑 EndpointId
```

安全默认（**不照抄 OpenClaw 的 Node 本机 exec 默认 full 不询问**）：Node 的 `system.run` 默认 `ask`，审批在**Node 本机强制执行**，Hub 无法绕过。

### 7.3 传输

```rust
#[async_trait] pub trait Transport: Send + Sync {
    async fn dial(&self, peer: &PeerAddr) -> Result<Box<dyn MuxConn>>;   // 返回支持多逻辑流的连接
    async fn listen(&self) -> Result<Box<dyn Listener>>;
}
// MuxConn::open_stream(Alpn) -> BidiStream     Alpn ∈ { ctl, evt, blob, screen }
```

| 阶段 | 实现 |
|---|---|
| v0 | `WsTransport`：WSS + 配对码；LAN 直连或经出站中继；逻辑流用帧头复用 |
| v1（默认）| `IrohTransport`：公钥拨号，relay→握手→打洞→直连迁移；ALPN `muster/ctl/1`、`evt/1`、`blob/1`、`screen/1`；Hub 在 `EndpointHooks::after_handshake` 校验 EndpointId 是否在注册表且未吊销；自托管 `iroh-relay` 开 Bearer 访问控制 |
| 并行 | `OverlayTransport`：用户自带 Tailscale/Headscale/NetBird 地址，直接走 WS/TCP；局域网 mDNS 发现 |

iroh 局限（06）：浏览器内不能打洞（Web 走 WS relay）；生产需自托管 relay；移动端绑定成熟度未证实【未证实】——所以手机在阶段 1 只经 WS 中继。

### 7.4 Hub↔Node 协议

JSON-RPC 2.0 双向 + 事件流，请求带 `request_id/deadline/cancel`，显式协议版本与 N-1 兼容窗口。方法（命名参考 OpenClaw，保持与 MCP 工具面可映射）：

```
node.hello{proto, caps_declared, version}          node.pair.* (request/approve/reject/revoke)
node.invoke{command, args, deadline, trace}        → 返回 ok/err | 流式 chunk
  commands:  exec.run  exec.pty.open/write/resize/close   fs.read/list/stat/write/patch/watch
             agent.spawn{driver, argv, env, cwd}  agent.attach{agent_id, last_seq}  agent.kill
             browser.proxy{...}  screen.snapshot  clipboard.* (默认关)  notifications.show
node.event{seq, ...}    // Node → Hub：online/offline、进程退出、下载、弹窗、崩溃…（单调序号）
task.resume{task_id, last_event_seq}               // 断线补拉
```

路由规则（抄 OpenClaw）：一旦某 Node 处理了一个任务的首个调用，后续调用粘在同一 Node；**失败不跨机重放**；显式 `target=` 优先于自动选择。离线 Node 的调用立即返回结构化错误 `node_offline`，由编排决定"等上线 / 改派 / 通知用户"，非即时任务可入队，Node 上线后下发（需任务 Mandate 明示允许延后）。

资源上限（借鉴 RustDesk）：并发会话数、每 Node 同时进程数、帧缓冲、登录失败限流。

### 7.5 Operator 协议（Hub↔UI）与移动端

- 本地认证：Tauri 壳启动 sidecar 时通过环境变量传一次性随机 token；`musterd` 默认只监听 **loopback/命名管道 + token**，**绝不无认证监听**（吸取原型"公开请求头即管理员"的质疑教训）。LAN 访问需显式开启并走配对的 Operator 设备密钥。
- 订阅：`subscribe{from_seq, filters}` 先从 journal 追赶再切实时，seq 保证无缺口；事件 16~32ms 批量下发（`event_sink.rs` 经验）。
- 命令：`bot.*`、`session.send{mode, expected_turn_id, request_id}`、`session.fork`、`session.interrupt`、`approval.resolve`、`task.*`、`device.*`、`schedule.*`、`memory.*`。
- 手机/Web：阶段 1 为 PWA，经**出站中继**（Cloudflare Worker + Durable Object，亦可自托管；Hub 与手机都出站 WSS，中继转发**端到端加密**的帧——密钥来自 QR 配对，借鉴 Happy 的 libsodium 模式）；推送由中继 Worker 经 Web Push（后续 APNs/FCM）发出，载荷只含"有事待处理"。阶段 2 Tauri mobile 壳（QR 扫码、生物识别、推送、分享目标）。
- **【评审】PWA 约束**：Service Worker、PWA 安装、Web Push、`crypto.subtle` 都要求 secure context（HTTPS 或 localhost），而 `http://192.168.x.x` 不是。因此 MVP 的手机遥控**必须经 HTTPS**：推荐用户自带 Tailscale（`tailscale serve` 自动签发证书）或自托管反代；纯 LAN HTTP 只能当“浏览器页面”用，没有推送/安装。iOS 的 Web Push 还要求页面已“添加到主屏幕”。出站 E2EE 中继（Cloudflare Worker + 自有域名 HTTPS）是 M4 项，未做之前不要承诺“出门在外无需配置即可审批”。
- **同步策略**：阶段 1 不做多写复制；每台机器 daemon 是其线程唯一写者，跨设备靠"远程附着"（UI 连到那台 Hub）。阶段 2 才做 E2EE 加密 blob 日志中继（离线/多端回放）。

---

## 8. 远程浏览器

统一工具面 `browser.*`：`navigate / snapshot / click(ref) / type / select / screenshot / tabs / download / wait / evaluate(默认关) / takeover`；`snapshot` 返回带 `ref` 的**可访问性树**（脱敏），ref 过期有恢复循环；视觉兜底用 computer-use 工具（受控虚拟显示中，默认关）。

```
Agent ──browser.*──▶ BrowserRouter（Hub）──target = host | node:<id> | cloud:<provider>
       ┌──────────────────────┬─────────────────────────────┬──────────────────────────┐
       ▼                      ▼                             ▼
  A. 托管隔离 profile      B. 真实 Chrome 接管 (v2)        C. 云浏览器
  Node 本地 Chromium        扩展 + native messaging 桥      CDP URL（steel-browser 自托管 /
  CDP, 独立 user-data       或 DevTools MCP autoConnect     Browserbase 等）
  任务结束即销毁            逐站点授权 + 高危确认           无人值守/定时/事件触发场景首选
```

- **v1 实现**：A 档以 `@playwright/mcp` 作为 Node 上**按需下载、懒启动**的 sidecar（避免基础安装包携带 Node）；Rust 只负责进程管理、路由、策略。C 档适配器只需 CDP URL。v2 评估自写精简 CDP 子集（`tokio-tungstenite`）或 Rust CDP crate【未验证成熟度】以去掉 Node 依赖。
- **实时观看与接管**：CDP `Page.startScreencast`（或定期截图）经 `screen` 流推 UI；"接管"= 浏览器上下文的控制者租约从 `agent` 切到 `human`（`browser.takeover.*` 事件），验证码/2FA/登录交还用户，之后交还 Agent。接管细节【需原型验证】。
- **路由**：任务粘在首个处理它的后端，失败不跨后端重放；`target` 显式优先。
- **安全**：SSRF 与域名策略在网络层（Egress Proxy）拦截；快照中密码/OTP/卡号脱敏；登录态用 vault 注入而非进上下文；每任务独立 profile；B 档逐站点首次审批、提交/支付/删除强确认。
- 事件：下载/弹窗/崩溃 → `browser.*` 事件并入总线。

---

## 9. 记忆系统

四层，**文件为真相**：

| 层 | 载体 | 说明 |
|---|---|---|
| 工作记忆 | Session 上下文投影（surface）| 受压缩与 Spill 控制 |
| 情景记忆 | domain journal + session log + FTS5 索引 | 可按时间/Task/Bot 检索；`recall` 取回被 Spill 的原文 |
| 语义记忆 | `~/.muster/mind/` 目录（**git 仓库**）：`SOUL.md`（人格/行为准则）、`USER.md`（用户画像）、`MEMORY.md`（长期事实）、`bots/<bot>/MEMORY.md`、`projects/<proj>/*.md` | 用户可读可改（对应 Muse 的 Soul/Memory 两张可编辑卡）；`sqlite-vec` + FTS5 作**派生索引**，可重建 |
| 程序记忆 | Skills（`SKILL.md`）| 渐进披露；"从成功任务沉淀技能"为 P2 |

机制：
1. **读**：`memory.search` 混合检索（FTS5 + 可选向量），带来源与时间；Router/Worker 开场只注入 SOUL + USER + 精简的 Bot 记忆，其余按需检索，防止"记忆膨胀"。外部 Agent 通过 MCP `memory.search` 访问，也可导出 `AGENTS.md` 片段。
2. **写**：Agent 只能**提议**（`memory.proposed`），由规则 + 用户确认或"可信来源自动提交"落成 git commit（`memory.committed`），每条带来源事件；**来自 Untrusted 污点会话的写入一律进待审队列**，防记忆投毒（对应 OpenClaw/ClawHub 被投毒的教训）。
3. **梦境（sleep-time）**：夜间/空闲由 `schedule.fired` 唤醒一个整理子 Agent：去重、合并、过期、从日志提炼候选记忆；产物是一个 git diff，供用户一键接受/回滚（Letta MemFS 与 Muse 夜间整理的结合）。
4. **作用域**：user / bot / project / task 四级；Bot 复制不带记忆（Grok Bot 做法）。
5. 嵌入模型：默认仅 FTS5（零依赖）；可选本地小模型（ONNX/fastembed 类，大小待评估【未证实】）或 API；向量索引异步构建，不阻塞主路径。

---

## 10. 权限、审批与沙箱

### 10.1 策略引擎（确定性，Rust，不经 LLM）

输入：`(session, task.mandate, tool.spec.risk, args 抽象(路径/域名/命令族), device, trust/taint, 时间/预算)`；输出：`Allow | Ask(card) | Deny`，规则带版本号（`policy_version` 写入 Mandate，保证可复现）。

`RiskClass`（借鉴 Eigent `ToolSafetyClass`，按"可撤销性"分级以避免横幅盲区）：

| 级 | 含义 | 默认 |
|---|---|---|
| R0 ReadOnly | 读授权目录/公开网页 | Allow |
| R1 LocalWriteReversible | 工作区内写（有 checkpoint/git 可回滚）| Allow（worktree 内）/ Ask（其他）|
| R2 LocalExec | 运行命令/脚本 | Ask，沙箱内可按规则放行 |
| R3 NetworkEgress | 访问非白名单域名 | Ask |
| R4 ExternalEffect | 对外副作用且难撤销（发邮件/消息、推送、创建 PR、转账、删除）| **Ask（强确认卡，展示 diff/收件人）**|
| R5 CredentialUse / Admin | 使用凭据、改策略、配对设备、开启 computer-use | Ask + 二次确认 |

**【评审】与 UI 展示分级的映射**：04-ui-ux §4.3 使用 4 级展示分级（UI-R0..R3），本节为引擎内部 6 级（R0..R5）。映射：UI-R0=R0；UI-R1=R1（worktree 内/有快照）；UI-R2=R1（worktree 外）∪ R2 ∪ R3；UI-R3=R4 ∪ R5。“Balanced 只拦 R2/R3”即引擎侧对 R2–R5 与 worktree 外的 R1 返回 Ask。以本节引擎分级为准，UI 只做展示折叠。

### 10.2 审批流

```
tool_call ─▶ Policy.decide ─Ask▶ emit approval.requested{id, session, tool_call摘要, risk, diff?, expires_at}
          ─▶ Session 状态 waiting_approval（原生: 工具 future 挂起; 外部: 暂缓回应其 permission request）
          ─▶ UI 原生审批卡（不可由 MCP Apps/模型渲染） ─▶ approval.resolved{allow|deny|allow_always(范围受限)}
          ─▶ 恢复；超时 ─▶ approval.expired ─▶ 自动 Deny
```

- **无人值守**（由 schedule/GitHub/IM 触发、无 Operator 在线）：R2 及以上**不自动放行**，会话停在 `waiting_approval` 并推送"待你处理"，到期自动拒（借鉴 05：无人值守与子 Agent 触发的审批一律自动拒绝）。
- 审批卡文案、按钮、风险色由内核生成结构化数据，UI 渲染；模型无法影响卡片内容之外的呈现。
- `allow_always` 只能生成**范围受限的规则**（路径前缀/命令族/域名），并在设置页可见可撤销。

### 10.3 不可信来源污点（轻量 Sentinel）

- 事件信封带 `trust`。任何 `Untrusted` 内容进入某 Session（PR 正文、网页、邮件、MCP 返回）→ `session.taint = true`（记录污点来源事件）。
- 污点会话中：R4/R5 一律强制 Ask 且卡片显示污点来源；写记忆进待审队列；外发域名限制收紧。
- 不做 eBPF 级污点追踪（v1 非目标）；Sentinel 的"分类器+裁决者在容器外"思想用"策略引擎在 Agent 进程外 + 小模型可选二次裁决"近似。

### 10.4 凭据代理与出口代理

- 保险箱：OS 钥匙串；凭据对象 `cred://github/<name>` 有作用域（域名/操作）。
- 模型与外部 Agent 只见**句柄/替身 token**；真实密钥仅在 Node 或凭据代理侧注入到 HTTP 请求头/环境变量，且只对白名单域名生效（Muse 的 surrogate token 思想）。
- **Egress Proxy**（Hub 与 Node 各一个本地 HTTP(S) 代理）：强制 Agent 沙箱内的出网走代理；域名白名单、SSRF 防护（私网/元数据地址）、请求头注入、响应脱敏、流量记账。对外部 Agent：能设置 `HTTP(S)_PROXY` 的就设置，不能的靠沙箱网络策略。
- 外部 Agent 自己持有的凭据（如用户本机登录态）我们**无法代理**：靠沙箱范围、worktree、审批上收限制其影响面。

### 10.5 沙箱矩阵

| 平台 | 机制（vendor Codex crates）| 回退 |
|---|---|---|
| Linux | bubblewrap + Landlock/seccomp（`linux-sandbox`；**【评审】依赖链见 §3.2，M0 限时评估后再定，MVP 不依赖**）| 容器（Docker/Podman）|
| Windows | 受限令牌/沙箱（`windows-sandbox-rs`，细节【需核对】）+ Job Object 杀进程树 | 受限本地模式：路径白名单 + 命令审批 |
| macOS | Seatbelt（Codex `sandboxing` 同款【需核对】）| 同上 |
| 办公重任务 | 自建 `office-runtime` 容器镜像（LibreOffice、Python 文档库、CJK 字体、Tesseract、Playwright）| 无 Docker 用户走受限本地模式 |

文件安全默认：只挂载授权目录；写前出变更计划与 diff；工作区 git 自动快照可回滚；denylist `.env/.ssh/*token*/*secret*`；出网白名单；挂载面最小化（Cowork SharedRoot 逃逸教训）。

### 10.6 审计

- domain journal 的 blake3 哈希链（`prev_hash/hash`）与事件总线同源；审批、策略变更、设备配对、凭据使用、副作用账本全部落账；`muster audit export/verify`。
- 导出为 JSONL，同时是可重放测试夹具。

---

## 11. 可观测性与成本

- **事件即 trace**：`trace_id` 贯穿 UI→内核→Driver→Node→工具；`tracing` crate + 可选 OpenTelemetry 导出（默认关）；`traceparent` 向 MCP 传播。
- **Timeline UI 即调试器**：任意 Session 可按 seq 回放；`muster replay <session>` 用 JSONL 夹具重放 Driver 事件（离线单测）；Driver 的原始帧另存调试 ring（可开关）。
- **成本账**：每次 LLM 调用写 `usage`（输入/输出/缓存读写 token、模型、价格快照、归属 Task/Session/Bot）；UI 的 token 仪表按任务/Bot/日汇总；**任务级预算**（Mandate.budget）：`budget.warning` 80%、`budget.exceeded` 触发 `interrupt` + 通知；Router 与 Watchdog 自带日上限。
- **循环检测**：相同 `(tool,args_hash)` 连续 N 次或无进展 M 步 → `loop.detected` → Watchdog 介入。
- **心跳/小模型**：心跳与 triage 用小模型、最小上下文，避免"token 成本不可预测"痛点。
- **健康**：`muster doctor`（依赖/版本/权限/端口/钥匙串）、Driver 版本与协议版本告警（Codex pin 版本不匹配、ACP 能力缺失）。
- **崩溃与诊断包**：脱敏诊断导出（含最近事件、版本、配置），不含凭据。

---

## 12. 数据存储模型

### 12.1 存储布局

```
%APPDATA%/Muster (Win) | ~/Library/Application Support/Muster (Mac) | ~/.local/share/muster (Linux)
├─ journal.db          # SQLite WAL：event / session / session_event / task / ... （synchronous=FULL，单写者）
├─ index.db            # SQLite：FTS5 + sqlite-vec 派生索引（可删可重建，synchronous=NORMAL）
├─ blobs/ab/cd/<hash>  # 内容寻址 blob：Spill 大输出、截图、大 diff、附件
├─ mind/               # 记忆 git 仓库（SOUL.md / USER.md / MEMORY.md / bots/ / projects/）
├─ worktrees/          # 分支与外部 Agent 的 git worktree（或位于用户仓库旁，视策略）
├─ config.toml         # 非敏感配置（模型路由、策略默认、传输）
└─ logs/               # tracing 滚动日志
密钥：OS 钥匙串（设备私钥、API Key、凭据保险箱主密钥）。
```

### 12.2 关键表（DDL 草案；在 02 号报告 §6.1 基础上补全 Bot/设备/审批/策略/用量/记忆）

```sql
-- 1) 领域事件：不可变、幂等入库、哈希链
CREATE TABLE event (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,         -- 全局单调
  id         TEXT NOT NULL UNIQUE,                      -- ULID
  ts         INTEGER NOT NULL,                          -- epoch ms
  kind       TEXT NOT NULL,                             -- 'user.message' | 'schedule.fired' | ...
  source     TEXT NOT NULL,                             -- 'ui:desktop-1' | 'cron' | 'github:o/r' | 'agent:<session>' | 'device:<pk>'
  idem_key   TEXT,
  actor      TEXT NOT NULL,                             -- JSON
  trust      TEXT NOT NULL CHECK (trust IN ('principal','delegated','untrusted')),
  thread_key TEXT, task_id TEXT, session_id TEXT, cause_id TEXT,
  trace_id   TEXT,
  payload    TEXT NOT NULL,                             -- JSON（来源原生数据，内核不解析）
  payload_ref TEXT,                                     -- blob 溢出
  prev_hash  BLOB NOT NULL, hash BLOB NOT NULL,
  UNIQUE (source, idem_key)
);
CREATE INDEX event_by_thread  ON event(thread_key, seq);
CREATE INDEX event_by_task    ON event(task_id, seq);
CREATE INDEX event_by_session ON event(session_id, seq);
CREATE INDEX event_by_kind    ON event(kind, seq);

-- 2) Thread / 订阅（订阅=直通路由，只给上下文不给权限）
CREATE TABLE thread (
  key TEXT PRIMARY KEY, meta TEXT, last_seq INTEGER,
  evaluating TEXT,                  -- 当前 Eval id，至多一个
  pending TEXT NOT NULL DEFAULT '[]'-- 下一批 Eval 的 event ids
);
CREATE TABLE subscription (
  thread_key TEXT NOT NULL, task_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('owner','context')),
  PRIMARY KEY (thread_key, task_id)
);
CREATE TABLE source_binding (       -- 显式 opt-in：来源 -> Bot/Task 路由 + 自主度
  id TEXT PRIMARY KEY, source_pattern TEXT NOT NULL, bot_id TEXT, task_template TEXT,
  autonomy TEXT NOT NULL DEFAULT 'observe' CHECK (autonomy IN ('observe','ask','auto')),
  enabled INTEGER NOT NULL DEFAULT 1, created_at INTEGER
);

-- 3) Bot（花名册）
CREATE TABLE bot (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  avatar_spec TEXT NOT NULL,        -- JSON：{shape,color,eyes,accessory,seed} 或 {rive_asset}
  persona TEXT,                     -- 摘要，完整 SOUL 在 mind/
  backend TEXT NOT NULL,            -- native | acp:claude | codex_appserver | acp:opencode | ...
  backend_config TEXT,              -- JSON（可执行路径、模型、mode）
  default_device TEXT, default_workdir TEXT,
  autonomy_default TEXT, budget_json TEXT,
  pinned INTEGER DEFAULT 0, hidden INTEGER DEFAULT 0, section TEXT,
  main_session_id TEXT, created_at INTEGER
);
CREATE TABLE bot_presence (         -- 投影：头像状态 + 注意力态（daemon 计算，UI 只渲染）
  bot_id TEXT PRIMARY KEY, state TEXT NOT NULL,   -- idle|thinking|working|waiting|blocked|done|offline
  activity TEXT,                    -- 头像下方"正在做什么"一行
  attention TEXT NOT NULL DEFAULT 'none',         -- none|unread|working|needs_attention
  updated_seq INTEGER
);

-- 4) Task（授权工作单元；状态独立于 Agent）
CREATE TABLE task (
  id TEXT PRIMARY KEY, title TEXT,
  mandate TEXT NOT NULL,            -- JSON 不可变：{autonomy, scope{paths,devices,domains}, budget, policy_version, basis}
  state TEXT NOT NULL CHECK (state IN ('open','waiting','ready','blocked','failed','ended')),
  ended TEXT, origin_event TEXT NOT NULL, channels TEXT,
  attention TEXT,                   -- 待人决定的结构化问题
  created_at INTEGER, updated_at INTEGER
);

-- 5) Session 与会话日志
CREATE TABLE session (
  id TEXT PRIMARY KEY, bot_id TEXT, role TEXT NOT NULL,   -- router|worker|watchdog|subagent
  backend TEXT NOT NULL, backend_ref TEXT,                -- 外部 thread/session id
  task_id TEXT, parent_session TEXT,
  forked_from_session TEXT, forked_from_seq INTEGER, inherited_count INTEGER,
  device_id TEXT, workdir TEXT, worktree_branch TEXT,
  state TEXT NOT NULL,                                    -- idle|running|waiting_approval|waiting_input|waiting_child|parked|failed|archived
  taint INTEGER NOT NULL DEFAULT 0, taint_source TEXT,
  activation_id TEXT,                                     -- 重启清空
  model_route TEXT, preset TEXT, created_at INTEGER
);
CREATE TABLE session_event (
  session_id TEXT NOT NULL, seq INTEGER NOT NULL,         -- 会话内连续；fork 继承段通过 forked_from 读取
  id TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,                                     -- user/message | assistant/message | tool/call | tool/result | turn/start | turn/end | compaction/replace | session/end-seed | mirror.* ...
  surface_op TEXT, replace_start INTEGER, replace_end INTEGER,
  data TEXT NOT NULL, blob_ref TEXT, ts INTEGER NOT NULL,
  source_event_id TEXT,                                   -- 引起它的 domain event（因果链）
  PRIMARY KEY (session_id, seq)
);
CREATE TABLE session_inbox (                              -- 先持久化入箱，再调度
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, event_id TEXT,
  kind TEXT NOT NULL,                                     -- trigger|note|policy|child_report|text
  mode TEXT NOT NULL CHECK (mode IN ('steer','followup','collect','inject')),
  request_id TEXT UNIQUE, expected_turn_id TEXT,
  created_at INTEGER, claimed_at INTEGER, claimed_turn TEXT
);
CREATE TABLE assignment (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL, session_id TEXT NOT NULL,
  state TEXT, report_state TEXT, report_summary TEXT, report_at INTEGER, delivered_at INTEGER, idle_at INTEGER
);
CREATE TABLE checkpoint (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, seq INTEGER NOT NULL,
  workspace_ref TEXT,               -- refs/muster/ckpt/<id> 或快照 id
  ledger_hwm INTEGER, label TEXT, auto INTEGER, created_at INTEGER
);

-- 6) Effect outbox 与副作用账本
CREATE TABLE effect (
  kind TEXT NOT NULL, key TEXT NOT NULL, payload TEXT NOT NULL, seq INTEGER,
  attempts INTEGER DEFAULT 0, due INTEGER, error TEXT DEFAULT '', ordered_group TEXT,
  PRIMARY KEY (kind, key)
);
CREATE TABLE side_effect_ledger (
  effect_id TEXT PRIMARY KEY, session_id TEXT, task_id TEXT,
  kind TEXT NOT NULL,               -- email.send | git.push | pr.create | message.send ...
  target TEXT, status TEXT NOT NULL, inherited_from TEXT, at INTEGER
);

-- 7) 设备、能力、租约
CREATE TABLE device (
  id TEXT PRIMARY KEY,              -- Ed25519 公钥(hex/base32)
  name TEXT, platform TEXT, roles TEXT, approved_caps TEXT, pending_caps TEXT,
  policy TEXT, online INTEGER DEFAULT 0, last_seen INTEGER, created_at INTEGER, revoked_at INTEGER
);
CREATE TABLE pairing_token (token_hash BLOB PRIMARY KEY, expires_at INTEGER, scopes TEXT, used_at INTEGER);
CREATE TABLE lease (resource TEXT PRIMARY KEY, holder TEXT NOT NULL, expires INTEGER NOT NULL);

-- 8) 调度
CREATE TABLE schedule (
  id TEXT PRIMARY KEY, target_kind TEXT, target_id TEXT, spec TEXT NOT NULL,   -- cron/interval
  payload TEXT, catch_up TEXT DEFAULT 'once', next_fire INTEGER, enabled INTEGER DEFAULT 1
);

-- 9) 审批与策略
CREATE TABLE approval (
  id TEXT PRIMARY KEY, session_id TEXT, task_id TEXT, tool TEXT, risk TEXT, summary TEXT, detail_ref TEXT,
  taint_source TEXT, state TEXT NOT NULL,   -- pending|allowed|denied|expired
  requested_at INTEGER, expires_at INTEGER, resolved_by TEXT, resolved_at INTEGER, rule_id TEXT
);
CREATE TABLE policy_rule (
  id TEXT PRIMARY KEY, version INTEGER, scope TEXT, matcher TEXT, decision TEXT, created_by TEXT, created_at INTEGER, revoked_at INTEGER
);
CREATE TABLE credential_ref (id TEXT PRIMARY KEY, label TEXT, kind TEXT, allowed_domains TEXT, keychain_key TEXT, created_at INTEGER);

-- 10) 用量与预算
CREATE TABLE usage (
  id TEXT PRIMARY KEY, ts INTEGER, session_id TEXT, task_id TEXT, bot_id TEXT, model TEXT,
  in_tokens INTEGER, out_tokens INTEGER, cache_read INTEGER, cache_write INTEGER, price_micro_usd INTEGER
);

-- 11) 记忆派生索引（真相在 mind/ 的 Markdown + git）
CREATE TABLE memory_item (
  id TEXT PRIMARY KEY, scope TEXT, path TEXT, anchor TEXT, text TEXT, source_event TEXT, commit_id TEXT, updated_at INTEGER
);
CREATE VIRTUAL TABLE memory_fts USING fts5(text, content='memory_item');
-- sqlite-vec 向量表在 index.db，可重建
CREATE TABLE memory_proposal (id TEXT PRIMARY KEY, scope TEXT, diff TEXT, source_event TEXT, tainted INTEGER, state TEXT, created_at INTEGER);
```

迁移：内置版本号表 + 顺序迁移；schema 变更向前兼容读旧日志；`session_event.data` 带 `v` 版本字段（dsh 经历了 v0..v4 日志格式迁移，我们从一开始留版本位）。

---

## 13. 仓库 / 工程目录结构

Monorepo（Cargo workspace + pnpm workspace）。

```
muster/
├─ crates/
│  ├─ proto/               # 全部协议类型：Event/EventKind/Session/Thread/Turn/Item/Command/Presence 等（serde+schemars）-> 生成 packages/protocol
│  ├─ journal/             # SQLite 写线程、追加、投影、哈希链、fork 视图、checkpoint、迁移
│  ├─ kernel/              # KernelActor：apply(cmd)、effect outbox、lease、schedule 堆、订阅(from_seq)、崩溃恢复
│  ├─ router/              # Router Session：批处理 Eval、NotifyGate、规则快路径、source_binding
│  ├─ agent-core/          # 原生 loop（steer/followup 注入点）、Session 投影、压缩/Spill、NativeDriver
│  ├─ model/               # ModelClient trait；rig-core 适配；openai_compat；ModelRouter；usage 记账
│  ├─ drivers/
│  │   ├─ driver-api/      # AgentDriver trait、DriverCaps、canonical AgentEvent/Command、降级逻辑
│  │   ├─ acp/             # AcpDriver（agent-client-protocol；Registry 拉取；_session/steering 扩展）
│  │   ├─ codex/           # CodexAppServerDriver（pin 版本+生成绑定）
│  │   ├─ claude/          # ClaudeSdkDriver（可选，hooks/rewind 等）
│  │   └─ opencode/        # OpenCodeHttpDriver
│  ├─ tools/               # Tool Host、内置工具、Skills 加载器、tool 风险标注
│  ├─ mcp/                 # rmcp 宿主：连接/授权(CIMD+DCR)/缓存/MCPB 安装；mcp-bridge（给子 Agent 的反向通道）
│  ├─ policy/              # 策略引擎、RiskClass、污点、审批、预算
│  ├─ vault/               # 钥匙串封装、凭据句柄、Egress Proxy
│  ├─ sandbox/             # vendor：codex linux-sandbox / windows-sandbox-rs / sandboxing / apply-patch（保留 NOTICE）
│  ├─ memory/              # mind/ git 仓库、FTS5/向量索引、proposal、梦境任务
│  ├─ sources/             # schedule、github(轮询/relay)、channels(feishu 等)、fs-watch
│  ├─ gateway/             # axum：/v1/ws、认证、配对、relay 客户端、ACP-server/AG-UI 适配（P1）
│  ├─ net/                 # Transport trait；ws、iroh、overlay；mux 流
│  ├─ node/                # Node 能力：exec/pty/fs/agent-host/browser-host/screen；本机审批执行
│  ├─ browser/             # BrowserRouter、后端 A/C 适配、snapshot 脱敏
│  ├─ observe/             # tracing/OTel、replay、doctor、audit 导出
│  ├─ musterd/             # bin：Hub daemon（--headless）
│  ├─ muster-node/         # bin：精简 Node
│  └─ muster-cli/          # bin：`muster`（pair/doctor/audit/replay/mcp-bridge）
├─ apps/
│  ├─ desktop/             # Tauri 2：src-tauri 仅 sidecar 管理/托盘/updater/deep-link/桌宠窗口/开机自启
│  ├─ web/                 # React UI（桌面 WebView / PWA / 手机共用）
│  ├─ mobile/              # Tauri mobile 壳（阶段 2）
│  └─ relay/               # Cloudflare Worker + Durable Object（E2EE 帧转发 + 推送），可自托管；iroh-relay 部署脚本
├─ packages/
│  ├─ protocol/            # 由 crates/proto 生成的 TS 类型 + zod
│  ├─ ui/                  # 花名册、时间线、审批卡、分支树、终端、diff、MCP Apps 宿主
│  └─ mascot/              # AvatarRenderer(SVG/Canvas/Rive/VRM) + 状态->表情映射（L0 参数化角色先行）
├─ assets/                 # 头像资源与授权记录（每件资源附 LICENSE 与来源）
├─ deploy/                 # Dockerfile（headless Hub）、systemd、一键 VPS 脚本、office-runtime 镜像
├─ tests/
│  ├─ conformance/         # MCP conformance、ACP TCK、Driver 夹具回放
│  ├─ e2e/                 # WebKit + Chromium 双内核 UI E2E
│  └─ chaos/               # 崩溃恢复、断线重连、fork 悬空 tool call
└─ docs/                   # 架构/ADR
```

约束：(1) UI 只依赖 `packages/protocol`，不直接调用 Tauri command；(2) 每个外部协议只在一个 crate 里出现；(3) 事件批量合并 16~32ms；(4) daemon 只管理**自己启动**的子进程（按 PID/Job Object 追踪，不按端口杀进程）；(5) `sandbox/` 目录原样保留上游 LICENSE/NOTICE。

---

## 14. 关键接口草案

### 14.1 Journal / Kernel

```rust
pub trait Journal: Send + Sync {
    fn append(&self, txn: &mut Txn, ev: NewEvent) -> Result<Seq>;                // 幂等：(source,idem_key) 冲突返回既有 seq
    fn read(&self, from: Seq, filter: &Filter, limit: usize) -> Result<Vec<Event>>;
    fn session_view(&self, s: SessionId, upto: Option<u64>) -> Result<SessionView>; // 沿 forked_from 链组合前缀
    fn fork(&self, txn: &mut Txn, req: ForkRequest) -> Result<SessionId>;            // 含 end-seed + 合成 tool result
    fn checkpoint(&self, txn: &mut Txn, s: SessionId, label: Option<&str>) -> Result<CheckpointId>;
}

pub enum Command {                         // 内核唯一输入；每个都先转成 command.* 事件
    Ingest(NewEvent),
    Send { session: SessionId, input: Input, mode: Delivery, expected_turn: Option<TurnId>, request_id: RequestId },
    Fork(ForkRequest),
    Interrupt { session: SessionId, keep_inbox: bool, cause: CancelCause },
    ResolveApproval { id: ApprovalId, decision: Decision, by: Actor },
    CreateTask(TaskSpec), AttachThread { thread: ThreadKey, task: TaskId, mode: SubMode },
    PairDevice(PairSpec), RevokeDevice(DeviceId), SetPolicy(PolicyPatch),
}
pub enum CancelCause { User, Ancestor(SessionId), Watchdog, Budget, Shutdown }
```

### 14.2 Source 与 Tool

```rust
#[async_trait] pub trait Source: Send + Sync {
    fn id(&self) -> &str;
    async fn run(&self, ingress: IngressTx, shutdown: Shutdown) -> Result<()>;     // 产出 NewEvent{source, idem_key, trust, thread, payload}
}
// Tool trait 见 §6.1
```

### 14.3 模型层与原生 loop 的注入点

```rust
#[async_trait] pub trait ModelClient: Send + Sync {
    async fn stream(&self, req: ModelRequest) -> Result<BoxStream<'static, ModelDelta>>; // 含 tool-call 增量、usage、cache 指示
    fn caps(&self) -> ModelCaps;                  // supports_cache_breakpoints / tool_choice / max_context ...
}

// agent-core 主循环骨架（示意）
async fn run_turn(ctx: &mut TurnCtx) -> Result<TurnEnd> {
    loop {
        let view = ctx.session.surface();                       // 日志投影
        let resp = ctx.model.stream(build_request(&view, &ctx.tools)).await?;
        let calls = collect(resp, &ctx.cancel).await?;          // 取消令牌贯穿
        if calls.is_empty() {
            if let Some(f) = ctx.inbox.take_followups() { ctx.append(f); continue; }   // followup 注入点
            return Ok(TurnEnd::Completed);
        }
        for batch in plan_batches(calls) { ctx.exec_with_policy(batch).await?; }       // 审批/沙箱/预算/循环检测
        if let Some(s) = ctx.inbox.take_steer(ctx.turn_id) { ctx.append_marked(s); }   // steer 注入点（工具批之后）
        ctx.check_budget_and_loop()?;
    }
}
```

### 14.4 策略引擎、凭据、Node 能力

```rust
pub trait PolicyEngine: Send + Sync {
    fn decide(&self, req: &ToolRequest<'_>) -> Decision;     // Allow | Ask(ApprovalCard) | Deny(reason)
    fn on_taint(&self, s: SessionId, src: EventId);
}
#[async_trait] pub trait Hand: Send + Sync {                  // Brain/Hands：Hands 无会话状态
    async fn execute(&self, name: &str, input: Value, ctx: HandCtx) -> BoxStream<'static, HandOutput>;
    fn capabilities(&self) -> Vec<CapabilityDecl>;            // 能力清单（Eigent hands/ 同构）
}
pub trait Vault { fn resolve_handle(&self, h: &CredHandle, domain: &str) -> Result<Secret>; }
```

### 14.5 Operator 协议（TS，由 schema 生成）

```ts
type ClientMsg =
  | { t: 'subscribe'; fromSeq?: number; filters?: Filter }
  | { t: 'session.send'; session: string; input: Input; mode: 'steer'|'followup'|'collect'|'interrupt'; expectedTurnId?: string; requestId: string }
  | { t: 'session.fork'; session: string; at: { seq: number } | { turn: string } | 'latest'; workspace: 'new_worktree'|'share'|'snapshot'; requestId: string }
  | { t: 'approval.resolve'; id: string; decision: 'allow'|'deny'|'allow_always'; scope?: RuleScope }
  | { t: 'bot.create' | 'bot.update' | 'task.create' | 'device.pair' | 'schedule.upsert' /* ... */ };

type ServerMsg =
  | { t: 'event'; seq: number; ev: Event }                        // 批量
  | { t: 'session.event'; session: string; seq: number; ev: SessionEvent }
  | { t: 'presence'; bot: string; state: AvatarState; attention: Attention; activity?: string }
  | { t: 'ack'; requestId: string; ok: boolean; error?: ErrorInfo };

type AvatarState = 'idle'|'thinking'|'working'|'waiting'|'blocked'|'done'|'asleep';   // 评审：offline 并入 asleep（与 04 §9.1 词汇一致；error 以 blocked + 错误徽标表达）
```

头像状态**在 daemon 端用纯函数投影**（`derive_presence(events) -> Presence`，Rust 单实现，避免前后端两套逻辑漂移）。**【评审】分工**：Hub 输出持久态与注意力态；UI 只叠加纯展示瞬态（`listening` 用户输入中、`acknowledging` ≤800ms、`forking` ≤1s、`celebrating`）和 600ms 最短停留/300ms 防抖，不再自行推导持久态；`derive_presence` 与 UI 防抖逻辑共用同一份 golden JSONL 用例。04 §9 的 `deriveAvatarState` 即指 UI 侧这层薄函数。映射：`turn_started`/流式思考 -> `thinking`；工具执行中 -> `working`；`approval.requested`/`needs_input` -> `waiting`；`failed`/blocked -> `blocked`；`task.reported{ready}` -> `done`；Node 离线或 Session `parked` -> `asleep`。注意力态：`needs_attention`（审批/问题/交接）、`unread`、`working`。

---

## 15. 性能与体积目标【目标，非实测；M0/M1 用基准固化】

| 指标 | 目标 | 依据/说明 |
|---|---|---|
| 桌面安装包 | <= 60 MB 工程目标（PRD 硬门槛 < 100 MB）（Tauri 壳 + `musterd` 约 15~25 MB + 前端资源；**不含**按需下载的 Node/适配器/Playwright/Chromium，见 §5.2）| 对照 Better Stack 同类应用 Tauri 57 MB vs Electron 323 MB；不含按需下载的 Playwright/Chromium、Node、适配器 |
| `musterd` 空闲 RSS | <= 80 MB（无活跃 Session）| Rust 单进程；SQLite 缓存可配 |
| UI（WebView）空闲 | 100~150 MB | 两家框架空闲内存差异不大（实测 109 vs 128 MB），体积优势在安装包不在内存 |
| `muster-node` | 二进制 <= 15 MB；空闲 RSS <= 30 MB | 无内核、无 UI |
| 冷启动到可交互 | daemon <= 1 s；窗口出现 <= 2 s | — |
| 事件追加（含 fsync）| p99 <= 5 ms（group commit）；订阅端到端 <= 50 ms | 单写者 + 批量 |
| UI 事件下发 | 16~32 ms 批；流式渲染 >= 50 fps | `desktop-cc-gui event_sink.rs` 经验 |
| Session 冷恢复 | 1k 事件 <= 100 ms；10k <= 500 ms | OpenHands 自报 <20 ms 为参照量级 |
| Fork | 创建 O(1)（元数据 + 闭合事件）<= 20 ms；worktree 创建取决于仓库大小 | 前缀共享 |
| 并发 | 同时活跃 Activation 默认 8（可调）；Router 排队深度 <= 1k 事件 | 与 dsh 默认一致 |
| 花名册 | 50 个 Bot 头像动画同屏 60 fps（SVG/Canvas2D，非每头像一个 WebGL 上下文）| Grok Bot 上限 50；WebGL 上下文上限风险需实测【未证实】|
| Hub-Node 延迟 | LAN 直连 <= 20 ms；relay 附加 <= 200 ms | iroh 官方称约 9/10 直连 |
| LLM 延迟 | 不优化（5~6 s 为网络主导）；优化的是 token：Router 小模型、缓存前缀稳定、Spill | 04 引第三方数据：Rust 价值在体积与启动 |

---

## 16. 里程碑与落地顺序

> **【评审】以 `05-review-roadmap.md` 为准**：本节原 M0–M3 与 PRD §18、04 §12 的编号不一致，已统一为 M0（W1–2）/M1（W3–5）/M2（W6–8）/M3（W9–10，MVP 内测）/M4（W11–20，v1.0 公开 Beta）。下文按原稿保留技术内容，但范围按 05 的 MVP 切线执行：**MVP 不含**原生 Worker 的 fork（前缀共享树）、iroh、浏览器、MCP Apps、记忆 git 仓库、办公技能、出站中继、Tauri mobile。

**M0（2 周，spike + 止损闸门）**
1. Rust ACP 客户端 demo：驱动 `claude-agent-acp`、`codex-acp`、`opencode acp`、`goose acp`，跑通 `initialize -> session/new -> prompt -> request_permission -> cancel -> session/load`，事件落 JSONL（对照 Goose `acp/provider.rs`）；验证 `_session/steering`。
2. Codex app-server 直连：`thread/fork`、`turn/steer`、`turn/interrupt`，pin 版本 + 生成绑定。
3. 内核骨架：journal 写线程 + `event/session/session_event/effect` 四表 + 命令处理器 + 重启恢复；原生 loop 跑通 steer/followup/interrupt/fork（含合成 tool result）。
4. `rig-core` 评估：流式 tool-call、Anthropic 缓存断点、国产模型 OpenAI 兼容；不满足则落地 `openai_compat`。
5. Tauri sidecar PoC（Windows 优先）：loopback+token WS、托盘、daemon 脱离 UI 生命周期；WebKit/Chromium 双内核冒烟。
6. 闸门评审：按 §3.3 判定是否切 Plan B。

**原稿 M1（v0.1，约 6~8 周；【评审】对应 05 的 M1+M2+M3，且按 MVP 切线裁剪，其中 iroh/原生 Worker/记忆 git 等不在 MVP）**：联系人式 UI（花名册 + 主线程 + 侧聊 + 审批卡）、Router + Native Worker、AcpDriver（Claude/OpenCode/Goose）+ CodexAppServerDriver、策略引擎 + 审批卡 + worktree、schedule 与 GitHub 轮询触发、token 仪表、Hub-Node（WS + 配对码，2 台电脑）、`mind/` 记忆 v0、L0 参数化头像 + 状态映射。这是 01 号报告收敛的 v1 范围。

**原稿 M2（v0.2；【评审】对应 05 的 M4 及之后）**：iroh 传输 + 自托管 relay；远程 Agent 隧道与断线补拉；浏览器 A + C 档；fork/Checkpoint UI + 分支树；Watchdog；MCP Apps 宿主；PWA 遥控器 + 出站中继 + 推送；办公 P0 技能 + office-runtime 镜像；飞书渠道。

**M3**：B 档真实 Chrome 扩展桥；Tauri mobile；ACP-server / AG-UI 北向；梦境记忆整理；云端 worker（OpenHands/DeerFlow）；E2EE 日志中继；computer-use（默认关）；Goals/Feed 可视化；L1 吉祥物 + Rive。

---

## 17. 主要技术风险与对策

| # | 风险 | 级别 | 对策 |
|---|---|---|---|
| R1 | **自建内核工作量被低估**；原生 loop 与外部 Agent 能力矩阵降级逻辑复杂 | 高 | M0 闸门；v1 原生 Worker 只做办公/研究/调度，编码全交外部 Agent；Plan B（dsh sidecar）保留 |
| R2 | 外部协议高速演进（ACP v2、MCP 2026-07-28 破坏性、Codex app-server 实验性、Claude control protocol 无承诺）| 高 | 协议只在 adapter crate 出现；pin 版本；握手校验；夹具回放测试；优先官方 SDK/适配器而非自写 control protocol |
| R3 | **订阅账号合规**（Claude/Codex）| 高 | §5.4：用户本机登录官方二进制，产品不碰 token，不用其品牌；BYOK Agent 默认；法务确认条款 |
| R4 | WebKit/WebKitGTK/WebView2 一致性与性能（OpenCode 出走 Tauri 的原因）；Linux 依赖 `libwebkit2gtk-4.1` | 中高 | 双内核 CI；UI 仅依赖 WS 协议；保留 Electron/Tauri 3 CEF 回退 |
| R5 | 安全：提示注入驱动 R4/R5 动作、记忆投毒、技能投毒 | 高 | §10 全套；污点 + 强确认；记忆待审队列；技能签名+权限清单+沙箱，不开放市场 |
| R6 | Fork 语义错误：悬空 tool call 幻觉、分支重复副作用、文件互相覆盖 | 中高 | 合成 tool result + 警告文案；worktree；副作用账本；chaos 测试 |
| R7 | 中继/推送的信任与成本；E2EE 密钥管理 | 中 | 默认不依赖官方中继（LAN/overlay/自托管）；E2EE 密钥来自 QR 配对；中继只见密文 |
| R8 | iroh：浏览器不可用、移动端成熟度、自托管 relay 运维 | 中 | Transport trait；WS 兜底；v0 不依赖 iroh |
| R9 | rig-core 能力不足/升级破坏 | 中 | `ModelClient` trait 隔离；备 `openai_compat` |
| R10 | Windows 沙箱/PTY/杀进程树细节 | 中 | M0 即在 Windows 上验证；Job Object；受限本地模式兜底 |
| R11 | 成本不可预测、进度谎报、记忆膨胀（用户痛点）| 中 | 预算上限 + 循环检测 + 小模型心跳；`task.reported{ready}` 必须附产物证据；记忆文件化 + 梦境整理 |
| R12 | 许可证污染（AGPL/GPL/BSL/source-available）| 中 | §3.2 清单；CI 加 `cargo deny` 与前端许可扫描；`desktop-cc-gui` 等许可未核对的仓库仅看设计 |
| R13 | 品牌/商标：dsh 条款、Claude Code 标识、吉祥物/产品名（OpenClaw 前身 Clawd 两次改名）| 中 | NOTICE 如实标注；命名前商标检索；不模仿 Grok Bot 的具体形状+双斜杠眼睛 |
| R14 | 未核实的数据与假设（见 §20）| 中 | 全部转化为 M0 验收项 |

---

## 18. 与 UI / 产品文档的接口约定

- UI 的数据只来自 `event` / `session.event` / `presence` / `ack` 四类消息（§14.5）。花名册、时间线、收件箱、分支树都是投影，由 UI 本地从事件流增量计算或请求 daemon 的查询接口。
- "待人处理收件箱" = `attention` 投影（`approval pending` + `ask_user` + `blocked/failed` + `ready 待验收`）。
- 头像：`AvatarRenderer` 接口（SVG/Canvas -> Rive -> VRM 三后端）消费 `AvatarState`；L0 参数化角色用 `bot.avatar_spec` 的 seed 生成；主吉祥物 L1 买断后以 Rive 状态机落地。
- 电脑/浏览器面板：三级可见性（Status -> Preview -> Takeover）对应 `screen` 流订阅与 `browser.takeover.*` 事件。
- 审批卡/凭据保险箱：只由原生组件渲染，数据来自 `approval` 结构化字段。

---

## 19. 待用户拍板的问题

1. **内核：自建 Rust 内核（本文，ADR-02）还是先用 dsh 做内核（04 的阶段一）？** 本文推荐前者并设 M0 闸门。若更看重"一个月内出可演示版本"且接受 TS 运行时与上游变动，可选 dsh 并保持对外协议不变。
2. **Claude/Codex 接入的合规姿态**：是否接受"默认使用用户本机已登录的官方二进制，产品不接触 token"，即使牺牲一键体验？是否同时提供 API Key/Bedrock/Vertex 通道？
3. **原生 Worker 在 v1 的范围**：只做办公/研究/调度（编码交外部 Agent）是否可接受？
4. **是否要云端 Hub 托管**（我们提供）？本文默认"仅自托管 + 桌面常驻"，由用户自带 VPS。
5. **中继策略**：自建 Cloudflare Worker 中继 + 推送，还是 v1 仅 LAN/Tailscale/自托管？是否要求 E2EE（本文默认要）？
6. **桌面壳底线**：接受 Tauri/WebKit 风险（体积小）还是直接 Electron（一致性好，体积约 200 MB 起）？本文：Tauri 起步，保留回退。
7. **移动端**：阶段 1 PWA 遥控器是否足够？是否要求 iOS/Android 原生上架？
8. **内部协议**：自研 Thread/Turn/Item/Event（本文）还是直接裁剪 Codex app-server 协议为蓝本（需评估兼容与许可）？
9. **开源与许可**：核心 daemon 采用 Apache-2.0 / AGPL / 源码可用？影响可复用范围与商业模式。
10. **域名与品牌**：CIMD 文档、relay、配对 deep-link 都需要自有 HTTPS 域名。
11. **默认自主度**：外部来源触发的主动行为默认 `observe`（本文）是否符合预期？
12. **国内入口优先级**：微信/飞书/钉钉哪个先做（本文默认飞书先）；国产模型默认值（DeepSeek/Kimi/GLM/Qwen/MiniMax）。

### 项目代号候选（暂定 **Muster**）

| 候选 | 含义 | 备注 |
|---|---|---|
| **Muster**（暂定）| "点名集结"：花名册（roster）+ 把多台电脑、多个 Bot 召集起来 | 英文词；crate 前缀 `muster-*`；商标/域名待查 |
| Burrow | 地洞：Bot 们的据点；有萌感，适合吉祥物 | 与若干工具/项目重名风险 |
| Cohort | 一队同伴：Bot 编队 | 偏中性；重名多 |
| Mochi | 圆润团子形状头像，亲和 | 极易重名；不体现多机/事件特性 |
| Relay | 事件接力/多机中继 | 过于通用，SEO 困难 |

【评审已统一】全部设计文档的产品**工作代号 = Muster**（PRD 原 Colony、02 原 Roster 已改；04 的 **Pip** 保留为主 Bot 默认名/吉祥物，不再是产品名）。`musterd`/`muster-*` 仍是占位前缀，对外品牌定名并通过商标/域名检索后全局替换即可（crate、二进制、配置目录名集中在 §13/§12.1）。

---

## 20. 局限、未证实项与来源映射

**未证实 / 需 M0 验证**
- `rig-core` 对 Anthropic 缓存断点、流式 tool-call 增量的控制；goose-agent 的 wasm32 编译（未 `cargo check`）。
- Codex 沙箱 crate 的 crates.io 发布状态（本地 workspace 版本 `0.0.0`，评审核实其依赖 `codex-protocol`/`codex-network-proxy`/`codex-otel` 等内部 crate，见 §3.2）、Windows 沙箱与 macOS Seatbelt 的具体机制与可移植性。
- ACP Rust SDK crate 的包名/版本已由评审核实（见 §3.2：`agent-client-protocol` 2.2.x 等）；仍待实测：ACP 是否有标准 steer 方法（目前靠 `_session/steering` 扩展）、各适配器对该扩展的实际支持。
- Bun/Node 单文件 sidecar 可行性（仅 Plan B 相关）；Playwright MCP 懒下载体验；Rust CDP crate 成熟度。
- iroh 移动端绑定成熟度；Tauri mobile 推送插件现状；iOS 对"远程执行"类应用的审核限制。
- 浏览器实时画面与接管的具体实现；WebGL 上下文上限；嵌入模型体积。
- `vibe-editor2`、`Poracode` 的许可证（`desktop-cc-gui` 已由评审核实为 MIT）。
- 全部性能/体积数字均为目标值。

**研究报告映射**：01 产品范式与差异化 -> §0/§10/§18；02 事件/Session/fork/steer/数据模型 -> §4/§12/§14；03 外部 Agent -> §5；04 框架选型 -> §3（含 §3.3 偏离说明）；05 办公 Agent -> §6/§10（技能、office-runtime、文件安全、授权）；06 多机/浏览器/安全 -> §7/§8/§10；07 技术栈/协议 -> §2/§3/§13/§15；08 UI/形象 -> §14.5/§18。

**本地源码抽查（2026-11-06）**：`repos/codex/codex-rs`（存在 `app-server*`、`exec-server*`、`linux-sandbox`、`windows-sandbox-rs`、`sandboxing`、`apply-patch`、`keyring-store`、`thread-store`；workspace license Apache-2.0、version 0.0.0）；`repos/iroh/iroh`（1.4.1，MIT OR Apache-2.0）；`repos/rig/crates/rig-core`（MIT）、`rig-ecs`、`rig-harness`；`repos/goose/crates`（`goose-agent`、`goose-roaming` 含 `card.rs/handshake.rs`）；`repos/rust-sdk/crates/rmcp`；`repos/deepseek-harness/packages`（含 `subagent`、`schedule`、`session`、`browser-use`、`ssh`、`sandbox` 等）。
