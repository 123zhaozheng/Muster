# 03 编程 Agent 源码分析与“作为子智能体”的集成方式

> 调研日期：2026-11-06。所有“当前状态”均为该日期前后抓取的文档/源码快照。
> 本地源码快照（均为 `git clone --depth 1`，只读）：
> - `D:\code\xuqiu\repos\codex`（openai/codex，HEAD 提交时间 2026-11-06 03:09 UTC）
> - `D:\code\xuqiu\repos\opencode`（sst/opencode，HEAD 2026-11-06 03:11 UTC；`--filter=blob:none` 浅克隆）
> - `D:\code\xuqiu\repos\agent-client-protocol`（ACP 规范仓库，HEAD 2026-11-04；schema crate 1.15.1）
> - `D:\code\xuqiu\repos\claude-agent-acp`（@agentclientprotocol/claude-agent-acp 0.101.0，依赖 `@anthropic-ai/claude-agent-sdk 0.3.318`、`@agentclientprotocol/sdk 2.4.0`）
> - `D:\code\xuqiu\repos\codex-acp`（@agentclientprotocol/codex-acp）
> - 复用其它课题已克隆的：`goose`、`openclaw`、`rust-sdk`（ACP 官方 Rust SDK）
> - Claude Code 闭源，无源码；以官方文档 + 公开 SDK/第三方协议逆向文档为准，凡来自第三方的标注“第三方”。
> - DeepWiki 的回答只用作线索，凡与源码不符处以源码为准（例如它给出的 opencode 路径 `packages/server/src/routes.ts` 与当前仓库结构并不一致，已改用本地源码核对）。

---

## 0. 结论先行（TL;DR）

1. **“把编程 agent 当子智能体”这件事，2026 年已经有事实标准：ACP（Agent Client Protocol）。** 它已由 Zed 孵化、迁入 `agentclientprotocol` 组织，稳定版为 **v1**，v2 处于 experimental 预览；Claude Code、Codex、Gemini/Antigravity、OpenCode、Goose、Cline、Kilo、Cursor CLI、Copilot CLI、Kimi、Qwen、Junie、Auggie 等 30+ 个 agent 已原生或通过适配器支持，官方还有 **ACP Registry**（`https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json`）做分发。Goose 已经在生产里把 `claude-agent-acp`/`codex-acp` 当“provider”驱动（`goose/crates/goose/src/providers/claude_acp.rs`、`codex_acp.rs`），OpenClaw 用 ACP 驱动外部 harness（`openclaw/docs/tools/acp-agents.md`），可以证明路线可行。
2. **ACP v1 稳定面不覆盖“SuperAgent 式”能力**：稳定方法只有 `initialize / authenticate / session/new|load|list|resume|close|delete|prompt|cancel / set_mode / set_config_option` 以及 client 侧 `session/request_permission|update`、`fs/*`、`terminal/*`、`elicitation/*`。**fork、subagent 会话、steering、queue、后台任务、session/status** 目前要么是 *unstable*（`session/fork`、`session/status`、`session/archive`），要么是 RFD（subagents），要么是**扩展方法**（`_session/steering`，claude-agent-acp 与 codex-acp 都已实现）。
3. **最深的编程控制面是各家的“原生接口”而不是 ACP**：
   - Codex：`codex app-server`（JSON-RPC 2.0，stdio/WebSocket/Unix socket），一等公民的 `thread/fork`、`turn/steer`、`turn/interrupt`、`thread/queue/*`、`collab` 子 agent 项、`dynamic_tools`、远程控制配对，是“最适合当子 agent 的协议”。
   - Claude Code：Claude Agent SDK / `claude -p --input-format stream-json --output-format stream-json --permission-prompt-tool stdio` 的 **control protocol**（`control_request` / `control_response`），有 `interrupt`、`can_use_tool`、`priority: now|next|later` 的插话语义、`forkSession(upToMessageId)`、33 种 hook 事件。
   - OpenCode：新版 `opencode serve` 是 HTTP + SSE + OpenAPI 3.1（`/api/session/{id}/prompt` 带 `delivery: steer|queue`、`/interrupt`、`/fork {before}`、`/inbox`、`/api/event`、`/api/experimental/schedule`），**它自己的会话模型就几乎是 SuperAgent 的形状**，是本项目架构最值得抄的对象。
4. **建议：采用“ACP 为主干（南向统一）+ 原生适配器作逃生舱”的混合策略**，而不是纯 ACP 或纯原生：
   - 内部定义一套 **Canonical Agent Event 模型**（ACP `session/update` 的超集，补上 steer/fork/queue/background/callback），所有外部 agent 经 **Driver** 翻译成该模型；Driver 优先用 ACP（零成本接入 30+ agent），对 Claude Code 与 Codex 这两个核心对象在 ACP 能力不足处（steer、fork 到指定消息、队列、后台任务）走原生通道或扩展方法。
   - 这样“主 agent 只做分发、子 agent 全部有状态可 fork/可插话、一切皆事件”可以直接落在 Driver 能力矩阵上，缺能力的 agent 做降级（见 §6.4）。
5. **合规是硬约束**：Anthropic 官方禁止第三方“提供 claude.ai 登录/用订阅额度代用户转发”。可行路径只有 ①用户自己的 API Key；②调用**未修改的、用户本机已登录的 `claude` 二进制**（用户自行登录）。不得收集/存储/中转 Claude.ai OAuth token。详见 §7。
6. **Gemini CLI 的现状已变**：官方 README（2026-11 快照）声明 Gemini CLI 现仅面向 Code Assist Standard/Enterprise，个人免费与 Google AI Pro/Ultra 已于 2026-06-18 迁往 **Antigravity CLI（`agy`）**；Antigravity 有 ACP 原生支持（registry id `antigravity-acp`）。接入 Google 系建议以 `agy`/ACP 为准，Gemini CLI 作次要。

---

## 1. 调研范围与方法

- 读源码：Codex（Rust，`codex-rs/app-server*`、`exec`、`cli`、`codex-rs/app-server-protocol`）；OpenCode（TS/Effect，`packages/protocol|schema|server|cli/src/acp`）；ACP 规范与 schema（`docs/protocol/v1|v2`、`docs/rfds`、`schema/v1|v2`）；claude-agent-acp、codex-acp 适配器；Goose 的 ACP provider。
- 读官方文档（含时间）：Claude Code 官方 headless/SDK/hooks/legal 页面、Codex app-server/SDK 页面、OpenCode server 页面、Gemini CLI headless 文档、Cline CLI 参考、Aider scripting。
- 不能确认的，标“未证实”。

---

## 2. 各家编程 Agent 的可编程驱动接口

### 2.1 Claude Code（Anthropic，闭源 CLI；SDK 开源壳）

**三种官方驱动方式**

| 方式 | 说明 | 来源 |
|---|---|---|
| Agent SDK（TS `@anthropic-ai/claude-agent-sdk`、Python `claude_agent_sdk`） | 库形态，内部 spawn `claude` 二进制，用 control protocol 通信；`query({prompt: string \| AsyncIterable<SDKUserMessage>, options})` 返回 `Query`（AsyncGenerator + 控制方法） | https://code.claude.com/docs/en/agent-sdk/overview |
| Headless CLI：`claude -p ... --output-format text\|json\|stream-json` | 一次性任务；`stream-json` 需 `--verbose`，`--include-partial-messages` 才有 token 级 `stream_event`；末行为 `result`（含 `session_id`、成本、`permission_denials`） | https://code.claude.com/docs/en/headless |
| 双向流：`claude --input-format stream-json --output-format stream-json --permission-prompt-tool stdio` | SDK 内部实际使用的协议；stdin 写 `user` 消息与 `control_response`，stdout 读消息与 `control_request`。`--permission-prompt-tool stdio` 在 `--help` 中隐藏（第三方文档：docs.rs `neosh_provider::drivers::claude_control`、`Roasbeef/claude-agent-sdk-go/docs/cli-protocol.md`） | 第三方，**协议未被 Anthropic 承诺稳定**（clawdipedia 控制协议页标注 “Undocumented … can change without notice”） |

