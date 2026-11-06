# 05 办公/通用 Agent 开源项目分析

> 调研日期：2026-11-06。本地克隆（只读，未构建）：`D:\code\xuqiu\repos\` 下的 `deer-flow`（HEAD 2026-11-06）、`eigent`（2026-11-02）、`UI-TARS-desktop`（2026-10-09）、`OpenManus`（2026-08-16）、`skills`（Anthropic，2026-10-28）。
> 标注约定：「已读源码」= 本机读过对应文件；「网络来源」= 附 URL；「未证实」= 没找到可靠证据。

---

## 0. 结论速览（给决策者）

1. **最值得二开/借鉴的底座是 DeerFlow 2.0（字节，MIT）**。它自称 "long-horizon SuperAgent harness"，和用户想学的"主 agent 轻量分发、子 agent 有状态、事件化触发"同一思想谱系。已读源码确认：lead agent + `task` 工具派发子 agent、子 agent 独立上下文、插话闸门（`ChildInputGate`）、定时任务、GitHub webhook 触发、IM 渠道网关、按需加载 Skills、沙箱虚拟路径、长期记忆可插拔后端。缺点：Python + LangGraph + Docker 重栈，不是"轻量桌面应用"。
2. **最值得借鉴的"产品形态"是 Eigent（Apache-2.0）+ Claude Cowork**。Eigent 是 Electron 桌面端 + 本地 FastAPI 后端 + CAMEL Workforce；已读源码里有 `hands/`（脑手分离）、`remote_sub_agent/`（把外部 agent 当子智能体的 Provider 协议）、`remote_command_controller`（持久化远程控制收件箱）、`permission_policy/`、`run_journal/`。这几块与用户需求（桌面连外部 agent、多机、远程）直接对应。
3. **Anthropic 的 docx/xlsx/pptx/pdf 技能不能拿来复用**。其 LICENSE 明确禁止复制、派生、分发（README 自称 "source-available, not open source"），只能当"写法参考"。我们要自己写这批办公技能，或使用 DeerFlow（MIT）里的同类技能。这点是调研中最容易踩的坑。
4. **Skills 已成事实标准**（`SKILL.md` + 渐进披露，agentskills.io，Claude Code/Codex/Cursor/Gemini CLI/Copilot 均读取）。我们应原生支持该格式，而不是自创技能格式。
5. **computer-use 不要自己造模型**：用 UI-TARS-desktop 的 Operator 抽象（Apache-2.0）或 Agent S（Apache-2.0）做参考，模型层走可替换接口；桌面操控作为"hand"之一，默认关闭、强确认。
6. **沙箱选型分两档**：桌面端本地模式（Cowork 式 VM 或 bubblewrap/容器，可选）；云/远程模式（E2B/Daytona/microVM）。Cowork 的 VM 方案已被公开爆出逃逸链（SharedRoot，见 §3.4），说明"VM 也不是银弹，挂载面要最小化"。

---

## 1. 项目全景对比

| 项目 | 许可 | 语言/栈 | 形态 | 核心做法 | 对我们的价值 | 状态/来源 |
|---|---|---|---|---|---|---|
| **DeerFlow 2.0**（bytedance/deer-flow） | MIT（已读 LICENSE） | Python、LangGraph/LangChain；Next.js 前端 | Web + 网关 + 沙箱 | lead agent + `task` 子 agent、Skills、DeerMem 记忆、Docker/K8s 沙箱、IM 渠道、定时任务 | 高：架构最接近目标，可整体借鉴 | 2026-02-28 发布 2.0 登 GitHub Trending 第 1；2.0.0 正式版 2026-06-25（[release](https://github.com/bytedance/deer-flow/releases/tag/v2.0.0)） |
| **Eigent**（eigent-ai/eigent） | Apache-2.0（已读） | Electron 33 + React 18 + zustand + xyflow；后端 FastAPI + `camel-ai[eigent]==0.2.91a7` | 桌面应用 | CAMEL Workforce 多 agent、8 类角色 agent、Brain/Hands、远程控制、触发器 | 高：桌面形态 + 外部子 agent + 远程控制 | 已读源码 |
| **UI-TARS-desktop / Agent TARS**（bytedance） | Apache-2.0（已读） | TypeScript、Electron、nut-js、pnpm monorepo | 桌面 GUI agent + CLI/Web agent | `Operator` 抽象 + VLM 循环；Tarko 事件流框架 | 中高：computer-use 抽象与事件流 | 已读源码 |
| **OpenManus** | MIT（已读） | Python | CLI/脚本 | `PlanningTool` + `PlanningFlow` + ToolCallAgent；Manus agent 内置浏览器 MCP | 中：最小可读的"规划+工具"教科书实现 | 已读源码，HEAD 2026-08-16 |
| **Suna → Kortix**（kortix-ai/suna） | **未证实**（早期为 Apache-2.0，现状未核实） | TS(Hono) API + Next.js + RN；沙箱内 OpenCode | 云 + 自托管 | 每会话一个"云电脑"沙箱（Platinum microVM / Daytona / E2B），工作经"变更请求"合入 git 主干 | 中：沙箱 provider 抽象、git 化工作区 | [GitHub](https://github.com/kortix-ai/suna/)、[DeepWiki](https://deepwiki.com/kortix-ai/suna/12-platform-and-sandbox-infrastructure)；未克隆 |
| **OWL / CAMEL** | Apache-2.0 | Python | 框架 + 研究 | Workforce：Planner/Coordinator/Workers；GAIA 开源最高 69.09%（论文 Workforce 报 69.70%） | 中：Eigent 即建在 CAMEL 上 | [arXiv 2505.23885](https://arxiv.org/html/2505.23885v2)；最近推送 2026-05 |
| **Agent S / S3 / S4**（simular-ai） | Apache-2.0 | Python `gui-agents` | 研究框架 | 单 agent + 原生编码 agent；Behavior Best-of-N；S3 OSWorld 72.6%（best-of-N，过人类基线 72.36%）；S4 让 agent 自进化工具接口 | 中：computer-use 设计参考，非产品 | [simular.ai](https://www.simular.ai/articles/simulars-computer-use-agent-outperforms-humans)、[对比页 2026-10-22](https://platform.simular.ai/compare/open-source-computer-use-agents) |
| **Skyvern** | **AGPL-3.0** | Python + Playwright | 浏览器自动化服务 | Planner / Actor / Validator 三段循环，视觉推理 | 借鉴"验证器"思想；**AGPL 不能直接嵌入闭源产品** | [官方博客](https://www.skyvern.com/blog/skyvern-2-0-webvoyager-benchmark-results/) |
| **Open-AutoGLM**（zai-org） | 代码 Apache-2.0，模型 MIT | Python、ADB/HDC | 手机 agent | VLM 看截图 → ADB 执行；敏感操作确认；登录/验证码人工接管；WiFi 远程 ADB | 中：移动端 computer-use 方案 | [GitHub](https://github.com/zai-org/Open-AutoGLM)、[博客 2025-12-08](https://autoglm.z.ai/blog/) |
| **Open Interpreter** | 01 子项目 AGPL-3.0 | Python | CLI → 已转向 | 主仓库已改为"面向开源模型的 coding agent"，另有 `interpreter-workstation`（自称 Cowork 开源替代，仅 36 star） | 低：历史意义大于现实价值 | [org 页](https://github.com/openinterpreter) |
| **Manus**（闭源） | 闭源 | - | 云 agent | 云 VM、Wide Research（并行上百子 agent，各自 VM）、Browser Operator（Chrome 扩展接用户登录态）、Plan Mode、Mail Manus、定时任务 | 产品对标：能力清单来源 | Meta 收购（2025-12-29）后被中国监管叫停，2026-09-01 恢复独立（[SCMP](https://www.scmp.com/tech/big-tech/article/3365986/manus-resumes-solo-operations-after-collapse-us2-billion-meta-deal)） |
| **Claude Cowork**（闭源） | 闭源 | Electron + Swift + Go | 桌面 | 本地 Linux VM + VirtioFS 挂载、Plugins、Scheduled tasks、Dispatch（手机派活）、Computer use | 产品对标 | 2026-01-12 研究预览，2026-04-09 GA（[Release notes](https://support.claude.com/en/articles/12138966-release-notes)） |

---

## 2. 深度源码分析

### 2.1 DeerFlow 2.0（重点）

**仓库结构（已读）**：`backend/packages/harness/deerflow/`（可发布的 agent 框架包，导入前缀 `deerflow.*`）与 `backend/app/`（FastAPI 网关 + IM 渠道，前缀 `app.*`）严格单向依赖，CI 里 `tests/test_harness_boundary.py` 强制 harness 不得 import app。这种"框架包/应用"二分值得照搬。

**任务规划**
- 没有独立的 Planner 服务。lead agent（`agents/lead_agent/agent.py`，1457 行；`prompt.py`，1291 行）用 LangChain `create_agent` 搭建，配合中间件链：`TodoMiddleware`（plan mode 下的待办列表）、`SubagentLimitMiddleware`、`SummarizationMiddleware`、`LoopDetectionMiddleware`、`ClarificationMiddleware`、`SkillActivationMiddleware`、`TokenBudgetMiddleware` 等（均在 `agents/middlewares/`，约 60 个文件）。
- 设计哲学写在 README：**子 agent 是"执行优化而非默认选择"**——只在并行提速、专业能力、上下文隔离有明确净收益时才派发；有依赖或副作用重叠的工作不并行；每批完成后重新评估。这正是"主 agent 轻量，只做分发"的务实版本。
- 子 agent 配置（`subagents/config.py`）：`max_turns=50`、`timeout_seconds=900`；内置 `general-purpose`（`disallowed_tools=["task","ask_clarification","present_files"]`，禁止嵌套派发）与 `bash_agent`。`subagents/executor.py` 2598 行，另有 `acceptance_checks.py`（2294 行，子 agent 结果的验收检查）、`batch_service.py`（持久化批量派发）。
- 子 agent 的 ID 约定很细：provider 的 `tool_call_id` 用于关联 UI 卡片/事件，服务端 `execution_id` 管理注册、轮询、取消、超时（`backend/AGENTS.md`）。

**插话/中断（对应用户诉求 7）**：`runtime/runs/input_control.py` 的 `ChildInputGate`：子 agent 在每个"边界"（`boundary()`）检查是否被 `pause`；用户插话经 `release(instructions)` 入队，下一次边界以 `HumanMessage(additional_kwargs={"hide_from_ui":True,"untrusted_input":True})` 注入并 `jump_to: model`。即：**非抢占式 steer，在 turn 边界注入且标记为不可信输入**。这是可直接抄的设计。
- fork/branch：网关有 `checkpoint_lineage.py`（回放检查点的血缘解析），基于 LangGraph 检查点做线程级回放；**子 agent 粒度的任意点 fork 未见到，未证实**。

**事件化触发（对应用户诉求 7）**
- 定时任务：`scheduler/` + `app/scheduler/`，cron 预览 API（`POST /api/scheduled-tasks/preview-cron`），DB 队列 + 租约，同一任务同时只允许一个 `queued/launching/running` 实例，崩溃后可恢复；可多实例（需 Postgres）。
- GitHub 触发：`app/gateway/github/triggers.py`——**事件按 binding 显式 opt-in**（agent 的 `config.yaml` 里 `triggers:` 列出才注册），纯函数过滤（如 `pull_request: actions=[opened]`、`issue_comment: require_mention=True`）。
- IM 渠道：飞书/Slack/Telegram/Discord/钉钉/微信/企微（release notes）。
- MCP 长任务：独立的持久化 `McpTaskService`（租约、重试、死信），agent 循环里只暴露 submit。
- 小结：触发源都经网关归一为"run"，走同一条 `RunManager + run_agent() + StreamBridge` 路径，**但没有统一的"事件总线"抽象**，是各触发器各自入队。我们可以在此之上补一层真正的统一事件模型。

**工具体系**：沙箱工具（`sandbox/tools.py`，3584 行：bash、read_file、write_file(append)、str_replace、ls、glob、grep）、`present_files`（交付产物）、`task`（`tools/builtins/task_tool.py`）、`skill_manage`、MCP、社区工具（`community/`：Tavily/Exa/Brave/SearXNG/Firecrawl/Jina/Browserless/Crawl4AI 等 30 余个）。子 agent 提示里明确"改文件优先 `str_replace`，长文分段 `append`"，与 Claude Code 的 Edit 一致。

**沙箱**
- `Sandbox` 接口：`execute_command / read_file / write_file / list_dir / glob / grep`；`SandboxProvider`：`acquire/acquire_async/get/release`。实现：`local/`（直接宿主机）、`aio_sandbox/`（All-in-One Docker：浏览器+Shell+文件+MCP+VSCode Server）、`e2b_sandbox/`、`boxlite/`、`opensandbox/`、K8s provisioner。
- **虚拟路径契约**：`/mnt/user-data/{workspace,uploads,outputs}` 映射到每线程物理目录；`present_files` 必须呈现本次 run 产出的文件，网关强制 `run.delivery` 回执（README L1042）。
- 网络审批策略：子 agent、定时/webhook/无人值守 run **一律自动拒绝**需审批的网络访问（`sandbox/AGENTS.md`）。这条是"事件驱动 agent 如何处理权限"的好答案：无人值守时不弹卡片，直接拒绝。

**文件/文档处理**：无内置 docx/xlsx 专用库，走 **Skills + 沙箱脚本**。`skills/public/` 有 23 个技能：`ppt-generation`（逐页生成图片再合成 PPTX，8 种风格）、`chart-visualization`、`data-analysis`、`deep-research`、`podcast/video/music/image-generation`、`newsletter-generation`、`academic-paper-review`、`systematic-literature-review`、`consulting-analysis`、`code-documentation`、`github-deep-research`、`vercel-deploy`、`skill-creator`、`skill-reviewer`、`find-skills`、`bootstrap`、`surprise-me` 等。上传文档可自动转 Markdown 大纲（`uploads.auto_convert_documents`），带原文件 mtime 校验。注意其 PPT 是"图片拼成 PPTX"，**不可编辑**，办公场景要超越它。

**记忆**：`agents/memory/`，后端可插拔：`deermem`（默认，结构化 facts + JSON）、`mem0`、`honcho`、`openviking`、`noop`（模板）。写入有"作用域/持久性/授权"分类门（fail-closed）：只有稳定的用户级描述性事实才进长期记忆，当前对话约束与一次性授权留在对话状态。另有 LongMemEval 驱动的淘汰策略基准。

**前端**（`frontend/src/components/workspace/`）：`artifacts/`（文件列表、预览、**表格预览** `artifact-table-preview.tsx`、可编辑保存且带 revision 防覆盖）、`browser-view/`（WebSocket 流式浏览器画面，可回传键盘，作为"接管"入口）、`messages/subtask-card.tsx`、`thread-subagent-batches.tsx`、`todo-list.tsx`、`scheduled-tasks/`、`skill-usage/`（回答里显示用过的技能，点开看当时的 SKILL.md 快照）、`token-usage-indicator.tsx`、`mentions/`、`command-palette.tsx`。

**可借鉴 / 不宜照搬**
- 借：harness/app 分层、`task` 工具语义、子 agent 禁嵌套、边界式 steer、GitHub 触发的 opt-in 绑定、无人值守自动拒绝审批、虚拟路径契约、技能使用回溯、产物交付回执、记忆写入门。
- 不宜：Python+LangGraph+Docker+Postgres/SQLite 双栈对"轻量桌面"过重；`AGENTS.md` 显示大量边角补丁（单文件 2000+ 行的 executor/acceptance），复杂度高，二开成本不低。

### 2.2 Eigent

**架构（已读）**：`electron/main`（窗口、终端、本地文件安全、更新、`brainStreamRelay`）+ `src/`（React 页面：`Workspace`、`SessionWindow`、`Trigger`、`WorkFlow`、`BrowserAgentWorkspace`、`TerminalAgentWorkspace`、`RemoteControl`）+ `backend/`（FastAPI，Python）+ `server/`（云端：账号、触发器、alembic、celery）。产品层级 `Space → Session(=Project) → Task`（`docs/product-terminology.md`）。

**规划与多 agent**
- `backend/app/utils/workforce.py` 的 `Workforce(BaseWorkforce)` 继承 CAMEL：`_decompose_task`（流式分解）、`_find_assignee`、`_post_task`、`handle_decompose_append_task`、`pause/resume/stop_gracefully/skip_gracefully`。
- 8 类 agent（`agent/factory/`）：browser（研究员）、developer、document（文档专员）、multi_modal、mcp、question_confirm、social_media、task_summary。另有 `single_agent.py` 模式，说明"单 agent / Workforce"可切换。
- **用户 ↔ 后端的动作协议**（`service/task.py:49 Action` 枚举）值得直接参考：用户→后端：`improve`（追加需求）、`supplement`、`pause`/`resume`（用户接管）、`add_task`/`remove_task`/`skip_task`/`update_task`、`stop`；后端→用户：`decompose_progress/text`、`create_agent`、`activate_agent`、`assign_task`、`activate_toolkit`、`write_file`、`ask`、`notice`、`terminal`、`todo_state`、`budget_not_enough`、`timeout`、`end`。全部经 SSE（`sse_json`）下发。**即：任务图可在运行中被用户编辑（增/删/跳过任务）**，比 DeerFlow 更接近"插话"诉求的交互层。

**工具体系**：`agent/toolkit/` 41 个 toolkit：`terminal`、`file_write`、`excel`、`pptx`、`markitdown`、`hybrid_browser`、`pyautogui`、`screenshot`、`note_taking`、`search`、`github`、`slack`、`lark`、`notion`、`google_calendar/drive/gmail`、`linkedin/twitter/reddit/whatsapp`、`video_download/analysis`、`audio_analysis`、`openai_image`、`web_deploy`、`workspace_git`、`skill`、`memory`、`rag`、`human`、`thinking`、`observable_todo` 等。document agent 的核心装配：`FileToolkit + PPTXToolkit + ExcelToolkit + MarkItDownToolkit + NoteTakingToolkit + ScreenshotToolkit + TerminalToolkit + SkillToolkit + GoogleDriveMCP`（`agent/factory/document.py`）。**办公文档能力 = CAMEL 提供的 Excel/PPTX toolkit + MarkItDown 转换**，是"库封装成工具"路线，对比 Anthropic 的"技能+脚本"路线。

**Brain/Hands（对应诉求 3/6）**
- `hands/interface.py`：`IHands`（`mode: full|sandbox`，`can_execute_terminal / can_access_filesystem / can_use_mcp / can_use_browser`，`acquire_resource/release_resource`，`get_capability_manifest`）。`hands/capabilities.py` 注释：**能力由部署环境决定**（本机/云 VM = 全权限；Docker = 受限）。
- `hands/cluster_*.py`：`IHandsCluster.acquire/release/health`，`RoutedHandsCluster` 按资源类型（browser/terminal/model/default）路由到不同远端 worker 集群，TOML 配置（`cluster_config.py`）。这是"多台电脑/远程浏览器"的现成抽象雏形（仍偏云 worker 池，而非"我自己的另一台电脑"）。
- 与 Anthropic Managed Agents（brain / hands / session 三分，`execute(name,input)→string`，harness 与容器皆"牲口"）同构（[来源](https://www.anthropic.com/research/managed-agents)，2026-04-08）。

**外部子 agent（对应诉求 3）**：`remote_sub_agent/types.py` 定义 `RemoteSubAgentProvider` Protocol：`run(request, session) -> AsyncIterator[RemoteSubAgentEvent]`，事件类型 `session_updated / output_delta / thought_delta / tool_event / completed / failed / raw_event`；`RemoteSubAgentSession` 保存 `remote_interaction_id/environment_id` 以复用会话；`policy.py` 带**文件访问 denylist**（`.env`、`.ssh/**`、`*_rsa`、`*token*`、`*secret*`、`*credential*`）、最长墙钟时间（默认 600s）、是否允许下载快照（默认否）。现有 provider 只有 Gemini Agents 与火山 ModelArk Agents（云端 agent），**没有 Claude Code / Codex 适配**——但协议形状（流式事件 + 会话复用 + 策略闸）正适合我们给 Claude Code/Codex 写适配器。

**权限与可审计**
- `permission_policy/`（动作描述符、参数脱敏：`sk-`/`ghp_`/Bearer 等正则、argv 里的 `--api-key`）、`run_policy.py` 的 `ToolSafetyClass`（`safe_read / internal_control / idempotent_write / unsafe_write`）与 `TimeoutScope`（传输空闲、运行时存活、活动、工具、运行截止、**审批过期**、**远程命令 TTL**、云同步）——超时被分级建模，值得借鉴。
- `run_journal/`：持久化运行日志，`semantic_events.py` 把旧 SSE 动作投影为带版本的语义事件（`agent / agent_turn / browser_operation / command_execution / file_change / plan / subtask / tool_call ...`），**事件日志驱动前端投影**（`src/lib/projector`）。

**远程控制与触发器**：`controller/remote_command_controller.py`：持久化"远程控制收件箱"，字段含 `id / session_id / run_id / target_task_id / type / payload / expires_at / lease_token / requires_online_receipt_confirmation`，有幂等冲突（409）与高危命令集合（`stop / stop_task / remove_task / space_apply_project_run ...`）。`server/app/model/trigger/trigger.py`：`TriggerType`（schedule / webhook / slack_trigger），带 `max_executions_per_hour` 等限流。这是"手机下发命令 → 桌面执行"的可审计实现，对应 Cowork 的 Dispatch。

**记忆**：`memory/`（JSONL 事件：`ConversationEvent` 等，append-only，schema 版本化）+ `lightweight_memory/`（maintainer 整理）。偏"项目会话日志"，不是语义记忆。

**可借鉴 / 不宜**：借——Action 协议、任务图可编辑、IHands/集群路由、RemoteSubAgent Provider 协议、权限引擎与超时分级、事件投影。不宜——强绑定 CAMEL 的 Workforce（一次性分解+固定 worker，缺少"有状态可 fork 子 agent"）；后端 Python 重；仓库近期有大量治理类代码（run_runtime、workspace_runtime、workspace_git 等数十文件），阅读成本高。

### 2.3 UI-TARS-desktop（computer-use 参考）

**结构（已读）**：`packages/ui-tars/{sdk,operators,action-parser,shared,electron-ipc,utio,visualizer}`（旧版桌面 GUI agent）；`multimodal/{tarko,agent-tars,gui-agent,omni-tars}`（新一代 TS 框架）；`apps/ui-tars`（Electron 应用）。
- **Operator 抽象**（`packages/ui-tars/sdk/src/types.ts`）：`abstract class Operator { screenshot(): Promise<{base64, scaleFactor}>; execute(params): Promise<...> }` + `Model.invoke(params)`；实现有 `nut-js`（本机桌面）、`browser-operator`、`browserbase`、`adb`。多模态新框架另有 `operator-aio`（接 AIO 沙箱）、`operator-nutjs`、`operator-adb`、`operator-browser`。
- **循环**（`sdk/src/GUIAgent.ts`）：`while(true)` { screenshot → VLM invoke → action-parser 解析 → operator.execute → sleep(loopInterval) }，带 `maxLoopCount`、截图/调用/执行三类独立重试；状态机 `init/running/pause/end/call_user/user_stopped/error`——`call_user` 即"求人接管"。动作空间含 click/drag/hotkey/type/scroll/wait/finished/call_user。
- **Tarko 事件流**（`multimodal/tarko/agent-interface/src/agent-event-stream.ts`）：`user_message / assistant_message / assistant_streaming_* / tool_call / tool_result / system / agent_run_start / agent_run_end / screenshot / environment_input / plan_start / plan_update / plan_finish / final_answer(_streaming)`——**一切皆事件**的 TS 实现，另有 `agent-snapshot`（基于事件的 agent 回放测试）、`context-engineer`。若我们走 TS/Electron 路线，这是最接近的开源参照。
- 评价：官方对比页称 UI-TARS-1.5-7B 在 OSWorld 27.5%，"最完善的开源桌面 agent 应用"，但精度远低于 Agent S3 + 前沿模型（[对比页](https://platform.simular.ai/compare/open-source-computer-use-agents)，来自 Simular，有竞品立场，需谨慎）。

### 2.4 OpenManus（对照）

`app/agent/manus.py`：`Manus(ToolCallAgent)`，`max_steps=20`，工具 `PythonExecute / StrReplaceEditor / AskHuman / Terminate` + MCP（现已通过 `uvx browser-use --cli-mcp` 接浏览器）；`app/tool/planning.py` 的 `PlanningTool`（`create/update/list/get/set_active/mark_step/delete`，步骤状态 `not_started/in_progress/completed/blocked`）+ `app/flow/planning.py` 的 `PlanningFlow`（按步选 executor agent）。沙箱 `app/sandbox/core/`（Docker）与 Daytona 集成。价值：**"计划即工具"**——计划是模型可读写的数据结构，不是硬编码流程；UI 直接渲染步骤状态。MIT，可读性高，但工程能力远弱于 DeerFlow/Eigent。

---

## 3. 办公产品与技能方案

### 3.1 Anthropic Skills 仓库（已读）

- 目录：`skills/{docx,pptx,xlsx,pdf,doc-coauthoring,internal-comms,brand-guidelines,theme-factory,canvas-design,frontend-design,web-artifacts-builder,webapp-testing,mcp-builder,skill-creator,slack-gif-creator,claude-api,...}`。
- **许可**：README："Many skills are open source (Apache 2.0)... docx/pdf/pptx/xlsx are source-available, not open source"；这四个目录的 `LICENSE.txt` 禁止提取、复制、派生、分发。**结论：只读学习，不可复制代码/提示词/脚本。**
- **写法价值（可学，不可抄）**：
  - `description` 同时写清"何时触发/何时不要触发"（如 xlsx："Do NOT trigger when the primary deliverable is a Word document..."）。
  - 按任务给"路径表"：创建用 docx-js / openpyxl，编辑用 unzip→改 XML→zip，读取用 pandoc / markitdown。
  - 把踩坑清单写进技能（docx：默认 A4、表格需双重宽度、`ShadingType.CLEAR`、禁止字面 `•`；xlsx："必须公式不能硬编码、`recalc.py` 零错误才交付"）。
  - **强制自检回路**：产出后 `soffice --convert-to pdf` → `pdftoppm` 转图 → 让模型看图；`scripts/office/validate.py` 做 XSD 校验（含 ECMA/ISO 29500 schema 与 redlining/批注验证器）；`thumbnail.py` 生成幻灯片缩略图网格；`soffice.py` 包装器解决沙箱里 LibreOffice 挂起。
- 开放标准：agentskills.io 规范（frontmatter：`name` 小写连字符、`description` ≤1024 字符；`scripts/ references/ assets/`；三阶段披露：发现≈100 token/技能 → 激活读 SKILL.md → 执行按需读文件；建议 SKILL.md <500 行）。Claude Code / Codex / Copilot / VS Code / Cursor / Gemini CLI 均已支持（[agentskills.io](https://agentskills.io/home)、[designforai.dev 2026-10-12](https://designforai.dev/agent-skills)）。

### 3.2 Kortix 沙箱镜像的"办公能力底座"（网络来源）

其文档列出沙箱预装：`libreoffice pandoc poppler-utils qpdf tesseract-ocr latexmk ffmpeg` + Python `python-docx python-pptx openpyxl reportlab pdfplumber pymupdf pypdf pdf2docx markitdown[pptx] pandas matplotlib plotly playwright` + 中日韩字体 `fonts-noto-cjk`（[sandbox-image 文档](https://github.com/kortix-ai/suna/blob/main/apps/web/content/docs/reference/sandbox-image.mdx)）。**这份清单可直接作为我们"办公运行时"的依赖基线**（CJK 字体对中文用户尤其关键）。

### 3.3 Claude Cowork 的做法（网络来源 + 逆向分析）

- 形态：Claude Desktop（Electron）内启动 Apple Virtualization.framework 的 Ubuntu 22.04 ARM64 VM，内置 Claude Code CLI；宿主 ↔ VM 经 vsock/stdio 传 NDJSON；用户选的文件夹经 VirtioFS 绑定挂载到 `/sessions/<id>/mnt/<folder>`；每会话独立 Linux 用户 + bubblewrap + seccomp；出网经宿主代理（HTTP 3128/SOCKS 1080）+ 域名白名单（约 22 个，含 npm/PyPI/Anthropic API）；访客侧守护进程 `coworkd`（Go）。来源：[pvieito 2026](https://pvieito.com/2026/01/inside-claude-cowork)、[jimmyvo 2026-03](https://blog.jimmyvo.com/posts/claude-coworks-virtualization/)、[Dead Neurons 2026-01](https://deadneurons.substack.com/p/how-anthropics-cowork-actually-works)。以上为第三方逆向，Anthropic 官方未完整公开，细节可能随版本变化。
- **安全教训**：Accomplish 2026-07-23 披露 "SharedRoot"：宿主整个 `/` 以读写方式共享到 VM 的 `/mnt/.virtiofs-root`，guest-root 可越界到宿主（[来源](https://accomplish.ai/blog/sharedroot-escaping-claude-cowork-sandbox/)）。启示：**挂载面最小化、guest 内最小权限、不要把宿主根整体共享**。
- 产品能力（官方）：Plugins（技能+连接器+斜杠命令+子 agent 的文件化捆绑，2026-01-30；私有市场 2026-02-24）、Scheduled tasks（以 SKILL.md 存储，2026-02-25）、Dispatch（手机下发任务，主 agent 把子任务分给 Cowork 或 Code 会话，**子任务不再派生子任务**；权限请求 10 分钟无响应自动拒绝）、Computer use（2026-03-23）、Excel/PowerPoint 插件互通（2026-02-24）、Windows 支持、2026-04-09 GA（[官方 Dispatch 文档](https://claude.com/docs/cowork/guide/dispatch)、[插件](https://claude.com/resources/articles/cowork-plugins)、[Release notes](https://support.claude.com/en/articles/12138966-release-notes)）。
- Dispatch 的结构与用户想要的"主 agent 只分发、子任务有独立状态与记录、权限请求转发给人"高度吻合，且已被商业验证。

### 3.4 其他对标观察

- **Manus**：云 VM；Wide Research（并行上百子 agent、各自 VM 和上下文）；Browser Operator（Chrome 扩展用本机登录态）；Plan Mode（先出方案经确认再做）；原生可编辑 .pptx（2026-07 起）；Mail/Telegram/Slack 入口；20 个定时任务（[Carly 评测 2026-09-28](https://www.usecarly.com/blog/manus-ai-review/)、[Sacra](https://sacra.com/c/manus/)）。**供应商风险**：所有权反复，2026-08 曾强制删数据——用户数据本地优先是差异化点。
- **Skyvern**：Planner/Actor/Validator；WebVoyager 85.85%；"验证器"是把成功率从 ~68.7% 拉到 85.85% 的关键（官方自述）。
- **Agent S3**：简化架构（去掉 S2 的 manager-worker 层）、原生编码 agent、Behavior Best-of-N；S4（2026-10-20）用元 agent 在合成任务上自动演化工具接口（Qwen3.8-27B 在 OSWorld 2.0 从 5.6% 到 21.3%，300 步，$1.10/任务；均为 Simular 自报）。OSWorld 2.0（2026-06）为 108 个长程任务，前沿模型也仅约 20%，说明**通用 computer-use 在长程任务上仍很不可靠，产品上必须保留人工接管与强确认**。
- **AutoGLM**：虚拟手机在云端、操作可回放审计、敏感操作确认、验证码人工接管——与 Eigent/UI-TARS 的 `call_user` 思路一致。

---

## 4. 办公场景能力清单（建议内置技能）

按优先级。"来源"列标明可复用/需自写。

**P0（首发必备）**
| 技能 | 内容要点 | 实现建议 / 来源 |
|---|---|---|
| 文档读取与转换 | PDF/DOCX/PPTX/XLSX/图片(OCR)→Markdown，保留表格与页码 | `markitdown`(MIT)、`pandoc`、`pdfplumber/pymupdf`、`tesseract`；参考 Eigent `markitdown_toolkit` |
| Word 生成与编辑 | 报告/备忘录/信函，目录、页眉页脚、批注与修订 | 自写技能；`python-docx` 或 `docx` npm；**不得复制 Anthropic docx 技能** |
| Excel 分析与建模 | 公式不硬编码、重算零错误、图表、清洗脏数据 | `openpyxl + pandas` + LibreOffice 无头重算（自写 recalc 脚本） |
| PPT 生成与编辑（可编辑原生 pptx） | 母版/版式、图表、讲稿备注 | `python-pptx` / `pptxgenjs`；DeerFlow 的 PPT 技能是图片拼接，不可编辑，作为"创意风格"备选 |
| PDF 处理 | 合并/拆分/表单填写/水印/OCR | `pypdf`、`qpdf`、`reportlab` |
| 深度研究 + 引用 | 多源检索、带 `[citation]` 的报告 | 借鉴 DeerFlow `deep-research`（MIT）；强制来源 URL 与时间 |
| 文件整理 | 批量重命名/归档/去重，**先给计划再执行、可撤销** | 内置工具 + 变更预览（见 §6） |
| 数据分析与可视化 | CSV/Excel→图表→洞察 | DeerFlow `data-analysis`/`chart-visualization` 思路 |

**P1**
- 邮件/日历/网盘：Gmail/Calendar/Drive/Outlook/Notion/Slack/飞书/钉钉（走 MCP 连接器；Eigent 已有 toolkit 清单可对照）。
- 浏览器代办：登录态浏览器（扩展/CDP）、表单填写、下载账单、批量抓取（Manus Browser Operator 同类）。
- 会议/音视频：转写、纪要、行动项（音频/视频分析 toolkit）。
- 周期性任务：每日晨报、每周指标（定时 + 事件）。
- 内部沟通/品牌：公文模板、品牌风格主题（对应 Anthropic `internal-comms/brand-guidelines/theme-factory` 的类别，自写）。
- 网页/小应用产出：静态站点、仪表盘并一键部署。

**P2**
- 桌面 computer-use（Windows/macOS，默认关闭）；手机 ADB/HDC 代办；财务/法务/销售/客服等**行业插件包**（学 Cowork Plugins 的文件化捆绑）。
- 技能自生成与自审：`skill-creator` + `skill-reviewer` + 安全扫描（DeerFlow 已有 SkillScan 对技能文本做密钥/管道命令扫描）。

---

## 5. 可复用模块/库一览（含许可风险）

| 模块 | 用途 | 许可 | 备注 |
|---|---|---|---|
| DeerFlow `harness`（`deerflow-harness`） | 整套 agent 运行时 | MIT | Python/LangGraph；可作后端服务整体复用，或只抽设计 |
| DeerFlow `skills/public/*` | 研究/数据/PPT 等技能 | MIT | 可改造；PPT 技能不可编辑需重写 |
| Eigent 的 `hands/`、`remote_sub_agent/`、`permission_policy/`、`run_journal/` | 脑手分离、外部子 agent、权限、日志 | Apache-2.0 | 需保留版权声明；耦合其内部类型，更适合"照协议重写" |
| Tarko（`@tarko/agent`、`agent-interface` 事件流、`agent-snapshot`） | TS agent 框架/事件流/回放测试 | Apache-2.0 | 若走 TS/Electron 栈首选参照 |
| UI-TARS `Operator`/`action-parser`/`nut-js` operator | computer-use 抽象 | Apache-2.0 | 模型可换 |
| Agent S `gui-agents` | computer-use 研究基线、bBoN | Apache-2.0 | 研究代码，非产品级 |
| `browser-use`（已克隆在 `repos/browser-use`） | 浏览器 agent | MIT（本次未复核） | OpenManus 已用其 CLI-MCP |
| MarkItDown、Pandoc、LibreOffice、openpyxl、python-pptx、python-docx、pypdf、pdfplumber、qpdf、Tesseract | 文档处理 | 多为 MIT/BSD/MPL/Apache，LibreOffice MPL-2.0、**Pandoc GPL（作为外部进程调用可用，勿静态链接）** | 以子进程方式调用，规避 GPL 传染 |
| E2B / Daytona / Platinum / BoxLite / OpenSandbox | 云沙箱 provider | 各异（未逐一核实） | DeerFlow 与 Kortix 都用 provider 接口抽象 |
| Skyvern | 浏览器自动化 | **AGPL-3.0** | 仅借鉴思想；嵌入需开源或买商业许可 |
| Anthropic docx/xlsx/pptx/pdf 技能 | - | **专有/source-available** | **禁止复用** |
| Open-AutoGLM | 手机 agent | 代码 Apache-2.0 / 模型 MIT | 中文手机 App 场景 |

---

## 6. 设计借鉴点（映射到"SuperAgent"哲学与本项目诉求）

1. **主 agent 薄、子 agent 厚**：学 DeerFlow 的"子 agent 是执行优化而非默认"+ Dispatch 的"子任务不再派生子任务"（深度 1，避免失控）。每个子 agent 有：独立上下文、独立工具集、`max_turns`/`timeout`、结构化回报契约（DeerFlow `report_contract.py` / `acceptance_checks.py`）。
2. **插话 = 边界注入 + 不可信标记**：照 `ChildInputGate`；再叠加 Eigent 的"任务图可编辑"（add/skip/remove）与 `pause/resume` 接管。
3. **一切皆事件**：现有开源方案都"半事件化"——DeerFlow 触发器各自入队，Eigent 在 SSE 动作之上事后投影为语义事件。我们应**从第一天就以 append-only 事件日志为真相源**（Anthropic Managed Agents 的 session 概念；Tarko 的 `AgentEventStream` 词汇），用户输入/cron/GitHub/子 agent 回调/远程命令都是同一信封：`{id, type, source, run_id/target, payload, expires_at, idempotency_key, lease}`（Eigent 收件箱字段可参考）。
4. **脑手分离**：脑（loop）无状态可重启；手（沙箱/浏览器/远端电脑/外部 agent）统一成 `execute(name,input)→string` 或 Provider 流式协议；凭据不进沙箱（Anthropic 安全论述）。Eigent 的 `IHands` 能力清单 + 集群路由可作为"多台电脑"的节点注册模型。
5. **外部编码 agent 当子智能体**：沿用 `RemoteSubAgentProvider` 的流式事件形状（output/thought/tool_event/completed/failed）+ 会话复用 + 路径 denylist + 墙钟上限，为 Claude Code / Codex 各写 Provider（本地进程 + ACP/stdio 方式，细节见本项目其他调研文档；本文未深入）。
6. **权限分级**：`ToolSafetyClass`（读/内部控制/幂等写/不安全写）+ 超时分级 + "无人值守自动拒绝"+ "审批 10 分钟过期自动拒"（Dispatch）。
7. **产物是一等公民**：`present_files` + 交付回执（DeerFlow）；产物面板含表格预览、可编辑保存且带 revision；Eigent 的 `workspace_git` 把每次 run 变化落成可回滚提交（`WorkspaceCommitTimeline`）；Kortix 的"变更请求"把 agent 修改合入主干前由人审批。**办公场景里"改了我的文件"必须可预览、可撤销**。
8. **技能即扩展单元**：采用 agentskills.io 格式；Cowork 把计划任务也存为 SKILL.md、Plugin 把技能+连接器+命令+子 agent 文件化捆绑——一套文件格式覆盖"能力、定时任务、角色"。DeerFlow 还给出"使用过的技能回溯快照"和技能安全扫描。
9. **验证回路**：Skyvern 的 Validator、Anthropic 技能的"渲染成图再看"、DeerFlow 的 acceptance_checks——办公产出（文档/表格/PPT）默认带"渲染→检查→修正"一轮。
10. **人工接管入口**：UI-TARS `call_user`、AutoGLM 验证码接管、DeerFlow `browser-view` 流式画面回传键盘、Eigent `pause/resume`。统一为一个"需要人"事件类型。

---

## 7. 对本项目的具体建议

1. **架构路线（建议）**：自研薄内核（事件日志 + 调度 + Provider/Hand 接口），**不整体 fork DeerFlow/Eigent**；以它们为"设计参照 + 局部抽取"。理由：二者都是 Python 重栈且已积累大量治理代码；用户要的是轻量多端、可 fork 的有状态子 agent，二者均不原生支持。若时间紧、追求最快出效果，备选方案是**以 DeerFlow harness 作为"办公/研究子 agent 后端"服务**，由我们的内核通过 Provider 调用。
2. **技术栈倾向**：桌面壳 Tauri/Rust 或 Electron；内核用 Rust 或 TypeScript。若选 TS，可直接参照 Tarko 的事件流与 Electron 桥接；若选 Rust，沙箱/进程/远程连接更轻，但办公文档库生态（python-docx/openpyxl 等）需通过**沙箱内 Python 运行时**调用——两种栈都应把办公文档处理放在沙箱子进程内，不进内核。
3. **办公运行时镜像**：参照 Kortix 的预装清单自建"office-runtime"（LibreOffice + Python 文档库 + CJK 字体 + Tesseract + Playwright），桌面端本地以容器/WSL/轻量 VM 提供；无 Docker 的用户回退到"受限本地模式"（路径白名单 + 命令审批）。
4. **首批技能**：实现 §4 的 P0 八项，全部自写（或改造 MIT 的 DeerFlow 技能），**禁用 Anthropic 四件套的任何文本/脚本**；同时原生读取 `~/.agents/skills`、`.claude/skills`，让用户已有技能直接可用。
5. **文件安全默认值**：只挂载用户授权目录；写操作先生成"变更计划/差异"，用户确认后落盘；`workspace_git` 式自动快照可回滚；denylist 默认含 `.env/.ssh/*token*/*secret*`；出网域名白名单（学 Cowork）。
6. **computer-use 放在后期**：先做浏览器（CDP + 登录态扩展）与文件/终端；桌面 GUI 操控作为可选 Hand，沿用 `screenshot/execute` Operator 接口，默认关闭，并强制敏感操作确认与 `call_user` 接管。
7. **评测**：用 GAIA 子集、WebVoyager 子集、自建"办公任务集"（Word/Excel/PPT 产物 + 自动校验脚本）做回归；Agent S 的经验是单次成功率不稳，可对关键任务提供 best-of-N 选项。
8. **UI 交互**：任务进度（计划/待办/子 agent 卡片，学 DeerFlow `subtask-card` + Eigent `WorkFlow` 节点图）、产物预览（Markdown/表格/代码/PDF/Office 渲染图）、Token/成本显示、已用技能回溯、浏览器实时画面可接管、定时任务页。

---

## 8. 待用户拍板的问题

1. **自研内核 vs. 二开 DeerFlow**：是否接受 Python 后端作为办公/研究"子 agent 服务"，由 Rust/TS 内核调度？还是坚持单一语言栈？
2. **办公文档的"保真度"目标**：只要"能生成可用的 docx/xlsx/pptx"，还是要对标 Cowork 的"编辑既有文件并保留修订/批注/母版"？后者工作量大一个量级。
3. **本地隔离强度**：桌面端默认是 VM（体验重，仿 Cowork）、容器（需 Docker/WSL）、还是仅路径白名单 + 审批（最轻但最弱）？Windows 用户占比如何？
4. **是否内置 computer-use（桌面 GUI 操控）**，以及目标平台（仅 Win/Mac，还是含手机 ADB）？
5. **云端能力边界**：是否提供托管云沙箱/手机下发（Dispatch 类）？还是纯本地 + 用户自备机器互联？
6. **技能生态策略**：是否开放技能市场/插件市场（涉及供应链安全与审核）？是否承诺兼容 agentskills.io 与 Cowork 的 Plugin 格式？
7. **许可策略**：我们产品本身的开源许可？这决定能否使用 AGPL 组件（Skyvern 等）以及 GPL 工具（Pandoc）的调用方式。
8. **Kortix/Suna 的许可与现状**本次未核实，若要借鉴其沙箱 provider 抽象，是否需要我补做克隆与许可核查？

---

## 9. 来源清单

- DeerFlow：[GitHub](https://github.com/bytedance/deer-flow/)、[v2.0.0 release](https://github.com/bytedance/deer-flow/releases/tag/v2.0.0)（2026-06-25）、[VentureBeat 2026-03-24](https://venturebeat.com/orchestration/what-is-deerflow-and-what-should-enterprises-know-about-this-new-local-ai)、[README_zh](https://github.com/bytedance/deer-flow/blob/main/README_zh.md)；本机源码 `D:\code\xuqiu\repos\deer-flow`（`backend/AGENTS.md`、`backend/packages/harness/deerflow/{agents,subagents,sandbox,runtime/runs/input_control.py,scheduler}`、`backend/app/gateway/github/triggers.py`、`frontend/src/components/workspace/`）。
- Eigent：本机源码 `D:\code\xuqiu\repos\eigent`（`backend/app/{utils/workforce.py,service/task.py,hands/,remote_sub_agent/,permission_policy/,run_journal/,run_policy.py,controller/remote_command_controller.py,agent/factory/,agent/toolkit/}`、`server/app/model/trigger/trigger.py`、`docs/product-terminology.md`）。
- UI-TARS-desktop：本机源码 `D:\code\xuqiu\repos\UI-TARS-desktop`（`packages/ui-tars/sdk/src/{GUIAgent.ts,types.ts}`、`packages/ui-tars/shared/src/types/agent.ts`、`multimodal/tarko/agent-interface/src/agent-event-stream.ts`）。
- OpenManus：本机源码 `D:\code\xuqiu\repos\OpenManus`（`app/agent/manus.py`、`app/tool/planning.py`、`app/flow/planning.py`）。
- Anthropic Skills：本机 `D:\code\xuqiu\repos\skills`（README、`skills/{docx,pptx,xlsx,pdf}/SKILL.md` 与 `LICENSE.txt`）；[agentskills.io](https://agentskills.io/home)；[Managed Agents（2026-04-08）](https://www.anthropic.com/research/managed-agents)。
- Claude Cowork：[官方 Dispatch 文档](https://claude.com/docs/cowork/guide/dispatch)、[Plugins](https://claude.com/resources/articles/cowork-plugins)、[企业插件 2026-02-24](https://claude.com/resources/articles/cowork-plugins-across-enterprise)、[Computer use & Dispatch 2026-03-23](https://claude.com/resources/articles/dispatch-and-computer-use)、[Release notes](https://support.claude.com/en/articles/12138966-release-notes)；逆向分析：[pvieito](https://pvieito.com/2026/01/inside-claude-cowork)、[jimmyvo](https://blog.jimmyvo.com/posts/claude-coworks-virtualization/)、[pluto.security 2026-04-01](https://pluto.security/blog/inside-claude-cowork-how-anthropics-autonomous-agent-actually-works/)、[SharedRoot 2026-07-23](https://accomplish.ai/blog/sharedroot-escaping-claude-cowork-sandbox/)。
- Kortix/Suna：[GitHub](https://github.com/kortix-ai/suna/)、[DeepWiki 平台与沙箱](https://deepwiki.com/kortix-ai/suna/12-platform-and-sandbox-infrastructure)、[沙箱镜像文档](https://github.com/kortix-ai/suna/blob/main/apps/web/content/docs/reference/sandbox-image.mdx)。
- OWL：[GitHub](https://github.com/camel-ai/OWL)、[论文](https://arxiv.org/html/2505.23885v2)。
- Agent S：[GitHub](https://github.com/simular-ai/Agent-S)、[Agent S3 文章](https://www.simular.ai/articles/agent-s3)、[开源 CUA 对比（Simular 自家，2026-10-22）](https://platform.simular.ai/compare/open-source-computer-use-agents)。
- Skyvern：[2.0 博客](https://www.skyvern.com/blog/skyvern-2-0-webvoyager-benchmark-results/)、[llms.txt](https://www.skyvern.com/llms.txt)。
- AutoGLM：[Open-AutoGLM](https://github.com/zai-org/Open-AutoGLM)、[博客](https://autoglm.z.ai/blog/)。
- Manus：[SCMP 2026-09-01](https://www.scmp.com/tech/big-tech/article/3365986/manus-resumes-solo-operations-after-collapse-us2-billion-meta-deal)、[Sacra](https://sacra.com/c/manus/)、[Carly 评测](https://www.usecarly.com/blog/manus-ai-review/)。
- Open Interpreter：[org 页](https://github.com/openinterpreter)、[01](https://github.com/openinterpreter/01/)。

> 局限声明：Cowork 内部实现部分来自第三方逆向，非官方；Simular 的对比页有竞品立场；Kortix 许可、`browser-use` 与各沙箱 SDK 许可本次未逐项核实；DeerFlow 子 agent 粒度的 fork 能力未在源码中确认。本文未覆盖"Muse"产品识别与外部编码 agent（Claude Code/Codex）的具体接入协议，那属于其他调研课题。
