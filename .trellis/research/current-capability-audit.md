# 现状能力审计：Pip / 分支 / 外部成员 / 记忆 / 设备 / 原生成员

> 日期：2026-11-06　范围：只读审计 `packages/daemon`（后端）、`packages/protocol`、`apps/web`（界面）、`docs/`。
> 结论都以当前代码为准，行号对应审计时的工作区。

## 一句话总结

现在的 Muster 是一个**单机、本地回环（127.0.0.1）的派单器**：Pip 只会“理解 → 派单 → 用模板播报结果”；
真正干活的是本机上的 `claude` / `codex` CLI 或 pi-durable 原生成员，它们都跑在 musterd 所在的那台电脑上，
而且默认在一个**空的临时目录**里干活。分支是“对话检查点分叉”，采用只是打个标记；记忆、远程设备都还没有实现。

---

## 1. 主 Bot Pip 今天到底能做什么

**本质：只做路由。** 文件头就写明 `Pip: thin main bot. Dispatch only; never runs tools itself.`（`packages/daemon/src/router/index.ts:1`）。

决策顺序（`router/index.ts:119-169`）：
1. 消息里**明确点名成员** → 规则快路径，不调模型（`planNamed`，`router/index.ts:126-127`）。
2. **设置里配置的 Pip 模型**（pi-ai 流式调用，`decideByModel`，`router/index.ts:133-151`，超时 60 秒 `:24`）。
3. 环境变量 `MUSTER_ROUTER_LLM=1` + `MUSTER_ROUTER_BASE_URL/API_KEY/MODEL`（OpenAI 兼容 `/chat/completions`，强制 `tool_choice=dispatch`，超时 15 秒；`router/llm.ts:270-279, 330-383`）。
4. 关键字规则（`planByKeywords`）→ 都不命中就回一句规则化的闲聊话术（`chitchatReply`，`router/index.ts:165-166`）。

**Pip 的工具只有两个：**
- `dispatch`（把任务拆给成员，每项 `botId/title/prompt`，`router/model.ts:19-40`）
- `reply`（只回复，`router/model.ts:42-50`）

环境变量路径更少，只有 `dispatch` 一个工具（`router/llm.ts:281-306`）。

**系统提示明确禁止它自己动手：**“你自己不执行任何工具，不写代码、不查资料、不改文件，也不要声称自己做了这些”（`router/model.ts:99`；env 路径 `router/llm.ts:314`）。

逐项回答：

| 能力 | 现状 | 依据 |
|---|---|---|
| 自己回答问题 | **能，但只凭模型自身知识**，通过 `reply` 或直接文字；没有配置模型时只有规则闲聊话术 | `router/model.ts:42-50, 105`；`router/index.ts:166` |
| 规划/拆分任务 | **一次性**拆成多条 `dispatch`，并行启动；没有多步计划、没有“先做 A 再根据结果做 B” | `router/index.ts:171-185`（`Promise.allSettled` 并行） |
| 追问/跟进 | 只能在本轮用 `reply` 反问用户；**不能给运行中的子任务插话/追加指令**（`dispatch` 只会新建任务，Pip 没有 steer 工具） | `router/model.ts:19-50`；`router/index.ts:174` |
| 汇总结果 | **没有 LLM 总结**。任务完成/失败/需审批时，`onTaskEvent` 用**固定模板**拼一条消息：“X 完成了「标题」+ 测试数/改动文件数 + 子 Bot 最后一句话（截断 120 字）” | `router/index.ts:206-227, 239-252` |
| 读文件 | **不能** | 无相关工具；提示词禁止 |
| 联网搜索 | **不能** | 同上 |
| 上下文 | 只把最近 10 条主线（用户/Bot/派单卡片）摘要塞进 system prompt；messages 里只有本条用户消息；没有跨会话记忆 | `router/model.ts:84-94, 140-143` |
| 派单后的“顺便跑测试 / 完成后通知我” | 只是追加一张 `choices` 选项卡片，daemon 侧没有对应的处理逻辑 | `router/index.ts:25, 196` |

> 补充：Pip 自己的模型优先取 `bot.model`，其次是设置里的“路由默认”（`router/index.ts:100-109`）；模型失败时提示一次并回退规则（`:144-153, 113-117`）。

## 2. “分支”功能到底做了什么

**是对话检查点分叉（conversation checkpoint fork），不是代码合并工具。**