**流式事件**：输出是 NDJSON，类型有 `system`(init/compact_boundary/permission_denied 等)、`assistant`（每个完整 content block 一条，含 `parent_tool_use_id` 以标识子智能体产生的消息）、`user`（工具结果）、`stream_event`（原始 Claude API SSE：`message_start / content_block_delta …`，**子智能体的 token 级 delta 不转发，只转发完整消息**，见 streaming-output 文档）、`result`。

**权限审批**
- 评估顺序（官方 permissions 文档）：Hooks → deny 规则 → ask 规则 → 权限模式（`default/acceptEdits/plan/bypassPermissions/dontAsk/auto`）→ allow 规则 → `canUseTool` 回调。
- 双向流下：CLI 发 `{"type":"control_request","request_id":..,"request":{"subtype":"can_use_tool","tool_name","input","tool_use_id","permission_suggestions":[…]}}`，宿主回 `control_response`，`response:{behavior:"allow"|"deny", updatedInput?, updatedPermissions?, message?}`。`permission_suggestions` 就是“以后都允许”的规则原文，可直接回传实现 “Always allow”。
- `AskUserQuestion` 也走 `canUseTool`；等待时间无上限，长等待建议用 `PreToolUse` hook 返回 `defer` 让进程退出后再续（官方 user-input 页）。
- `PermissionRequest` hook 可用于对外推送审批通知（Slack/邮件/Push）——天然适配“事件化”。

**会话恢复 / 分支**
- 会话落盘 `~/.claude/projects/<dir>/<uuid>.jsonl`。CLI：`--continue`、`--resume <id|jsonl路径>`、`--fork-session`；SDK：`resume`、`continue`、`forkSession`；独立函数 `forkSession(sessionId, {upToMessageId, title})` 返回新 `sessionId`——**可从任意消息处分叉**（官方 sessions 页）。
- 注意：fork 只分叉对话，不分叉文件系统；文件回滚用 `enableFileCheckpointing` + `rewindFiles()`。fork 不带原会话的 file checkpoint。
- `SessionStart` hook 的 matcher 含 `fork`、`resume`、`compact` 等。

**插话 / 中断（steer / interrupt）**
- 流式输入模式下 `SDKUserMessage` 带 `priority: 'now'|'next'|'later'`（第三方转录自 `sdk.d.ts`，SDK 0.3.281+）：`next`（默认）= 当前工具调用结束后在**同一 turn 内**读到（即 steering）；`later` = 等 turn 结束后作为新 turn；`now` = 中断后立刻处理（v2.1.286+ 若带 `origin:{kind:"human"}`，可移动的 shell/子智能体/MCP 调用转入后台而不打断）。
- `Query.interrupt()`（control_request `interrupt`，v2.1.205+ 返回 receipt）、`stopTask(taskId)` 停单个后台任务、`setPermissionMode()`、`setModel()`、`rewindFiles()`、`setMcpServers()`、`reconnectMcpServer()` 等都是运行中控制。
- `shouldQuery:false` 可只追加上下文不触发 turn；`cancel_async_message` 可撤回排队消息。

**Hooks（官方 https://code.claude.com/docs/en/hooks）**：33 种事件，含 `SessionStart/End`、`UserPromptSubmit`、`PreToolUse`、`PermissionRequest`、`PostToolUse`、`Notification`（`permission_prompt/idle_prompt/agent_needs_input/agent_completed`…）、`SubagentStart/Stop`、`Stop`、`TaskCreated/Completed`、`PreCompact`、`WorktreeCreate/Remove`、`FileChanged`、`Elicitation` 等。SDK 可通过 `initialize` control_request 注册进程内 hook 回调（`hook_callback_ids`），也可用 settings.json 的 command/http hook。对本项目：hooks 是把 Claude Code **反向变成事件源**的最佳入口（`Stop`/`Notification` → 事件总线）。

**子智能体（Claude 自身）**：SDK 支持自定义 subagents；子智能体消息带 `parent_tool_use_id`；hook `SubagentStart/Stop`；另有 “agent teams”（`TeammateIdle`）与 “dynamic workflows/ultracode”（claude-agent-acp README 提及）。

**ACP 适配**：`@agentclientprotocol/claude-agent-acp`（原 `zed-industries/claude-code-acp`，现 registry id `claude-acp`），基于 Agent SDK，`src/acp-agent.ts` 单文件约 1 万行：
- `canUseTool` → `session/request_permission`；`query.interrupt()` → `session/cancel`（`acp-agent.ts` ~L9239）。
- `unstable_forkSession`（L3218，`src/fork-session.ts` 调 SDK `forkSession`）；`resume`（L3187）。
- **steering 扩展**：`_session/steering`（L700），在 `InitializeResponse._meta.steering.supported` 声明（L3103），把消息注入进行中的 turn 而非排队成新的 `session/prompt`。
- 子智能体：`src/acp-subagents.ts`、`native-subagents.ts`；客户端声明 `clientCapabilities.subagents` 后，每个 Task/Agent 子智能体变成独立 child session。
- 后台任务：`_session/async_task/stop`、`background-work.ts`、`task-notifications.ts`。
- 提供独立可执行文件（Linux/macOS/Windows，x64/arm64），内含 `claude` CLI，免 Node（README）。

### 2.2 OpenAI Codex CLI（Rust，Apache-2.0）

仓库 `codex-rs`（Cargo workspace 数百个 crate）。对外有 **四种接口**：

| 接口 | 入口 | 备注 |
|---|---|---|
| `codex app-server`（**主推的富客户端协议**） | `codex-rs/app-server`（服务）、`app-server-protocol`（协议）、`app-server-transport`（传输）、`app-server-client`（进程内/远程客户端）、CLI 入口 `cli/src/main.rs`（`Subcommand::AppServer`） | VS Code 扩展、Codex Desktop、TUI 自身都用它 |
| `codex exec --json` | `codex-rs/exec/src/exec_events.rs`（`ThreadEvent`：`thread.started/turn.started/turn.completed/turn.failed/item.started/item.updated/item.completed/error`） | 一次性/CI，TS SDK `@openai/codex-sdk` 就是 spawn 它并读 JSONL（`startThread/resumeThread/run/runStreamed`，线程存 `~/.codex/sessions`） |
| 进程内 | `app-server-client` crate（typed channel，`InProcessServerEvent`） | Rust 宿主可直接嵌入，**对本项目 Rust 技术栈极有价值** |
| `codex mcp-server` | 本快照 `cli/src/main.rs` 的 Subcommand 列表**未见** `McpServer`，仓库中也找不到 `mcp-server` 的文档/配置 | **未证实**是否已移除或改名，使用前需 `codex --help` 复核；`Mcp(McpCli)` 只是管理 Codex 作为 MCP *客户端* 的配置 |

**app-server 协议要点**（源码：`app-server-protocol/src/protocol/common.rs` 约 4700 行，`client_request_definitions!` 宏列出全部方法；官方页 https://developers.openai.com/codex/app-server）
- 传输（`app-server-transport/src/transport/mod.rs`）：`stdio://`（默认，JSONL）、`ws://IP:PORT`（官方标注 “experimental and unsupported”，一帧一消息，并同端口提供 `/readyz` `/healthz`）、`unix://[PATH]`（WebSocket over UDS）、`off`。WebSocket 认证：`--ws-auth capability-token|signed-bearer-token`；队列满时返回 `-32001 Server overloaded`。**JSON-RPC 2.0（线上省略 `jsonrpc` 头）**，类 MCP 的双向。
- 握手：`initialize{clientInfo, capabilities{experimentalApi, optOutNotificationMethods, requestAttestation, requiredHumanApproval…}}` → `initialized` 通知。可 `codex app-server generate-ts|generate-json-schema` 生成与版本精确匹配的 schema（**强烈建议用它做类型绑定**）。
- 对象模型：**Thread → Turn → Item**。Item（`v2/item.rs` `ThreadItemPayload`）：`UserMessage / AgentMessage / Plan / Reasoning / CommandExecution / FileChange / McpToolCall / DynamicToolCall / CollabAgentToolCall / SubAgentActivity / ImageView / EnteredReviewMode / ContextCompaction …`。其中 `CollabAgentToolCall` 的 `tool` 枚举为 `SpawnAgent / SendInput / ResumeAgent / Wait / CloseAgent / SendMessage / FollowupTask / InterruptAgent / ListAgents` ——**Codex 自己就有“多 agent 协作”原语，有 `sender_thread_id / receiver_thread_ids / agents_states`**。
- 会话生命周期：`thread/start|resume|fork|list|read|archive|unarchive|delete|revert|compact/start|name/set|settings/update|goal/*|queue/*|attachment/*|inject_items`；回合：`turn/start|steer|interrupt|settings/update`。
  - **fork**：`ThreadForkParams{thread_id, last_turn_id?, before_turn_id?, path?, ephemeral…}`——可 fork 到指定 turn（含/不含）；不可从进行中的 turn fork。
  - **steer**：`TurnSteerParams{thread_id, input[], expected_turn_id（必填的前置条件，与当前活动 turn 不符则失败）, client_user_message_id…}` 向进行中的 turn 追加输入，不新建 turn。
  - **interrupt**：`turn/interrupt` → 以 `turn/completed` 终止，`status` 为 interrupted。
  - **queue**：`thread/queue/add|list|update|delete|reorder|start`（服务端消息队列，`thread/queue/changed` 通知）。
  - **rollback**：`thread/rollback` 已被移除（README “Thread rollback” 节），用 `thread/revert` 与 fork 替代。
- 流式通知：`thread/started`、`thread/status/changed`、`turn/started|completed`、`turn/diff/updated`、`turn/plan/updated`、`item/started|completed`、`item/agentMessage/delta`、`item/commandExecution/outputDelta`、`item/fileChange/patchUpdated`、`item/mcpToolCall/progress`、`thread/tokenUsage/updated`、`serverRequest/resolved`、`hook/started|completed` 等；连接级可 `optOutNotificationMethods` 精确屏蔽。
- **审批 = 服务端向客户端发 Request（需应答）**：`item/commandExecution/requestApproval`、`item/fileChange/requestApproval`、`item/permissions/requestApproval`、`item/tool/requestUserInput`、`mcpServer/elicitation/request`、`item/tool/call`（`DynamicToolCall`，**宿主向 Codex 注入自定义工具**，`thread/start.dynamicTools`）。命令审批决定枚举 `CommandExecutionApprovalDecision`（`v2/item.rs` L68）：`accept / acceptForSession / acceptWithExecpolicyAmendment / applyNetworkPolicyAmendment / decline / cancel`（`cancel` = 拒绝并中断 turn）。策略 `AskForApproval`（`v2/shared.rs` L213）：`untrusted / on-request / granular{sandbox_approval,rules,skill_approval,request_permissions,mcp_elicitations} / never`；沙箱 `SandboxMode`（read-only / workspace-write / danger-full-access）；另有 `approvals_reviewer`（Guardian 自动审批，`item/autoApprovalReview/*`）。
- 远程：`remoteControl/enable|disable|status/read|pairing/start|pairing/status|client/list|client/revoke`（`common.rs` L1209-1245），`codex --remote ws://…`（TUI 连远端 app-server），`codex remote-control`、`stdio-to-uds`、`tcp-tunnel` 子命令——Codex 自己已内建“多机 + 配对”的雏形（细节未深读，**未证实其成熟度**）。
- 环境：`environment/add|info|status`、`fs/*`、`process/spawn|writeStdin|kill|resizePty`、`command/exec*`——宿主可把 Codex 的执行环境指到另一台机器（`exec-server` crate）。

**ACP 适配**：`@agentclientprotocol/codex-acp`（`codex-acp/src/CodexAcpClient.ts`、`CodexAppServerClient.ts`、`CodexJsonRpcConnection.ts`）——**本身就是 spawn `codex app-server` 并翻译**。支持 `_session/steering`（`AcpExtensions.ts` L43）、fork（`SessionFork.ts`）、原生 ACP 子 agent 会话（协商后）、`/review`、`/compact`、`/goal` 等。npm 包自带兼容版 `@openai/codex`（`CODEX_PATH` 可覆盖）。旧仓 `zed-industries/codex-acp` 已标注迁移。

### 2.3 OpenCode（sst/opencode，TS + Effect + Bun）

仓库 2026-11 已重构为多包 monorepo：`packages/{protocol,schema,server,client,sdk,core,cli,tui,app,desktop,process-daemon,plugin…}`。

- **`opencode serve`**：HTTP 服务，OpenAPI 3.1（`packages/protocol/openapi.json`，文档页 `http://host:4096/doc`），默认 `127.0.0.1:4096`，`OPENCODE_SERVER_PASSWORD` 开启 HTTP Basic，`--cors`、`--mdns`；`/api/pair` + `/auth/connect/{code}`（`packages/server/src/pairing.ts`：16 字节随机码、TTL 5 分钟、一次性）做配对。官方 docs（https://opencode.ai/docs/server/）还列出旧版 `/session…` 路由与 `/global/event` SSE；**新版 `/api/*` 是 `packages/protocol/src/groups/*.ts` 声明的**（本地 openapi.json 有 130+ 路径）。
- **会话模型（SuperAgent 味最浓）**（`packages/protocol/src/groups/session.ts`、`packages/schema/src/session-inbox.ts`、`session-event.ts`）：
  - `POST /api/session/{id}/prompt`：“Durably admit one session input and schedule agent-loop execution”，载荷含 **`delivery: "steer" | "queue"`**、`resume`；返回 `Session.Inbox.User`。**输入先持久化进 inbox 再被调度**——“一切触发皆事件/消息入箱”的现成实现。
  - `GET /api/session/{id}/inbox`、`PATCH /inbox/{inboxID}`（修改投递模式，“Steering wakes session execution”）、`DELETE /inbox/{inboxID}`（取消未投递项）。inbox 项类型：`user / synthetic / compaction / move`。
  - `POST /api/session/{id}/interrupt`（`resume=true` 时继续处理 steering 输入与下一个控制项，排队 prompt 继续 parked）、`/background`（把前台可后台化工具转后台）、`/fork {before?: messageID}`（按消息分叉出**子会话**）、`/compact`（默认 steer：在下个 step 边界执行）、`/revert/stage|commit`、`/experimental/session/{id}/wait`。
  - 会话有 `parentID/children`，Task 子 agent 即子会话；`/api/experimental/schedule`（`in/at/cron` 定时，`packages/schema/src/schedule.ts`）= **内建定时触发**。
  - 事件总线：`GET /api/event`（SSE，可 `types=` 过滤，首条 `server.connected`），持久化事件（`Event.durable`）：`session.created/forked/inbox.enqueued|delivered|cancelled|delivery.changed`、`session.execution.started|succeeded|failed|interrupted`、`session.step.*`、`session.text.delta`、`session.reasoning.*`、`session.tool.input.*|called|progress|success|failed`、`session.compaction.*`、`session.revert.*`、`session.usage.*`…（`session-event.ts`）。
  - 权限：`POST /api/session/{id}/permission/{requestID}/reply`、`/api/permission/saved`（持久化“记住”）；新旧并存（旧：`POST /session/:id/permissions/:permissionID {response, remember?}`）。表单/问询：`/api/session/{id}/form/{formID}/reply`。
  - 其它：PTY/WebSocket（`/api/pty/{id}/connect`）、worktree（`/api/worktree`）、MCP 管理、`/api/rpc/{rpcID}/{method}`、`/api/experimental/session/{id}/export|import`。