- 入口：工作台某条消息上的“从这里分支” → `task.fork { taskId, entryId }`（`apps/web/src/pages/workbench/index.tsx:99`）。
- 后端 `forkTask`（`packages/daemon/src/orchestrator/orchestrator.ts:610-715`）：
  1. 要求引擎声明 `caps.fork`，并且只能分给**同引擎类型**的成员（`:613-618`）。
  2. 找到该消息所在**已结束的轮次**（turn），未结束则拒绝（`:620-632`）。
  3. 准备新工作目录：先尝试 `git worktree add -b muster/<id>`（基于原目录当前 HEAD）；失败且原目录是临时工作区就**整目录复制**；否则与原任务**共用目录**（`:634-656`；`orchestrator/workspace.ts:32-56`）。
  4. 调引擎原生 fork：Claude 用 `--resume <id> --fork-session --resume-session-at <uuid>`（`drivers/claude/session.ts:192-205`）；Codex 用 app-server 的 `thread/fork lastTurnId`（`drivers/codex/index.ts:111-114, 160`）；原生成员用 pi-durable 的 fork（`drivers/native/session.ts:119-123`）。
  5. 把原对话 `[0..该轮末尾]` 复制到新 thread，生成新任务（标题加“（分支 B）”），并写 `Branch` 记录；第一次分叉时给原任务补一条“原始路线”（`:664-708`）。
- `BranchTree` / 分支页 `/task/:taskId/branches`：画分支树 + 对比表（摘要、改动文件数、测试、tokens），按钮“采用此分支 / 继续这个分支”（`apps/web/src/pages/branches/index.tsx:1, 75-88, 140-148`；`apps/web/src/components/branches/BranchTree.tsx:134`、`BranchTable.tsx:87-88`）。

**“采用 / 采纳”做了什么：只改标记 + 记一条事件，不动任何代码。**
`branch.adopt` 把同一家族里目标分支 `adopted=true`、其余 `false`，再记录事件“你采纳了 X”（`orchestrator.ts:755-775`）。
没有 `git merge`、没有把 worktree 改动带回原目录、没有清理其它分支的 worktree。

**更关键的现实问题：** 生产路径里**没有任何调用方给 `startTask` 传 `cwd`**——Pip 派单（`router/index.ts:174`）和触发器（`triggers/index.ts:138, 182-184`）都不传。
所以每个任务都跑在空目录 `~/.muster/workspaces/<taskId>`（`orchestrator.ts:513-515`；数据目录默认 `~/.muster`，`main.ts:7`）。
因此 git worktree 分支逻辑（`orchestrator.ts:498-512`）在当前产品里实际走不到；分叉时 worktree 必然失败，退回“复制临时目录”。

## 3. Codex / Claude Code 成员：依赖、凭据、运行位置

**必须在 musterd 所在机器上安装并登录官方 CLI。**
- Claude：直接 spawn 本机 `claude`（默认从 PATH 找），注释写明“Spawning the user's already-logged-in `claude` directly … never touches credentials”（`drivers/claude/index.ts:3-6, 31`）。参数是 `-p --input-format stream-json --output-format stream-json --permission-prompt-tool stdio …`（`drivers/claude/session.ts:28-31`）。
- Codex：spawn 本机 `codex app-server`（JSON-RPC over stdio），`approvalPolicy=on-request`、`sandbox=workspace-write`（`drivers/codex/index.ts:342-350`；`drivers/codex/rpc.ts:68-71`）。
- “检测”只是跑 `--version`（`drivers/claude/index.ts:43-51`；`drivers/codex/index.ts:355-359`）——**只检查装没装，不检查登录**。

**Muster 不注入用户在设置里配置的模型或 API Key：**
- 环境变量：Claude 子进程用 `{ ...process.env, ...deps.env }`，而组装根里 `createClaudeDriver()` 不传 `env`（`drivers/claude/session.ts:73`；`app.ts:37`）；Codex spawn 不传 `env`，直接继承（`drivers/codex/rpc.ts:70-71`）。代码里没有设置 `ANTHROPIC_BASE_URL` / `ANTHROPIC_MODEL` / `ANTHROPIC_API_KEY`，也没有 codex 的 `-c model_provider=…` 或改 `config.toml`。
- 模型：驱动支持 `opts.model`（Claude `--model`，`session.ts:40-45`；Codex `thread/start` 的 `model`，`codex/index.ts:94-99`），但编排器启动时只传 `{ cwd, prompt, bot }`，**从不传 model**（`orchestrator.ts:519, 824`）。`bot.model` 只给原生成员和 Pip 用（`packages/protocol/src/index.ts:68-69`）。
- 文档也是这么说的：“外部编程 Agent（Claude Code、Codex）的模型由它们自己管，这里不配置”（`docs/11-接入真实模型.md:8`）；单人方案的对外口径是“使用你自己的 API Key / 本机已登录的官方 CLI”（`docs/07-单人开发方案.md:20`）。