- **`opencode run --format json`**：行式 JSON 事件（`cli/src/run/noninteractive.ts`：`tool_use / step_start / step_finish / error / retry / background_wait`…）；`--auto` 自动批准。
- **`opencode acp`**：`packages/cli/src/acp/*`（`agent.ts` 注册 `session/load|resume|fork|cancel|set_config_option`；`child.ts` 用自定义 `opencode/session/child_update` + `_meta["opencode/child-session-updates"]` 把子会话映射给 ACP 客户端；`permission.ts`、`elicitation.ts`、`compaction.ts`）。起一个**私有**服务器，stdio NDJSON，不开端口。
- SDK：`packages/sdk`（`@opencode-ai/sdk`，由 OpenAPI 生成，可 `createOpencode()` 同进程起 server+client）；`packages/client` 有 Effect/Promise/Solid 三套。

### 2.4 Gemini CLI / Antigravity CLI（Google）

- **Gemini CLI**（`google-gemini/gemini-cli`，Apache-2.0）：`-p/--prompt` 进入 headless；`--output-format text|json|stream-json`；stream-json 事件 `init / message / tool_use / tool_result / error / result`（https://geminicli.com/docs/cli/headless/ ，2026-03-10 更新）；退出码 `0/1/42(输入错误)/53(超轮数)`；`--approval-mode default|auto_edit|yolo|plan`；`--resume latest|index|uuid`、`--list-sessions`；会话存 `~/.gemini/tmp/<project_hash>/chats/`，手动检查点 `/resume save <tag>`（命名分支点，**无 headless fork API**，未见证实）；Hooks（`BeforeAgent/AfterTool/Notification/SessionStart`…，stdin/stdout JSON，退出码 2 阻断）；子 agent（`codebase_investigator/generalist/browser_agent`）；ACP：`--experimental-acp`/`--acp`（`packages/cli/src/acp/acpClient.ts`，**ACP 第一个参考实现**，`setSessionMode` 映射审批级别，文件读写代理给客户端）；SDK `packages/sdk`（`GeminiCliAgent.resumeSession`）。
- **状态变化（重要）**：官方 README 2026-11 快照声明 Gemini CLI 仅面向 Code Assist Standard/Enterprise；免费与 Google AI Pro/Ultra 于 **2026-06-18** 迁至 **Antigravity CLI（`agy`）**（README 的 “Read before installing” 提示框；转型细节页未读，**细节未证实**）。ACP registry 里 Antigravity 为 `antigravity-acp`，命令 `agy_acp_server.par`（来源：AgentRQ 博客 2026-10-02 的表格，**第三方，未与 registry 原文核对**）。

### 2.5 Goose（Block，Rust）

- 两种服务形态：`goosed`（REST + WebSocket，历史）与 **`goose serve`/`goose acp`（ACP over stdio 或 HTTP/WebSocket）**；官方 `CUSTOM_DISTROS.md` 明确“Build a new UI → Integrate with `goose serve` over ACP”，2026-04-08 博客说明客户端通信已统一到 ACP（`documentation/blog/2026-04-08-goose-acp-and-new-tui`）。
- 源码：`crates/goose/src/acp/server.rs`（`GooseAcpAgent`、`on_new_session / on_load_session / on_fork_session / on_close_session`，权限走 `RequestPermissionRequest`，约 L1552）、`acp/transport/`（HTTP/WS、`auth.rs`、`tls.rs`）、`acp/provider.rs`（**Goose 作为 ACP 客户端**去驱动别的 agent）、`providers/claude_acp.rs`、`codex_acp.rs`（二进制名 `claude-agent-acp`、`codex-acp`，`RUNS_OWN_TOOL_LOOP=true`、`SESSION_BOUND=true`，且 `providers/claude_code.rs`/`codex.rs` 仍保留 CLI 直驱的旧路径）。
- 子智能体：`crates/goose/src/agents/subagent_handler.rs`、`subagent_execution_tool/`、recipe 的 sub-recipes。对本项目：**Goose 是“Rust + ACP 双向（既是 agent 又是 client）+ 驱动 Claude/Codex 做 provider”的最近似参考实现。**

### 2.6 Cline / Kilo / Aider / 其它

| Agent | 驱动方式 | 说明 |
|---|---|---|
| **Cline CLI 2.0**（2026-02） | `cline --json "task"` 输出 NDJSON（`agent_event / hook_event / team_event / run_result / run_aborted`），`--acp`（ACP 模式下 `--auto-approve` 默认 false），`--id` 续会话，`-z/--zen` 后台 hub，`cline hub` 本地守护，`cline schedule` | 文档：docs.cline.bot / `docs/cli/cli-reference.mdx`；ACP 入口 `apps/cli/src/acp/index.ts` |
| **Kilo** | `npx @kilocode/cli acp`（原生 ACP，registry id `kilo`） | 来源：AgentRQ 表（第三方），Kilo 是 Cline 衍生（OpenCode 系）**未深读** |
| **Aider** | `--message/-m`、`--message-file`、`--yes`；Python `Coder.create().run()`（官方明确“不受支持/无稳定 API”）；无服务/无结构化事件；无 ACP 原生 | https://aider.chat/docs/scripting.html；定位：仅可作“一次性 CLI 子任务”，**不建议作为一等子智能体** |
| Cursor CLI | `cursor-agent acp`（原生） | 第三方表 |
| GitHub Copilot CLI | `npx @github/copilot --acp` | 第三方表 |
| Kimi / Qwen Code / Mistral Vibe / Junie / Auggie / Factory Droid / Devin / Grok Build / Qoder / Codebuddy / Poolside / Pi（`pi-acp` 社区适配）/ Amp（社区适配）/ OpenHands / OpenClaw / Hermes | 均列于 ACP “Agents” 页或 registry | https://agentclientprotocol.com/get-started/agents ；registry 页 https://agentclientprotocol.com/get-started/registry （注：agent 页里还有 “Muse Spark Code（Meta Muse Spark 的非官方 agent）”，与另一课题的“Muse”可能相关，仅记录，不展开） |

---

## 3. ACP（Agent Client Protocol）深入

### 3.1 沿革与治理
- 2025-06 由 Zed 创建，Apache-2.0，无 CLA；现仓库 `agentclientprotocol/agent-client-protocol`（规范 + schema），官方库：Rust（`agent-client-protocol` 5.0.0，crates.io，2026-11-02；`rust-sdk` 仓含 Client/Agent/Proxy/Conductor 角色、`agent-client-protocol-http`、`-rmcp`）、TypeScript（`@agentclientprotocol/sdk`，v1/v2 双入口：默认 v1，`/unstable`、`/experimental/v2`）、Kotlin、Java、Python。Rust/TS SDK 于 2026-06-25 达 1.0。
- 2026-01-28 ACP Registry 上线（Zed 博客），Zed 与 JetBrains 内置；agent 提供 `agent.json`（含分发信息）+ `icon.svg`。