→ 结论：它们用的是**本机 CLI 自己的登录态和配置**（`~/.claude`、`~/.codex/config.toml` 或进程继承的环境变量）。

**运行位置：只能是运行 musterd 的这台电脑。** 驱动直接 `child_process.spawn`；没有远程执行通道（见第 5 节）。今天**不能**让它们跑在另一台设备上。

## 4. 记忆

**完全没有实现。**
- 后端：daemon 与 protocol 里没有任何 memory 相关的方法、事件或存储（`app.ts:18-24` 的方法列表里没有 `memory.*`；对 `packages/daemon/src`、`packages/protocol/src` 的检索无记忆实现）。
- 界面：`/memory` 页是诚实空态，徽标“尚未开放”，文案“目前没有任何跨对话的记忆被保存。具体怎么记、由谁确认，等功能开放时再说明。”（`apps/web/src/pages/memory/index.tsx:10-15`）。这与 `docs/12-UI改版规范.md:53` 的要求一致。
- Pip 唯一的“记性”是 system prompt 里的最近 10 条主线摘要（`router/model.ts:84-94`）。

**文档里原本的规划：**
- `docs/00-总览.md:74`：记忆排在 M4（v1.0 公开 Beta）。`06-待拍板问题.md` 没有单独的记忆问题；`07` 没有涉及；`10-二期开发计划.md:79` 只把“记忆”列为要重做的页面之一。
- 详细设计在 `docs/design/`：
  - **文件为真相**：`~/.muster/mind/` 是一个 git 仓库（`SOUL.md`、`USER.md`、`MEMORY.md`、`bots/<bot>/MEMORY.md`、`projects/…`），FTS5/向量只是派生索引（`design/03-architecture.md:23, 659`）。
  - **生成/写入**：Agent 只能**提议**（`memory.proposed`），经规则 + 用户确认或“可信来源自动提交”变成 git commit（`memory.committed`），每条附来源事件；来自不可信（污点）会话的写入一律进**待审队列**（`03-architecture.md:664, 269, 921`）。
  - **整理（梦境）**：空闲/夜间唤醒整理子 Agent，去重、合并、过期、从日志提炼候选记忆，产出 git diff 让用户一键接受或回滚（`03-architecture.md:665`）。
  - **作用域**：user / bot / project / task 四级（`:666`）。PRD 要求：可查看、编辑、删除；注入可溯源；敏感类别需确认才写入；技能沉淀需确认（`design/01-PRD.md:300, 369-379`）。
  - **MVP 切线**只做“偏好小表（可查看/删除）”，`mind/` 库与 FTS5 放 M4（`design/05-review-roadmap.md:201`）。

## 5. 设备

**协议里的“设备”只是一条展示记录：** `Device { id, name, os, isLocal, online, lastSeenAt? }`（`packages/protocol/src/index.ts:272-279`）。

- daemon 启动时硬编码一台 `dev-local`“本机”，永远 `online: true`（`packages/daemon/src/core/hub.ts:25`）。没有任何代码新增其它设备。
- `device.list` 只是返回这张表（`handlers/misc.ts:73`）。
- **配对是假的：** `device.pairCode` 只生成一个随机 6 位数字和 10 分钟过期时间，**不存储、不校验，也没有任何“用配对码接入”的接口**（`handlers/misc.ts:75-78`）。设备页“配对新设备 / 生成配对码，把第二台电脑接进来”的文案对应不到实际能力（`apps/web/src/pages/devices/index.tsx:40-57`）。
- 服务器只监听 `127.0.0.1`（`server/server.ts:1, 89`），别的电脑连不进来。
- 设备唯一的“用途”是触发器的 `device` 上下线来源（`triggers/index.ts:344-356`），但设备从不变化，实际不会触发。
- `Bot`、`Task` 上都没有 `deviceId` 字段（`protocol/src/index.ts:49-74, 146-155`）——**没有任何 agent 能在另一台设备上执行**。