### 3.2 协议核心（v1 稳定，`schema/v1/meta.json`）
- 传输：**仅 stdio**（NDJSON，一行一条 JSON-RPC，消息内不得含换行；stderr 仅日志）（`docs/protocol/v1/transports.mdx`）。**远程传输（Streamable HTTP + WebSocket 同一 `/acp` 端点，`Acp-Connection-Id`/`Acp-Session-Id` 头，HTTP/2，POST 立即 202，SSE/GET 分连接级与会话级流）仅为 RFD**（`docs/rfds/streamable-http-websocket-transport.mdx`，目标并入 v1，可靠性/重连语义推迟到 v2）。Goose 的 `goose serve` 已自行实现 HTTP/WS。
- Agent 方法：`initialize / authenticate / logout / session/new / load / list / resume / close / delete / prompt / cancel / set_mode / set_config_option`；Unstable：`session/fork / archive / unarchive / status / set_title`、`providers/*`、`auth/status`、`mcp/message`。
- Client 方法：`session/request_permission`、`session/update`（通知）、`fs/read_text_file|write_text_file`、`terminal/create|output|release|wait_for_exit|kill`、`elicitation/create|complete`；协议级 `$/cancel_request`。
- `session/update` 变体（`docs/protocol/v1/prompt-turn.mdx`）：`user_message_chunk / agent_message_chunk / agent_thought_chunk / tool_call / tool_call_update / plan / available_commands_update / current_mode_update / config_option_update / session_info_update / usage_update / notice / compaction_*`…
- 权限：`session/request_permission` 带 `options[{optionId,name,kind: allow_once|allow_always|reject_once|reject_always}]`；“记住”的决定由 **Agent** 持有与解释（`docs/protocol/v1/tool-calls.mdx` L231-251）。
- `session/new|load` 的 `mcpServers`：客户端把自己的 MCP 服务（stdio/http）传给 agent——**这是“主 agent 的工具暴露给子 agent”的标准通道**（见 §6.5）。
- 能力协商：`initialize` 交换 `clientCapabilities{fs,terminal,elicitation,subagents(RFD)…}` / `agentCapabilities{loadSession,promptCapabilities,mcpCapabilities,sessionCapabilities{list,resume,close,fork…}}`。

### 3.3 与 SuperAgent 诉求的差距（逐项）

| SuperAgent 需求 | ACP 现状（2026-11-06） |
|---|---|
| 有状态子 agent | ✅ session 即有状态；`session/load|resume|list|close` 稳定 |
| 随时 fork/branch | ⚠️ `session/fork` 为 unstable（RFD 提议只 fork 整个会话，未来可扩展“指定消息”；见 `docs/rfds/session-fork.mdx`）；claude-agent-acp 通过 `_meta.jetbrains.air.fork.messageId` 扩展实现“按消息 fork”（`src/fork-session.ts`） |
| 中途插话 steer | ⚠️ 规范没有。事实标准 = 扩展方法 `_session/steering`（claude-agent-acp、codex-acp 均实现；`InitializeResponse._meta.steering.supported` 声明）。**v2 的新 prompt 生命周期**：`session/prompt` 的 response 在“消息被插入”时返回而非 turn 结束，且“agent 不得仅因有活动工作而拒绝 prompt”；**显式 queue/steer 能力推迟到后续 RFD**（`docs/rfds/v2/prompt.mdx` L88、`overview.mdx` L146） |
| 中断 | ✅ `session/cancel`（+ `$/cancel_request`） |
| 子智能体可见/可控 | ⚠️ RFD `subagents`：`subagent_update`（upsert）、子会话独立 sessionId、`session_message` 带发/收方、`capabilities.cancel`；v1 需客户端声明 `clientCapabilities.subagents`，v2 为基线。claude-agent-acp / codex-acp 已实现，opencode 用私有 `opencode/session/child_update`。**暂无 client 侧 steer/queue 子 agent** |
| 后台任务 | ⚠️ v2 unstable：`background work`（CHANGELOG 1.15.0）；claude-agent-acp 有 `_session/async_task/stop` |
| 外部触发/事件 | ❌ 不在范围；agent 可在 v2 随时发 `session/update`（含无 prompt 的主动消息）；调度/Webhook 需自己做 |
| 多机/远程 | ⚠️ 仅 RFD；另有 `proxy-chains` RFD（`proxy/initialize`、`proxy/successor`，Rust SDK `conductor`）可在 agent 前插中间件 |
| 工具扩展 | ✅ MCP；RFD `mcp-over-acp`（`mcp/message`，把 MCP 通过 ACP 连接反向承载，TS SDK 已出 MCP-over-ACP caller/provider，unstable） |

### 3.4 v2 动向
`docs/rfds/v2/*`：新 prompt 生命周期、去掉 `session/set_mode`（并入 config options）、去掉 client 侧 `fs/*` `terminal/*`（改为 agent 持有、display-only terminal）、`tool_call` 与 `tool_call_update` 合并为 upsert、plan_update、message-updates、permission-requests 重写、diff file states、metadata patches、background work。TS SDK 已提供 `experimental/v2`；适配器已在 `claude-agent-acp/src/v2`、`codex-acp/src/AcpV2*.ts` 并行实现。**判断：v2 尚在 alpha（TS 注明“may change incompatibly in any release”），本项目应以 v1(+unstable 能力探测) 为基线，保持抽象层隔离，v2 稳定后再切换。**

---

## 4. 对比表：可编程驱动接口

> 图例：✅ 原生/稳定；⚠️ 受限/实验/需扩展；❌ 无；“扩展”= 非规范的私有扩展。

| 维度 | Claude Code | Codex | OpenCode | Gemini CLI / agy | Goose | Cline CLI | Aider | ACP v1 规范 |
|---|---|---|---|---|---|---|---|---|
| 主要程序化入口 | Agent SDK（TS/Py）；`claude -p` stream-json 双向 control protocol | `codex app-server`（JSON-RPC）；`exec --json`；TS SDK；进程内 crate | `opencode serve`（HTTP+SSE+OpenAPI）；JS SDK；`run --format json` | `-p` headless；SDK；`--acp` | `goose serve`/`goose acp`（ACP）；`goosed` REST/WS | `cline --json`；`--acp`；hub 守护 | `--message` CLI；非官方 Python | stdio JSON-RPC（HTTP/WS 为 RFD） |
| 协议/线格式 | NDJSON（自有 SDKMessage + control_request/response，**control 部分未承诺稳定**） | JSON-RPC 2.0（省略 jsonrpc 头）；stdio/ws/unix；可生成 TS/JSON schema | REST + SSE（`/api/event`），OpenAPI 3.1 | NDJSON（`init/message/tool_use/tool_result/error/result`）；ACP | JSON-RPC (ACP) over stdio/HTTP/WS | NDJSON（`agent_event` 等）；ACP | 无 | JSON-RPC 2.0 NDJSON |
| 流式事件粒度 | token 级（`stream_event`，仅主会话）+ 完整 block 消息 | item 级 + delta（`item/agentMessage/delta` 等）+ diff/plan 通知 | step/text/reasoning/tool 全程 delta 事件，持久化事件日志 | message chunk + tool 事件 | ACP 级 | content_start/update/end | stdout 文本 | `agent_message_chunk` / `tool_call(_update)` / `plan` 等 |
| 权限/审批 | `canUseTool` ⇄ `control_request can_use_tool`；hooks；6 种模式；`permission_suggestions` | 服务端 Request：command/fileChange/permissions/userInput/elicitation；决定含 session 级与 execpolicy 修订；`AskForApproval`+沙箱+Guardian 自动审查 | `permission/{id}/reply` + 持久化已存规则；form/问询 | `--approval-mode`；ACP `setSessionMode` | `GooseMode`（auto/approve）+ ACP `request_permission` | `--auto-approve`；ACP 默认关 | `--yes` | `session/request_permission`（4 种 kind；记忆由 agent 持有） |
| 会话恢复 | ✅ `--resume`/`resume`，JSONL 在 `~/.claude/projects` | ✅ `thread/resume`、`thread/list|read|search`，rollout 文件 | ✅ 会话存 DB，`GET /session`，export/import | ✅ `--resume`（项目内） | ✅ `session/load` | ✅ `--id` | ⚠️ 聊天历史文件，非结构化 | ✅ `session/load`/`resume`/`list`（需能力声明） |
| 分支/Fork | ✅ `forkSession(upToMessageId)`；`--fork-session` | ✅ `thread/fork`（`last_turn_id`/`before_turn_id`） | ✅ `/session/{id}/fork {before}` → 子会话 | ❌（仅命名检查点，未证实有 fork） | ✅ `on_fork_session`（ACP） | 未证实 | ❌ | ⚠️ `session/fork` unstable |
| 插话 steer | ✅ 流式输入 + `priority: next`（同 turn 内） | ✅ `turn/steer`（`expected_turn_id` 前置校验） | ✅ `delivery: steer`（inbox，可 PATCH 改投递模式） | ❌ 未见 | 未证实 | 未证实（有 `team_event`） | ❌ | ⚠️ 仅扩展 `_session/steering`；v2 允许活动期发 prompt |
| 排队 queue | ✅ `priority: later`；`cancel_async_message` | ✅ `thread/queue/*` | ✅ `delivery: queue`；inbox CRUD | ❌ | 未证实 | 未证实 | ❌ | ❌（v2 留给后续 RFD） |
| 中断 | ✅ `interrupt` control_request / `priority: now` | ✅ `turn/interrupt` | ✅ `/interrupt`（`resume` 选项）、`/abort`（旧） | Ctrl-C / 进程信号 | ✅ ACP cancel | ✅ ACP cancel / `run_aborted` | 进程信号 | ✅ `session/cancel` |
| 子 agent 原语 | ✅ Task/Agent 工具、`parent_tool_use_id`、Subagent hooks、teams | ✅ `CollabAgentToolCall`(spawn/send/wait/close/interrupt…)、`SubAgentActivity` | ✅ 子会话 `parentID/children`、Task 工具 | ✅ 内置子 agent | ✅ subagent / sub-recipes | ✅ team_event | ❌ | ⚠️ `subagent_update` RFD |
| 内置定时/触发 | ⚠️ `CronCreate`（会话内）、hooks | ⚠️ cloud tasks、automations（未深读） | ✅ `/api/experimental/schedule` | ❌ | ✅ schedule tool / recipes | ✅ `cline schedule` | ❌ | ❌ |
| 远程/多机 | ❌ 进程绑定（Remote Control/云会话为产品功能，未读） | ⚠️ ws/unix + ws-auth、`--remote`、`remoteControl/*` 配对 | ✅ HTTP+Basic+配对码+mDNS | ❌ | ✅ HTTP/WS+TLS+auth | hub 守护 | ❌ | ⚠️ RFD |
| 动态注入宿主工具 | ✅ SDK 进程内 MCP server（`sdk_mcp_servers`）、`setMcpServers` | ✅ `dynamic_tools`（`item/tool/call`）、MCP | ✅ MCP、插件 | ✅ MCP/extensions | ✅ MCP extensions | ✅ MCP | ❌ | ✅ `mcpServers` 随 `session/new` 传入 |
| ACP 支持 | 通过 `claude-agent-acp`（官方 org 维护，丰富扩展） | 通过 `codex-acp`（内部封 app-server） | 原生 `opencode acp` | 原生（ACP 首个参考实现）；`agy` 原生 | 原生 server + client | 原生 `--acp` | ❌ | — |
| 许可 | 闭源二进制，SDK 条款见 §7 | Apache-2.0 | MIT（仓库根 LICENSE，**请复核**） | Apache-2.0 | Apache-2.0 | Apache-2.0（Cline 主仓） | Apache-2.0 | Apache-2.0 |

---

## 5. 关键源码位置速查

**Codex**
- 方法/通知清单：`codex-rs/app-server-protocol/src/protocol/common.rs`（请求 L503-1590，服务端 Request L1866-1915，通知 L2019-2093）
- 类型：`protocol/v2/{thread.rs, turn.rs, item.rs, shared.rs, mcp.rs, remote_control.rs}`；`v1.rs`（`InitializeParams/Capabilities`）
- 传输：`codex-rs/app-server-transport/src/transport/{mod.rs,websocket.rs,remote_control/*}`
- 服务实现：`codex-rs/app-server/src/message_processor.rs`、`bespoke_event_handling.rs`、`in_process.rs`、`managed_daemon.rs`
- 进程内客户端：`codex-rs/app-server-client`
- exec JSONL：`codex-rs/exec/src/exec_events.rs`
- CLI 子命令：`codex-rs/cli/src/main.rs`（`Subcommand`：`AppServer/Exec/Resume/Fork/RemoteControl/ExecServer/Agents/Review…`）

**OpenCode**
- 协议声明：`packages/protocol/src/groups/{session,permission,event,schedule,form,pty,worktree}.ts`；规范 `packages/protocol/openapi.json`
- 数据模型：`packages/schema/src/{session-inbox,session-event,session-message,schedule,permission,form}.ts`
- 服务器：`packages/server/src/{routes,handlers/*,pairing,auth}.ts`
- ACP：`packages/cli/src/acp/{agent,child,permission,elicitation,translate,turn}.ts`
- 非交互：`packages/cli/src/run/noninteractive.ts`

**ACP**
- 规范：`docs/protocol/v1/*.mdx`、`docs/protocol/v2/*`；RFD：`docs/rfds/{subagents,session-fork,streamable-http-websocket-transport,mcp-over-acp,proxy-chains}.mdx`、`docs/rfds/v2/prompt.mdx`
- schema：`schema/v1/schema.json|schema.unstable.json|meta*.json`；Rust 类型 `agent-client-protocol-schema/`

**适配器**
- `claude-agent-acp/src/acp-agent.ts`（`STEER_METHOD` L700、`unstable_forkSession` L3218、`interrupt` L9239）、`fork-session.ts`、`acp-subagents.ts`、`permissions/`、`tool-calls/`、`session-index/`
- `codex-acp/src/{CodexAcpServer,CodexAppServerClient,CodexJsonRpcConnection,AcpExtensions,SessionFork,CodexEventHandler}.ts`

**Goose**
- `crates/goose/src/acp/{server.rs,provider.rs,transport/}`、`providers/{claude_acp,codex_acp,claude_code,codex}.rs`

---

## 6. 统一适配层设计建议

### 6.1 是否以 ACP 为主干？—— 结论：**是，但“ACP 为南向主干 + 内部 canonical 事件模型 + 原生 Driver 逃生舱”**

| 方案 | 优点 | 缺点 |
|---|---|---|
| A. 纯 ACP | 一套代码接 30+ agent；Registry 自动分发；Goose/OpenClaw 已验证；由官方 org 维护 Claude/Codex 适配器 | steer/queue/fork-at-message/background 仍靠扩展，各适配器私有扩展不统一；适配器是 Node 进程（多一层、多一个运行时）；Codex 经 codex-acp→app-server 两层翻译有损；v2 未稳 |
| B. 纯原生（每家写 Driver） | 能力最全、无翻译损耗 | 工作量大且持续跟版本（Claude control protocol “可能无预警变更”）；长尾 agent 无法覆盖 |
| **C. 混合（推荐）** | ACP 覆盖长尾；Claude/Codex 这两个“核心子 agent”在 ACP 不够时走原生；内部事件模型不被任何一家绑死 | 需要维护 Driver 能力矩阵与降级逻辑 |

### 6.2 分层架构

```
┌────────────────────────── Super Agent Core（主 agent，轻量）───────────────────────┐
│  Event Bus（统一事件：UserInput / Schedule / Webhook(GitHub PR) / SubAgentCallback）│
│  Dispatcher（只做路由+规划）  ⇄  Agent Registry（子 agent 实例、状态、能力）          │
└───────────────▲───────────────────────────────────────────────┬───────────────────┘
                │ Canonical Events（见 6.3）                      │ Canonical Commands
┌───────────────┴───────────────────────────────────────────────▼───────────────────┐
│                      AgentDriver trait（Rust）/ 能力矩阵                           │
│  start(spec) / resume(id) / fork(id, at?) / prompt(delivery) / steer / interrupt     │
│  respond_permission / set_mode / close / subscribe() -> Stream<AgentEvent>           │
├──────────────┬───────────────────┬───────────────────┬──────────────────────────────┤
│ AcpDriver    │ CodexNativeDriver │ ClaudeNativeDriver│ OpenCodeHttpDriver / 其它      │
│ (stdio / WS) │ (app-server)      │ (SDK/stream-json) │ (REST+SSE)                    │
└──────┬───────┴─────────┬─────────┴─────────┬─────────┴───────────────┬──────────────┘
       │ spawn           │ spawn / in-proc    │ spawn `claude`           │ http
 claude-agent-acp / codex-acp / gemini --acp / opencode acp / goose acp / cline --acp …
```