**文档里的规划：**
- 总览：Hub / Node / Operator 三角色，Ed25519 设备身份，两层审批，审批在 Node 本机强制（`docs/00-总览.md:44`）；M2 做“第二台电脑配对与远程执行”（`:72`）。
- Q9 推荐方案 A：WS + 配对码 + 用户自带 Tailscale/LAN/SSH；iroh + 自建 relay 放 v1.x；Node 离线**不排队**、立即返回 `node_offline`；手机不作 Node（`docs/06-待拍板问题.md:109-119`）。Q10：Node 本机 `exec` 默认 ask（`:126-130`）。
- 单人方案改为：v1 复用 DSH 的 `ssh/*`（远程 fs、子进程、沙箱），只支持 POSIX 远端；Windows 被控机要等自建 Node（可用 Rust），放到 M4（`docs/07-单人开发方案.md:17, 37, 93, 112, 125`）。

## 6. pi-durable 上的原生成员

**工具**（`packages/daemon/src/drivers/native/tools.ts:9-17`）：

| 工具组 | 工具 | 默认开启 |
|---|---|---|
| files | `read`、`ls`、`grep`（只读） | 是 |
| edit | `write`、`edit` | 是 |
| shell | `bash` | 是 |
| web | `web_fetch`（抓取单个 http/https URL，15 秒超时，最多 5 万字） | **否，需要手动开启** |

- `read/write/edit/bash` 来自 pi-durable 的 `createCodingTools()`（`drivers/native/extension.ts:20`）；`ls/grep/web_fetch` 是 Muster 自己加的（`tools.ts:38-238`）。
- **没有网页搜索工具**，只有“给定 URL 抓取正文”。
- 审批：`write/edit` 为中风险，`bash/powershell` 为高风险，执行前弹审批；没有审批回调时直接拒绝（`extension.ts:7, 33-48`）。
- 成员可按 `bot.tools` 选择工具组，人设走 instructions（`drivers/native/index.ts:138, 143-149`）。

**执行位置：** `NodeExecutionEnv({ cwd })`，就在 **musterd 进程所在机器**上直接执行（`drivers/native/index.ts:116`）；cwd 是任务目录，也就是上面说的空目录 `~/.muster/workspaces/<taskId>`（`orchestrator.ts:513-515`）。
`ls/grep` 接受绝对路径，`bash` 也能访问本机其它目录（受审批约束），但没有沙箱、没有远程设备。
模型来自设置（`bot.model` 或“原生默认”）；没配置时该轮以 `no_model` 提示失败（`drivers/native/index.ts:30, 83, 143`）。

---

## 愿景 vs 现状对照

| 主题 | 原始愿景（docs/00、06 及 design） | 现状 |
|---|---|---|
| Pip | “主 Bot 极薄：无 Bash、无写权限，规则快路径优先、LLM 慢路径兜底”（00:48）；MVP 主 Bot 是“规则路由 + 最小 LLM 工具循环（`dispatch/reply/ask_user/note`）”（05:190）；架构稿的工具白名单还有 `agent.message/interrupt/fork`、`memory.search`、`read_status`、`schedule.create`（03:296） | “极薄”做到了：只有 `dispatch` + `reply`，单次调用、没有循环。没有 `ask_user`/`note`/`agent.message`/`read_status`/`memory.search`；结果汇报只是模板，不是总结 |
| 分支 | 产品原语（00:55）；“外部 Agent 用原生 fork + worktree + **turn 级文件快照**”，评审特别纠正“从此处分支必须有 turn 级文件快照”（00:49, 64；06:246） | 原生会话 fork 做到了（Claude/Codex/原生三种）；worktree 代码在，但生产路径不传 cwd，实际走不到；**没有 turn 级文件快照**（分叉时复制的是当前目录，不是那一轮当时的文件）；“采用”只是标记，不合并 |
| 外部成员 | ACP 南向 + 原生逃生舱，Claude 走 `claude-agent-acp`，受管运行时下载（00:43；06:220）；合规口径“用你自己的 API Key / 本机已登录的 CLI”（07:20） | 直接 spawn 本机 `claude` / `codex app-server`，用 CLI 自己的登录与模型；没有 ACP、没有受管运行时、不注入模型和 Key |
| 记忆 | M4：`mind/` git 库、提议 → 确认 → 提交、待审队列、梦境整理（00:74；03:651-666） | 未实现，页面诚实空态 |
| 设备 | Hub/Node 配对、Ed25519、第二台电脑远程执行（M2）；单人方案用 DSH `ssh/*` | 只有硬编码“本机”；配对码不落地；只监听 127.0.0.1；不能远程执行 |
| 原生 Worker | M4：研究/办公 Worker、原生 Session 树形 fork（00:74；06:246） | 已提前做了：pi-durable 原生成员，含读写/命令/抓网页、审批、fork；但没有搜索、没有办公文档技能，跑在本机空目录 |