- **Host Daemon（每台被控机器一个）**：负责进程生命周期（spawn/kill/重启恢复）、cwd/worktree 隔离、凭据只在本机、把本机 agent 暴露为 ACP-over-WebSocket（对齐 RFD 的 `/acp` 端点和 `Acp-Connection-Id`）。主控侧 `AcpDriver` 对本地用 stdio、对远程用 WS——**这样“连接多台电脑”与“驱动子 agent”是同一抽象**。

### 6.3 Canonical 事件模型（建议最小集）

以 ACP `session/update` 为基准，补齐 SuperAgent 所需：

```
AgentEvent {
  agent_id, session_id, parent_session_id?, seq(单调), ts, origin: Driver
  kind:
    // 对话
    MessageChunk{role, content}  ThoughtChunk  Plan  Usage  SessionInfo
    // 工具
    ToolCall{id, kind, title, status, input, content[], locations}  // upsert 语义（v2 同款）
    // 控制
    PermissionRequest{id, tool_call, options[]}  PermissionResolved
    Elicitation{..}
    // 生命周期（把“回调通知”事件化的关键）
    TurnStarted  TurnEnded{reason: completed|cancelled|failed|max_turns}  Idle  Error{retryable}
    // 子 agent / 分支
    SubAgentSpawned{child_session_id, title, caps}  SubAgentUpdated  Forked{from, at}
    // 后台
    BackgroundTaskStarted/Updated/Ended
}
Command { Prompt{delivery: Steer|Queue|Interrupt, content}, Cancel, Fork{at: MessageRef?}, Resume, SetMode, SetConfig, RespondPermission, Close }
```

关键点：`TurnEnded`/`PermissionRequest`/`Error`/`BackgroundTaskEnded` 同时**投递给主 agent 的事件总线**，即“子智能体回调通知”=事件，与用户输入、定时、GitHub PR 同构（对应 SuperAgent 的“一切触发皆事件”）。借鉴 OpenCode：输入**先持久化入箱再调度**，事件**分 durable 与 ephemeral**，断线可按 `seq` 补发。

### 6.4 能力矩阵与降级

每个 Driver 在 `connect` 后产出 `Capabilities{steer, queue, fork: none|session|at_message, interrupt, background, subagent_sessions, resume, permission_remember, set_mode…}`，来源：ACP `initialize` 的 `agentCapabilities` + `_meta.steering` + 已知 agent 画像。降级规则示例：

| 请求 | 原生支持 | 降级 |
|---|---|---|
| steer | Claude(`priority:next`)、Codex(`turn/steer`)、OpenCode(`delivery:steer`)、ACP 扩展 | 无 → `cancel` 后带上下文重新 `prompt`（可能丢进行中的工具结果，标记为“硬插话”） |
| fork@message | Claude(`upToMessageId`)、Codex(`last_turn_id`/`before_turn_id`)、OpenCode(`before`) | 仅 session 级 fork（ACP unstable）→ 否则 “新会话 + 摘要交接”（Goose 的 `acp/handoff.rs` 做的就是这个 memo 交接，可借鉴） |
| queue | Codex、OpenCode、Claude(`later`) | 在 Core 侧排队，等 `Idle` 再 `prompt` |
| 子 agent 可见 | Claude/Codex/OpenCode 的 child session | 否则把子 agent 当不透明工具 |
| 权限“记住” | 各自语义不同 | 统一在 Core 做“策略引擎”，把子 agent 的审批全部上收；agent 内部 `bypass` 仅在沙箱/worktree 内允许 |

**文件系统层的 fork**：所有 agent 的会话 fork 都**不分叉文件**。建议统一用 git worktree（Claude `WorktreeCreate` hook、OpenCode `/api/worktree`、Cline `--worktree`、Gemini `--worktree` 都说明这是共识）：每个可 fork 的子 agent 绑定一个 worktree，fork 即“会话 fork + worktree 分支”。

### 6.5 反向通道：把主 agent / 本产品能力暴露给子 agent

- 用 ACP `session/new.mcpServers` 把本产品的 MCP server（派发任务、发通知、读共享记忆、浏览器/远程机器工具）注入每个子 agent，这是最通用的做法（Claude 另有进程内 SDK MCP；Codex 另有 `dynamic_tools`；OpenCode `POST /api/mcp`）。
- 子 agent 想“回调”主 agent：优先靠事件（`TurnEnded` 等），需要主动请求时调用上述 MCP 工具（如 `notify_parent`、`spawn_peer`），OpenClaw 的 `openclaw mcp serve` 与 Codex 的 `message-board-mcp` 是同款思路。

### 6.6 其它工程建议
- **Rust 实现 Driver 层**：用 `agent-client-protocol`（rust-sdk）做 ACP 客户端（含 `agent-client-protocol-http` 的 HTTP/WS）；Codex 可直接依赖 `codex-app-server-client`/`app-server-protocol`（同为 Rust，Apache-2.0，可进程内嵌入而不是 spawn）——但注意其 crate 版本随 Codex 主干极快变化且未必作为稳定 API 发布，**未证实是否在 crates.io 提供**；稳妥做法是 `codex app-server generate-json-schema` 后自行生成绑定并 pin 版本。
- **适配器分发**：`claude-agent-acp` 有独立可执行文件（含 `claude`），可随应用打包，免 Node；`codex-acp` 默认 npm（带 `@openai/codex`）。桌面端要决定：捆绑 Node 或只依赖 Registry 的 `distribution` 字段自动下载。
- **版本漂移防护**：Claude control protocol 是未承诺协议 → 首选 ACP/官方 SDK 路径；Codex app-server schema 与版本绑定 → 固定到已测试版本并在握手时校验 `userAgent`/version。
- **可观测性**：所有 Driver 事件落盘为统一 JSONL（同时是“可重放测试夹具”），ACP v2 的 `session_resume_replay` 思路可参考。

---

## 7. 合规与认证（必须在产品设计阶段确定）

来源：https://code.claude.com/docs/en/legal-and-compliance （抓取于 2026-11-06 前后）；The Register 2026-02-20；The New Stack 2026-02-18；autonomee.ai 2026-10-07 更新说明。

- Anthropic：**开发“产品或服务”的第三方（包括使用 Agent SDK 者）应使用 API Key；不允许第三方提供 Claude.ai 登录，或把请求路由到 Free/Pro/Max/Ultra 订阅额度；不得收集、存储、中转 Claude.ai 凭据或会话 token。** 但明确**不限制**“终端用户用自己的订阅登录**未经修改的** Claude Code 二进制”，包括托管环境。运行/预装 Claude Code 需遵守商业条款：**二进制不可修改、不得移除/限制其内置认证方式；不得替终端用户付费/转售/中介 Claude 用量**；不得以 Claude Code/Anthropic 名称或 Logo 作为自己产品名/Logo（可以用纯文本说“运行 Claude Code”）。SDK 品牌准则：下拉菜单用 “Claude Agent”，不得称 “Claude Code Agent”。
- 2026-01 Anthropic 曾封禁抓取订阅 OAuth token 的第三方工具（OpenClaw/OpenCode/Roo 等被点名，来源为 autonomee.ai 综述，**二手**）。
- **产品含义**：
  1. 默认让用户在其机器上安装并登录官方 `claude`（通过 `claude-agent-acp` 的 `CLAUDE_CODE_EXECUTABLE` 指向用户已有二进制），本产品**不接触**其 OAuth token。
  2. 提供“填 API Key / Bedrock / Vertex”选项；不要内置共享 Key 代付。
  3. UI 命名用 “Claude Agent”，不要用 Claude Code 的 Logo/吉祥物。
  4. Codex：app-server 就是官方为富客户端提供的集成面，`clientInfo.name` 用于 OpenAI 合规日志平台，企业向集成需联系 OpenAI 登记（官方 app-server 页）；ChatGPT 账号登录由 `account/login/start` 流程完成（细节与第三方分发条款**未深读，需法务确认**）。
  5. OpenCode/Goose/Cline 等开源 agent 自带 BYOK，合规风险最低，适合做“默认可用”的内置子 agent。

---

## 8. 风险清单

| 风险 | 说明 | 缓解 |
|---|---|---|
| ACP v2 破坏性升级 | TS SDK 声明 v2 随时不兼容；适配器已双栈 | 抽象层 + 以 v1 为基线 + 能力探测 |
| 扩展方法碎片化 | `_session/steering`、`_meta.jetbrains.air.*`、`opencode/session/child_update` 各自为政 | Driver 内部吸收，Core 只见 canonical 模型；关注 steering/queue 后续 RFD |
| Claude control protocol 无承诺 | 逆向文档标注可能变更 | 走官方 SDK / claude-agent-acp；自写 Driver 时锁定 CLI 版本 |
| Codex app-server 实验性 | WS 传输“experimental and unsupported”；非回环监听默认未认证 | 本机用 stdio；远程自己加隧道/认证（或用 `--ws-auth`），不裸露端口 |
| 权限面扩大 | 子 agent `bypass`/`yolo` 带来任意代码执行 | 统一策略引擎 + 沙箱/worktree/容器；审批通知走事件 |
| 适配器运行时依赖 | Node/npm 在用户机上不一定有 | 打包独立二进制（claude-agent-acp 已提供） |
| Gemini CLI 定位变化 | 个人用户转 Antigravity | 以 ACP 抽象屏蔽，优先支持 `agy` |
| 认证/封号 | 订阅 token 滥用被封 | 见 §7 |

---

## 9. 对本项目的具体建议（落地路线）

**Phase 0（1-2 周，验证）**：Rust 写一个 ACP 客户端 demo，用 `rust-sdk` 的 `agent-client-protocol`，分别 spawn `claude-agent-acp`、`codex-acp`、`opencode acp`、`goose acp`、`gemini --acp`，跑通 `initialize → session/new → prompt → request_permission → cancel → session/load`，把事件落成 JSONL；读 Goose 的 `acp/provider.rs` 对照（它是现成的 Rust 参考）。

**Phase 1（MVP）**：
1. 定义 `AgentDriver` trait + Canonical 事件/命令 + 能力矩阵（§6）。
2. 实现 `AcpDriver`（stdio），内置 4 个 agent 画像：Claude(claude-acp)、Codex(codex-acp)、OpenCode、Goose；适配器二进制随安装包/Registry 拉取。
3. 实现事件总线 + 持久化入箱（借鉴 OpenCode 的 inbox/durable event）；把 `TurnEnded/PermissionRequest/Error` 作为一类事件喂给主 agent。
4. 统一审批 UI + 策略引擎；worktree 隔离；steer/interrupt/fork 三个按钮对应能力矩阵（不可用就灰置或降级）。
5. 实现 steering 扩展的消费（`_meta.steering.supported`），对 claude-acp/codex-acp 开启真·插话。

**Phase 2**：
- `CodexNativeDriver`（app-server）取得 `turn/steer`、`thread/queue`、`dynamic_tools`、协作子 agent 的原生可见性；`ClaudeNativeDriver`（SDK）取得 `priority:now` 的“移入后台”语义、hooks 事件源、`permission_suggestions`、`rewindFiles`。
- Host Daemon + ACP-over-WS（对齐 RFD），多机与远程浏览器共享同一通道；配对码+一次性令牌可抄 OpenCode `pairing.ts` / Codex `remoteControl/pairing`。
- 子 agent 会话树可视化（`subagent_update` / child session）。

**Phase 3**：Registry 集成（长尾 agent 一键安装）、v2 迁移、proxy-chain（`conductor`）中间件（审计、成本、DLP）。

**不建议**：自研协议、以 Aider 为一等子 agent、依赖订阅 token 转发。

---

## 10. 待用户拍板的问题

1. **ACP 主干 vs 自有协议**：是否接受“内部 canonical 模型 + ACP 南向 + 原生逃生舱”？还是希望对外也暴露 ACP（让本产品本身成为别的 ACP 客户端里的 agent，如 Goose 同时是 server 与 client）？
2. **Claude 接入策略**：是否接受“默认用户本机官方 `claude` 登录 + API Key 可选，产品不接触订阅 token”（合规优先），即使牺牲一键体验？是否要为企业/付费版准备 API Key/Bedrock 通道？
3. **Codex 深度**：Phase 1 先走 codex-acp（快），还是直接做 app-server 原生 Driver（更深、可直接 Rust 内嵌，但绑定版本）？
4. **运行时打包**：能否接受随安装包捆绑 Node 或多个适配器二进制（体积/更新机制），还是只依赖 ACP Registry 的按需下载？
5. **移动端/Web 如何触达子 agent**：移动端是否只做“遥控器”（经 Host Daemon 的 WS），不直接 spawn 任何 agent？
6. **自动审批边界**：允许子 agent 在 worktree 沙箱内 `bypass`/`yolo` 吗？默认策略是“全部上收主控审批”还是“沙箱内放行”？
7. **v2 时间点**：是否要等 ACP v2 稳定再做事件模型细节（如 tool_call upsert），还是现在就按 v2 语义设计 canonical 层（本报告建议后者，对 v1 向下兼容）？
8. **Gemini/Google 系**：是否把 Antigravity CLI（`agy`）列为一等支持对象，Gemini CLI 作为企业用户选项？

---

## 11. 主要来源（含时间）

**官方文档/页面**
- Claude Code headless：https://code.claude.com/docs/en/headless
- Agent SDK overview / sessions / streaming / permissions / user-input / TS 参考：https://code.claude.com/docs/en/agent-sdk/{overview,sessions,streaming-output,streaming-vs-single-mode,permissions,user-input,typescript,python}
- Claude Code hooks：https://code.claude.com/docs/en/hooks
- Claude Code legal and compliance：https://code.claude.com/docs/en/legal-and-compliance
- Codex App Server：https://developers.openai.com/codex/app-server ；Codex SDK：https://learn.chatgpt.com/docs/codex-sdk.md ；npm `@openai/codex-sdk`（2026-10-29）
- OpenCode server：https://opencode.ai/docs/server/
- Gemini CLI headless（2026-03-10）：https://geminicli.com/docs/cli/headless/ ；CLI reference（2026-05-01）；session management（2026-06-18）；ACP mode：`gemini-cli/docs/cli/acp-mode.md`；README 状态提示（2026-11 快照）
- Cline CLI 参考：https://github.com/cline/cline/blob/main/docs/cli/cli-reference.mdx ；博客 2026-02-03 / 02-13
- Aider scripting：https://aider.chat/docs/scripting.html
- ACP：https://agentclientprotocol.com ；Registry https://agentclientprotocol.com/get-started/registry ；Agents https://agentclientprotocol.com/get-started/agents ；SDK 1.0 公告（2026-06-25）；crates.io `agent-client-protocol` 5.0.0（2026-11-02）
- Zed 博客：Claude Code via ACP（2025-09-03）、The ACP Registry is Live（2026-01-28）；Zed External Agents 文档

**第三方（二手，已标注）**
- Claude 控制协议：docs.rs `neosh_provider::drivers::claude_control`；`Roasbeef/claude-agent-sdk-go/docs/cli-protocol.md`；`littlebearapps/untether` 的 `claude-stream-json` SKILL；clawdipedia.cc 控制协议页；`SDKUserMessage.priority` 来自 `luiscoco/...Tab12-Streaming-input.md` 与 cameronshields.co.uk SDK 镜像（均转录自 `sdk.d.ts`，建议以实际 SDK 版本复核）
- ACP 支持表：AgentRQ 博客 2026-10-02
- 订阅 OAuth 政策报道：The Register 2026-02-20；The New Stack 2026-02-18；autonomee.ai（2026-10-07 更新）

**本地源码**（路径见文首与 §5）
