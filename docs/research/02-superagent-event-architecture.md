# 02 DeepSeek Super-agent 架构与"万物皆事件 + 有状态子 Agent + 可分支插话"运行时调研

> 调研日期：2026-11-06。作者：调研 Agent。所有"已证实"结论均带来源；无法证实的明确标注"未证实"。
> 本地源码：`D:\code\xuqiu\repos\` 下的 `dsh-superagent-prototype`、`deepseek-harness`、`software-agent-sdk`（OpenHands V1 核心）、`letta`（仅剩说明，源码已迁移）、`letta-code`，另参考其他调研已克隆的 `codex`、`openclaw`。

---

## 0. 结论速览（TL;DR）

1. **出处已查实**：用户说的"DeepSeek 发布的 SuperAgent 架构"= DeepSeek Harness 团队于 **2026-10-31** 在官方公众号发布的技术长文《Super-agent 设计探索：迈向更自主的 Agent 系统》（英文 *Exploring Super-agent Design: Toward More Autonomous Agent Systems*，作者 Yujia Qiao 等），同日以 MIT 协议开源配套原型 **`deepseek-ai/dsh-superagent-prototype`**（v0.1.0）。它建立在 8 月 13 日开源的 **`deepseek-ai/deepseek-harness`**（简称 `dsh`，"Everything is a Plugin"，基于 Cordis 插件运行时）之上。
2. **需要澄清用户印象中的三点**（重要）：
   - 文章的核心是 **Router / Worker 双层架构 + Trigger 事件驱动 + Thread 订阅直通 + 存算分离 + Watchdog**。"主 agent 轻量只做分发""一切触发皆事件"确是它的主旨。
   - "**子 agent 有状态、可 fork、可插话**"并不是 Super-agent 文章本身的卖点，而是其**底座 DSH 的 Session 层能力**：事件溯源的 Session 日志、`SessionStore.fork(source, boundary)`、`Agent.steer()/followup()/cancel()`、`SubagentManager.interrupt()/sendMessage()`。文章只是顺带提到 Worker 可再起 Subagent/Agent Team，以及"异步 ReAct Loop"。因此"SuperAgent 架构"在用户脑中其实是 **文章（调度/事件）+ DSH 底座（有状态/分支/插话）** 的合成体。本报告按此拆解。
   - 开源原型**只实现了文章的一部分**（README 明说）：Watchdog、存算分离、云端常驻、BYOM daemon 在原型中无对应实现（第三方分析称，未证实为逐文件核对，见 §2.4）；且原型自身并不做 fork/steer，它是通过调用 DSH 的 `agent.steer()` 间接用到。
3. **最值得抄的设计**：(a) 事件（Trigger）不可变 + 幂等入库 + 事务内写 outbox/effect 队列、提交后才执行副作用；(b) Router 只做"评估→接单→派工"，事件在 Thread 上被 Worker **订阅直通**，Router 不再转发；(c) 授权（Mandate）与上下文（Subscription）分离，主动行为默认 `observe` 只记录；(d) 会话日志追加式、模型历史是日志的投影（"model-visible means logged"）；(e) fork = 取日志前缀并补合成 tool result 与 `turn/end{forked}`；(f) steer/queue/interrupt 三种插话语义明确区分。
4. **对本项目的建议**：用 **Rust 写事件内核（SQLite WAL 单写 + 追加式 session 日志 + effect outbox）**，Router/Worker/外部 Agent（Claude Code、Codex）统一抽象为"有状态 Session 端点"，通过 ACP / Codex app-server / Claude Agent SDK 三类适配器接入；分支与插话直接对齐 Codex app-server 的 `thread/fork`、`turn/steer`、`turn/interrupt` 语义。数据模型草案见 §6。

---

## 1. 出处核实与候选说明

### 1.1 一手来源（已证实）

| 项 | 内容 | 来源 |
| --- | --- | --- |
| 技术文章 | 《Super-agent 设计探索：迈向更自主的 Agent 系统》，DeepSeek Harness 团队，2026-10-31 20:29（文末时间） | 知乎转载 https://zhuanlan.zhihu.com/p/2099987320443237060 ；英译全文 https://offloop.org/learn/exploring-deepseek-super-agent-design ；财联社快讯 https://www.cls.cn/detail/2521643 |
| 原型仓库 | `deepseek-ai/dsh-superagent-prototype`，MIT，创建于 2026-10-31T09:32Z；README 自述"Research prototype for reference only, not an official DeepSeek product" | https://github.com/deepseek-ai/dsh-superagent-prototype （本地 `repos/dsh-superagent-prototype`） |
| 底座 | `deepseek-ai/deepseek-harness`（`dsh`），MIT，创建于 2026-08-13；GitHub 页面抓取时显示 273,951 star（其他媒体早先报 188k，数字随时间变化，未独立核验） | https://github.com/deepseek-ai/deepseek-harness ；文档 https://deepseek-harness.github.io/deepseek-harness/ |
| 底座源码解读（二手但详实，含 commit `687f282`） | Rememorio《DeepSeek Harness Source Notes》系列 | https://rememorio.github.io/blog/deepseek-harness/en/event-sourced-session/ 、https://rememorio.github.io/blog/deepseek-harness/en/multi-agent-runtime/ |

### 1.2 关于名称

- 官方写法是 **"Super-agent"**（连字符），不是一个独立产品，而是"一种 Agent 形态及其系统架构"的名称；原型包名 `dsh-superagent`。没有找到名为 "SuperAgent" 的 DeepSeek 技术报告/论文（arXiv 等）——**未发现，不存在 PDF 论文**，只有博客式技术文章 + 代码原型。
- 与同名项目区分：市面上另有多个叫 SuperAgent 的开源项目（如 superagent.sh），与 DeepSeek 无关，此处不展开（未逐一核实）。

### 1.3 官方自述的边界（引用需谨慎）

- 文章自称"从工程视角探索架构思路，不是 DeepSeek Harness 现有产品功能介绍"。
- 原型 README："我们为发布做了改编，与内部版本及文章所述实现不完全相同；文章里讨论的某些设计是未来方向，原型未实现。"
- 实验是**合成负载**（约 300 条消息、约 20 条工作请求，编码被替换成只耗时的假工具，每方案 5 次），"初步参考"。p50 12.4 min / p95 15.7 min 对比"单 Session + Subagent 工具（中性提示）"p95 29.5 min；代价是读缓存 token 更多（媒体称约 3.8 倍，**该倍数为二手换算，未证实**）。

---

## 2. Super-agent 设计拆解

### 2.1 四个目标特征与五个模块

四特征：**连续（Continuity）、高效（Efficiency）、主动（Proactivity）、持久（Persistence）**。五模块（文章 §2–§6）：

| 模块 | 要点 |
| --- | --- |
| §2 双层架构 | Router 层：常驻、唯一对人接口、全局序列点/协调点/记忆；**不执行具体任务，甚至可以没有 Bash 工具**，可用轻量模型。Worker 层：每个任务一个隔离上下文 Session，全套工具，用最强模型；**不直接对人说话**，只向 Router 汇报；Worker 内部可再起 Subagent 或 Agent Team，对 Router 透明 |
| §3 事件驱动 | 环境事件统称 **Trigger**；两段式过滤（程序化快路径：来源/群/白名单 → 语义慢路径：LLM 按提示词策略判断）；**Thread**（同一 PR / IM 话题 / 邮件会话的事件流）；Router 起 Worker 后 Worker **订阅 Thread**，后续事件由代码**直通**给 Worker，不再经 Router；订阅是多对多；**Inline & Spill**（上下文窗口当缓存：先给 ID+摘要，按局部性内联，超限溢出留引用）与 **Chain of Recall**（每个对象内联相关对象 ID，形成引用图，多跳召回）；**投机执行**（环境信号→后台先干，有价值才交付，否则丢弃） |
| §4 面向人的交互 | **异步 ReAct Loop**：耗时工具改成 `start()`/`stop()`，立即返回 Started，完成后作为新事件消息送回会话——前台可继续接话；按渠道定制输出（IM 每条 ≤100 词，GitHub/邮件结构化高密度） |
| §5 存算分离 | (1) Agent Loop 的计算放无状态弹性容器，Session 状态放数据库；(2) 云端 Loop 与重状态执行环境解耦：端侧**轻量 daemon 不存会话状态，只执行命令返回结果**，支持 BYOM（自带机器）、间歇在线设备；明确呼应 Anthropic "brain/hands 分离" |
| §6 Watchdog | 主系统之外的独立 Agent Session，由定时消息驱动，既监控基础设施故障（API 错误、状态恢复失败），也用模型判断 Worker 是否有实质进展/是否偏离目标；是带全套工具的 Session，可用自然语言问它、让它改运行时的提示词与触发规则 |

实验结论值得记：**去掉订阅直通，完成时间基本不变，但 Router 决策数 +30%，cache-read token 2323 万→3177 万（+37%）**——直通省的是 Router 开销而非时间；Router 批处理：Trigger 到达率 1→40/分钟，平均批大小 1.0→2.8，单请求耗时 2.5→3.9s，**摊到每个决策的推理时间 6.4s→1.6s**（"积压事件下一轮合并注入，prefill 并行"）。

文章列出的开放问题：Router 扩展（何时分片）、跨月长期记忆、Worker 间通信与 prompt-injection 桥、**云端 Loop 被攻破则所有接入设备沦陷**、凭证不得进入模型上下文。

### 2.2 原型的领域模型（`docs/001-domain.md`，已读源码）

```
Source ──Trigger──▶ Thread ──batch──▶ Eval ──accept(Mandate)──▶ Ticket ──Assignment──▶ Executor(Worker Session)
                      └────Subscription fan-out────────────────▶ Ticket
                                                  Ticket ──Channel──▶ Source(回复)
```

| 概念 | 关键规则（出自文档/`src/core/model.ts`） |
| --- | --- |
| Source | 事件流（GitHub、飞书）；持有读位置与自己的 bot 身份；**重启不得重放事件**；把原生事件翻译为 Trigger 与所属 Thread/Channel |
| Trigger | **不可变**事件；`{id, source, threads[], actor, human, addressed?, at, text, channel?, meta}`；接收两次只产生一个 Ticket（幂等） |
| Thread | Trigger 的时间序；**同一 Thread 同时最多一个 Eval**，期间到达的 Trigger 合并进下一批；持有 `subscriptions[]`、`pending[]`、`evaluating?`、决策历史 |
| Eval | 两层：Gate（确定性：谁可发起、强度 explicit/inferred）+ Assessment（模型研判）；输出 Decision：accept/stop/ignore/unavailable；自身无状态，Policy 变更时丢弃重跑 |
| Mandate | accept 授予的**不可变**授权：`{strength, policyVersion, basis(via: addressed/followup/admission/bot), actor, scope}`；更大范围必须新开 Ticket；恢复已结束 Ticket 前按当前 Policy `revalidate` |
| Ticket | 一个获授权的工作单元；仅 Eval 能创建；`open → ended`，人的消息可让它 resume（除非人 stop 过）；有 `assignments[] / inputs[] / undelivered[] / follows[] / attention?`；**自己定义状态，不跟随 Executor 状态** |
| Assignment | Ticket 与一个 Executor 实例的绑定（`pending→running→ended`），上报 Report：`progress/waiting/ready/blocked/failed/dropped` |
| Subscription | Ticket↔Thread 多对多，由 Thread 持有。匹配的 Trigger **无条件扇出**给所有活跃订阅 Ticket（不检查发送者）；**订阅只给上下文，不给权限**（权限只来自 Mandate）；已结束的 Ticket 保留订阅，人类新消息可无需 Eval 直接 resume |

关键设计取舍（`001-domain.md` "Rejected concepts"）：不引入 Principal/Membership 实体（人只是 Trigger 元数据）；不允许"Eval 给自己排延迟触发"（需要等待的条件本身就是一个 Source，避免 Eval 反向依赖 Source）；不做"追加到 Ticket"这种 Decision（追加=订阅扇出，无需 Eval）；Policy 变更**不取消**运行中的 Ticket（只记录并投递通知，避免半成品）。

### 2.3 原型的运行时实现（已读源码，位置可核对）

- **一个写者**：`Engine`（`src/core/engine.ts`）是 Trigger/Thread/Decision/Ticket/Assignment 的唯一写者，所有方法**同步**、每条命令一个事务；对外只暴露角色化的 `Pick`（`EngineForSources/MainSession/People/Settings/Executor`）。端口见 `src/core/ports.ts`：`Repositories / Policy / SourceScope / Assessor / Executor / Outbox`。`src/core` 不做 I/O（"does no I/O"）。
- **领域事件**：`DomainEvents`（`ports.ts`）：`trigger.received / eval.started / decision.recorded / ticket.created / ticket.resumed / ticket.ended / assignment.started / assignment.ended / thread.subscribed / thread.unsubscribed / trigger.requeued / policy.changed`。注意：原型**并非纯事件溯源**——聚合（Thread/Ticket）是 JSON blob 状态存 SQLite，只有 Trigger 不可变、其余靠覆盖写；领域事件主要用于通知。
- **持久化**：`src/app/store.ts:64-87`，单个 SQLite（`PRAGMA journal_mode=WAL; synchronous=FULL`，`chmod 0600`），表 `kv/trigger/disposition/thread/ticket/decision/outbox/trigger_thread/effect`；`Store.afterCommit` 保证回滚不会触发副作用；目录锁防止第二进程迁移/写入。
- **事务性 outbox（Effects）**：`src/app/effects.ts`，`effect(kind, key, value, seq, attempts, due…)` 主键 `(kind,key)`，命令在事务内 `enqueue`，**提交后**才由 handler 执行；指数退避重试（2s→60s；回复 5s→300s）；种类：`assessment / launch / delivery / relay / notice / reply`；relay 与 notice **有序**（失败的挡住后续同类）。这就是"一切副作用皆事件/任务、崩溃可恢复"的落地。
- **Router=主 Session，Worker=每 Ticket 一个 Session**：`src/app/sessions.ts:48` `ROUTER_PRESET='dsh-superagent-router'`、`WORKER_PRESET='dsh-superagent-worker'`；Worker 名为 `worker-<ticket id>`，目录在 `<stateDir>/work`（`src/executor/dsh.ts`，`workerSessionId`）；前台 shell 5 秒后转后台，保证 Worker 能在下一步收到新消息（`docs/003-execution.md`）；Worker 工具白名单 `WORK_TOOLS`（`sessions.ts:61`，含 `subagent/send_message/list_agents/interrupt_agent`）；Router 的 prompt 极短（`prompts/orchestrator.md`，16 行："Workers investigate and implement; never add implementation plans""never wait with sleep"）。
- **插话投递**：`src/app/delivery.ts:66-85` `send(agent, requestId, text, mode: 'queue'|'steer'|{inject})`：`steer`→`agent.steer(message)`（下一步插入）、`queue`→`agent.followup(message)`（下一个 turn）、`inject`→写入历史但不唤醒；用 `requestId` 派生消息 id，先查历史与 inbox 去重（**至少一次 + 幂等**），`await sessionPersistence.flush()` 后才向生产者 ack。
- **并发槽位**：`WorkerSlots`，人的消息可多用一个额外槽，保证"新活不能挡住人继续老 Ticket"（`003-execution.md` Concurrency）。
- **重启恢复**：运行中的 Assignment 以 "host restarted" 结束，新 Assignment 带**恢复说明**重新启动（"先检查目录、git 历史和 GitHub 再重复任何外部动作"），最老 Ticket 优先；已 waiting/ready/blocked/failed 的保持不动。
- **授权三档**：`off / observe（默认）/ auto`；observe 下 inferred 的接单只记录 "would accept"（`docs/002-authorization.md`）。这是"主动但可控"的关键落地。

### 2.4 原型"没有"的部分（避免误以为已有）

- 无 Watchdog Session、无存算分离/云端常驻/BYOM daemon（README 声明部分设计为未来方向；第三方《dsh-superagent 深挖报告》https://www.bytenote.net/article/dsh-superagent-deep-dive-report 称这些在 docs 000–008 无对应，SETUP 仅本机 tmux + 小时级健康检查——**第三方结论，我只核对了 docs 与 `src` 的命名，未穷尽核对**）。
- Worker "隔离"仅是独立 Session + 独立目录，文档自承不是安全边界；"以操作员 OS 用户权限无审批执行命令"。
- 未证实的安全传闻：有第三方称 `x-orchestrator-request: 1` 请求头即可绕过本机管理 API 认证（见 https://aicodewith.ai/zh/blog/deepseek-super-agent-review-dsh-superagent ）。**我没有复核该源码**，仅作为"不要照搬本机 HTTP 管理接口"的提醒。
- 原型自身不实现 fork；Ticket 恢复是"同 Session 继续"，不是分支。

---

## 3. 底座 DSH：有状态 Session、分支、插话（本课题的"真正答案"）

以下来自本地 `repos/deepseek-harness`（`packages/`）与 Rememorio 源码笔记（对应 commit `687f282`, `dsh-v0.2.1-rc.2`）。

### 3.1 事件溯源的 Session

- `docs/subsystems/session.md`：**Session 是 append-only 的 `SessionEvent` 日志，是整个交互历史的唯一事实源；LLM 消息历史是从日志派生的，不单独存储**。"model-visible means logged"：凡是模型能看到的必须已记录。
- 事件词汇：`system/message, developer/message, user/message, assistant/message, tool/result`（五类带 `surfaceOp: append | replace{startSeq,endSeq}`，即"当前模型视图 surface"）；执行类 `turn/start, step/start, tool/call, step/end, turn/end`；诊断类 `request/header, assistant/attempt`；日志专用 `session/end-seed` 等。压缩(compaction)=一条 `replace` 事件**遮蔽**旧节点但原日志保留（`sourceEventSeqs` 必须覆盖所有被遮蔽节点）；人类时间线读 append 事件，模型读 surface。
- 写入保证：`Session.append()` 对数据做无损 JSON 快照→分配连续 `seq`→深冻结→校验→提交一次；事件在提交后才通知监听者；监听者异常被隔离；生产者要持久化需显式 `flush()`（`delivery.ts` 正是这么做的）。
- 代码位置：`packages/core/session/src/{index.ts,fork.ts,surface.ts,repair.ts,tool-history.ts}`。

### 3.2 Fork（分支）

- API：`SessionStore.fork(source, boundary?, childSessionId?)`（`packages/core/session/src/index.ts:1403`）。`boundary` 是包含的 `seq`；默认当前末尾；**前缀不得结束在开放 turn 内**（会拒绝而不是静默截断）；子会话记录 `parentSession`、`isSeeded`、`inheritedEventCount`，继承 `cwd`。
- 精确前缀 fork（实现笔记 `2026-08-18-arbitrary-seq-session-fork`）：`buildForkSeed(events, boundary)`（`fork.ts:21`）复制前缀→追加 `session/end-seed{inherited:true}`→`openTurnClosers(prefix,{kind:'forked'})`：对未完成的 step 补**合成 tool result**（`TOOL_NOT_STARTED` / `TOOL_OUTCOME_UNKNOWN`，措辞明确警告"父会话可能在切点之后执行了该调用，重试前请检查幂等性/外部状态"），并补 `step/end`、`turn/end{reason: forked}`。这与崩溃恢复共用同一套"补配对"算法，仅 cause 不同。
- 子代理 fork（`subagent_fork`）用**已完成 turn 的前缀**作种子，捕获一次，之后父事件不同步；并强调 "Same-route fork cache reuse depends on the final request prefix"（前缀不变则 prompt cache 可复用，这是 fork 的经济性来源）。
- 重要提醒：**fork 分支的是对话历史，不是文件系统**（Claude Agent SDK 文档同样强调）；工作区隔离要另靠 git worktree / checkpoint。

### 3.3 插话（Steer / Queue / Interrupt）

- `Agent`（`packages/core/agent/src/runtime-types.ts`）：`steer(message)`（line 260：提交给**最近一步**，空闲则开新 turn）、`followup(message)`（251：下一 turn）、`cancel(cause, {keepInbox})`（212：清空/保留 inbox 并中止活动 turn）；`inbox` 有 `nextTurn`、`nextStep` 两个队列。
- `SubagentManager`（`packages/subagent/subagent/src/manager.ts`：`interrupt` 约 188 行、`sendMessage` 561 行）：
  - `sendMessage()` 必须是**直接父子**且发送者是存活的精确实例；工作中的目标收到 Steer，空闲目标开新 turn，直接子可**冷恢复**（从持久日志重建）；
  - `interrupt(target, authority)`：授权方为"人的操作"或"存活的祖先 Agent"；即发即返；**保留未被认领的 inbox、Activation、已发布的后代**，已认领的不重新入队；
  - 人类输入分 Queue / Steer；"一个子代理 = 一个持久 Session + 至多一个进程内 Activation（常驻期）"，Activation 与 Session 分离：Session 可跨多次常驻，取消/清理只针对一次执行。
- `ActivationPool` 默认 `maxActiveSubagents=8`，同树本地+外部后代共用，超限立即以 `ACTIVATION_LIMIT_REACHED` 拒绝；`maxDepth` 默认 1。
- 外部后端已作为 Provider 接入：`dsh-subagent-acp / -codex / -claude-code / -dsh-sdk`（外部后端"执行一次"，无本地 inbox）。**这正是本项目"桌面端把 Claude Code/Codex 当子 agent"的现成参考**（文档：https://deepseekplugin.com/docs/subsystems/subagent）。
- 已知缺口（作者自述）：已接受但未写入日志的消息在崩溃时可能丢失；Team 不再保留"未被接受的发送意图"、重启不重发。

### 3.4 其他可借鉴

`packages/schedule/schedule`（定时事件）、`packages/goal`、`packages/spill`（Inline&Spill 的底座）、`packages/workflow`（脚本化编排，进程边界仅传 JSON）、`packages/host`、`packages/typert`。Cordis 插件运行时提供"一切皆插件"的依赖注入，但与本项目（Rust）语言栈不同，**只借思想，不借代码**。

---

## 4. 相关思想与项目对比

### 4.1 总对比表

| 项目/思想 | 状态载体 | 分支(fork) | 插话 | 事件/触发 | 崩溃恢复 | 对本项目的借鉴点 |
| --- | --- | --- | --- | --- | --- | --- |
| **DSH Super-agent 原型** | SQLite 聚合 JSON + effect outbox；Session 在 DSH | 无（Session 层有） | 经 `agent.steer/followup` | Source→Trigger→Thread→Eval→Ticket；订阅直通 | effect 重试 + 重启带恢复说明重启 Assignment | 领域词汇、授权/订阅分离、observe 默认、outbox |
| **DSH Session 层** | append-only 事件日志（v4 格式，JSONL 等持久层） | `fork(source,boundary)`，合成 tool result | `steer/followup/cancel`；子代理 `interrupt/sendMessage` | 插件 hook/事件 | 日志重放；`session/end-seed` 区分继承与现场 | **日志即事实源 + 投影**；fork 补配对 |
| **Anthropic Managed Agents**（2026-04-08） | Session = 外置追加日志；Harness 无状态"cattle"；Sandbox 是 `execute(name,input)→string` 的"hands" | 日志切片 `getEvents()` | — | `wake(sessionId)` 重启 harness；`emitEvent` 追加 | harness 崩溃→新 harness 读日志续跑 | **脑/手/日志三分**；凭证不进沙箱（https://www.anthropic.com/research/managed-agents ）；p50 TTFT -60%、p95 -90%（官方自报） |
| **Claude Code / Agent SDK** | `~/.claude/projects/<cwd>/<id>.jsonl` 转录；`SessionStore` 适配器可镜像到外部库 | `--fork-session`、`/branch`、SDK `forkSession({upToMessageId})`；**只分历史不分文件**，文件靠 checkpoint `/rewind` | 流式输入模式：排队消息 + `interrupt()`（返回 `still_queued`，可 `cancel_queued`） | `--bg` 后台会话、`--channels`、`--from-pr`、hooks | `--resume/--continue` | 外部 Agent 适配的主接口；jsonl 可被消费；https://code.claude.com/docs/en/agent-sdk/sessions |
| **OpenAI Codex app-server** | JSONL rollout 文件；thread/turn/item 模型 | `thread/fork`（`lastTurnId` 截断，`ephemeral`，`forkedFromId`）；`thread/revert` | **`turn/steer`**（需 `expectedTurnId`）、`turn/interrupt`（状态 `interrupted`） | 通知流 `item/*`、`turn/completed`；`thread/inject_items` | `thread/resume` | 本项目接 Codex 的首选协议（JSON-RPC 2.0，stdio/ws/unix socket）；README `codex-rs/app-server/README.md` |
| **OpenHands Software Agent SDK V1**（论文 arXiv 2511.03690，MLSys 2026） | `ConversationState`（唯一可变）+ `EventLog`（每事件一个 JSON：`event-{idx:05d}-{id}.json`），Agent/Tool/LLM 全不可变 | **树形日志**：事件带 `parent_id`，`leaf_event_id` 即 HEAD；`fork(from_event_id=…)` 深拷贝；`navigate_to(event_id)` 原地换 HEAD，废弃分支留盘 | `pause()`、`interrupt()`（取消 asyncio task + cancel token 让并行工具提前退出）、`send_message` | 事件层级：LLMConvertible vs 内部事件；server 有 REST/WebSocket | 加载 `base_state.json` + 重放事件；**持久化 <1ms，崩溃恢复 <20ms**（论文自报） | **用 parent_id 表示分支，比"复制前缀"更省**；`View` 缓存活动分支投影。本地：`repos/software-agent-sdk/openhands-sdk/openhands/sdk/conversation/{state.py:181,331-361, event_store.py, base.py:461-520}` |
| **LangGraph** | Checkpointer 在每个 super-step 存 `StateSnapshot`（values, next, tasks, parent_checkpoint）；按 `thread_id` 组织 | `update_state(checkpoint_config, values, as_node)` 生成新 checkpoint 分支；原历史不动 | `interrupt()` + `Command(resume=…)`（HITL）；不是并行插话 | — | 从最后成功 super-step 续；replay **会重新调用 LLM/工具**（官方警告外部副作用不回滚） | `as_node` 概念；"replay 与 fork 都是从检查点恢复"；https://docs.langchain.com/oss/python/langgraph/use-time-travel |
| **Letta (MemGPT)** | "Agent=持久身份+记忆"；旧 Python server 已退役（`letta` 仓库只剩 README，指向 `archive` 分支）；当前在 `letta-code`：**MemFS = git 仓库形式的记忆，投影到任意机器** | 对话(conversation)是同一 agent 的并行线程，共享记忆 | `send()` 在 turn 进行中则排队，由 runtime 持有队列 | **Dreaming / sleep-time**：按步数或压缩事件触发后台子代理整理记忆 | 状态在云或本地 App Server | 记忆 ≠ 会话日志，二者要分层；记忆以 git 版本化；"睡眠期子代理"可作为本项目后台事件消费者。（仅读了文档与目录，未深读 `letta-code` 源码，**浅层结论**） |
| **OpenClaw** | Gateway 持有全部 session 状态，UI 只是客户端 | 有"branch changes invalidate read"提示 | **队列模式 `steer / followup / collect / interrupt`**，默认 steer + 500ms debounce + cap 20 + drop=summarize | cron/heartbeat/webhook/群聊分别路由到不同 session 策略；"会话控制器=谁拥有下一个 turn" | 入站消息可在入 mailbox 前持久化 | 插话策略的**产品化命名**，建议直接沿用这四种；https://docs.openclaw.ai/concepts/queue |
| **Temporal** | Event History + 确定性重放；Workflow 代码必须确定性，Activity 做副作用 | Workflow reset 到某事件（未深究，**未证实细节**） | Signals / Updates | Signal、timer | 重放，不匹配则报非确定性错误 | 重，需要集群；适合云端控制面，不适合桌面轻量 |
| **Restate** | 单 Rust 二进制，journal + Virtual Object（按 key 的状态，同 key 串行） | — | 持久取消信号沿子调用传播；`restatedev/agent` 参考实现支持 **steer / interrupt 贯穿子代理、approval** | Awakeable、durable timer | journal 重放 | **与本项目最契合的外部参考**：key=agentId 的 Virtual Object + Agent/AgentSession 双对象；BSL 许可（注意商用约束）；https://github.com/restatedev/agent |
| **DBOS** | 库 + Postgres 表 | **`forkWorkflow(id, startStep)`**（新 ID，复制前面步骤结果）、`rewindWorkflow` | `recv`/events | — | 从最后完成 step 恢复 | "从 step N fork"的语义定义很清晰；需要 Postgres |
| **Inngest** | 事件驱动函数，step 结果按名字缓存，函数体重复执行 | — | `step.waitForEvent` | **事件是一等公民**（event/cron/webhook） | 重放 | "事件→函数"的触发模型；注意"改 step 名会孤立在途 run" |
| **Actor 模型**（Erlang/Akka/Orleans；Rust: ractor/kameo/tellus/coerce） | 每个 actor 私有状态 + 邮箱 | — | 邮箱消息天然是"插话"的载体 | 消息即事件 | 监督树重启；事件溯源 actor（tellus、coerce 内置；其余需外挂） | 子 Agent=actor：一个邮箱、串行处理、监督重启。Rust 框架对比见 https://tellus.rs/docs/explanation/comparison/（作者为 tellus 自家文档，**有偏**）；ractor 更偏 OTP 语义/优先级，kameo 更偏易用与内建 libp2p |

### 4.2 从对比中提炼的共识

1. **日志是真相，其余皆投影**（DSH、Managed Agents、OpenHands、Claude Code jsonl、Codex rollout）。
2. **Harness 无状态**（Managed Agents "cattle"、Super-agent §5.1）：任何实例读日志可续跑。
3. **Fork 有两种实现**：*复制前缀*（DSH、Codex、Claude）和*树形 parent_id*（OpenHands）。后者省空间、分支共享祖先事件；前者简单、分支独立、便于迁移到另一台机器/另一后端。
4. **Fork 必须处理"悬空 tool call"**：DSH 补合成结果并警告重试风险；Codex 在源线程 mid-turn 时写 interruption marker；这是 fork 不出幻觉的关键细节。
5. **插话至少三态**：steer（当前 turn 的下一步插入）、queue/followup（下个 turn）、interrupt（取消当前 turn，保留或丢弃队列）。Codex 加了 `expectedTurnId` 乐观并发校验，OpenClaw 加了 collect（合并窗口）。
6. **副作用外化**（outbox/effect、LangGraph pending writes、Temporal Activity）：fork/replay 不会"撤销"已发出的邮件或 git push——需要显式的**副作用账本**。

---

## 5. "万物皆事件 + 有状态子 Agent + 可分支插话"运行时设计要点

### 5.1 总体分层（对应用户第 7 条诉求）

```
┌────────────────────────────── 设备/渠道层 ──────────────────────────────┐
│ Sources: 桌面UI输入 / 定时器 / GitHub / IM / 邮件 / 文件监视 / 子Agent回调  │
└───────────────▶ Event Gateway（规范化→幂等→过滤→落库）───────────────────┘
                                │ append
                     ┌──────────▼───────────┐
                     │ Event Store (SQLite)  │  events / threads / subscriptions / sessions / effects
                     └─┬────────┬───────────┘
        订阅直通(代码)  │        │ 未订阅 / 需评估
                     ▼        ▼
        ┌──────── Worker Session ◀──────── Router Session（轻量，常驻，只分派/对人）
        │  (有状态，可 fork/steer)           │ 批处理积压 Trigger（SuperAgent §2.1）
        │   ├ 内建子Agent（同Runtime）        │
        │   └ 外部Agent适配器: Claude Code / Codex / ACP 任意
        ▼
   Hands（执行环境）：本机/其他电脑 daemon、远程浏览器；只暴露 execute(name,input)->result
        │
        └─ 结果/状态变化 ⇒ 新事件（回到 Event Gateway）  ← "子智能体回调通知也是事件"
Watchdog Session ← 定时事件驱动，检查进度/偏离，必要时 steer/interrupt/重启
```

### 5.2 设计要点（建议作为运行时的硬约束）

1. **唯一入口**：任何触发（用户输入、cron、GitHub PR、子 Agent 完成、工具后台任务结束、设备上线）统一进 `Event`，带 `idempotency_key`（来源+原生 id），先落库后处理；**用户输入也只是一种 Trigger**，UI 看到的是投影。
2. **单写者 + 事务 + outbox**：内核（Rust 单线程命令处理器或每聚合一个 actor）串行写；命令在一个 SQLite 事务内"追加事件 + 更新投影 + 入 effect 队列"，提交后才执行外部副作用（发消息、拉起进程、调用模型）。直接移植原型的 `Effects` 思路与 `afterCommit`。
3. **两类日志分开**：
   - *Domain log*：Trigger/Decision/Task 等业务事件（审计、授权、幂等）；
   - *Session log*：每个 Agent 会话的 append-only 消息/步骤事件（DSH/Managed Agents 风格），模型上下文是其**投影**。外部 Agent（Claude Code、Codex）的会话日志由其自身保存，我们只存**引用 + 镜像的事件摘要**（见 §6.4）。
4. **Router 极轻**：Router = 一个常驻 Session + 少量 tool（`accept/route/attach/note/reply/stop/read`），无 Bash；积压 Trigger 批量注入下一轮（直接采用文章 §2.1 的批处理）；其工作中的一部分（过滤、订阅匹配）用**代码**而非 LLM（Fast/Slow path）。
5. **订阅直通**：`Thread ↔ Task` 多对多订阅由事件网关用代码投递给 Worker 的 inbox，不经 Router；订阅仅给上下文，不给权限（Mandate/Capability 另算）。
6. **Worker=有状态 Session，Activation 与 Session 分离**（采用 DSH 术语）：Session 持久、可冷恢复；Activation 是进程内一次常驻执行；取消/清理只作用于 Activation。同一 Session 至多一个 Activation，天然串行（actor 邮箱语义）。
7. **插话四态**（沿用 OpenClaw/Codex 词汇）：`steer`（下一步注入，需 `expected_turn_id` 乐观校验，失败降级为 followup）、`followup`（下个 turn）、`collect`（去抖合并后一次 followup）、`interrupt`（取消当前 turn，`keep_inbox` 可选）。所有插话都落成事件，有 `request_id` 幂等，ack 在 flush 后。
8. **分支（fork）语义**：
   - `fork(session, at_seq | at_turn, strategy)`：生成新 Session，记录 `forked_from(session_id, seq)`；
   - 悬空 tool call → 合成 `tool_result{status: not_started|outcome_unknown}` 并在 prompt 中带"重试前先检查副作用"的提示；
   - **文件系统隔离是 fork 的一部分**：默认给分支新建 git worktree（或 jj/快照），否则两个分支写同一目录会互相覆盖；
   - **副作用账本**：每个对外副作用（PR、消息、转账）有 `effect_id` 与 `session_id` 绑定，fork 时标记"继承自父、不会重放"，避免分支重复发送。
9. **事件→任务生命周期**独立于 Agent 状态（Ticket/Task 自己定义状态：open/waiting/ready/blocked/failed/ended），Agent 只"上报"，不决定任务终局（原型的 Rejected concepts 之一）。
10. **授权分层**：Mandate 不可变、含 policy 版本；订阅只给上下文；主动（speculative）行为默认 `observe`（仅记录 would-do），白名单灰度到 `auto`。
11. **Hands 与 Brain 解耦**：设备上的 daemon 无会话状态，只暴露 `execute` 与流式输出；**凭证只在 daemon/凭证代理侧**，模型上下文里只有句柄（文章 §8.4 与 Managed Agents 的安全边界一致）。
12. **Watchdog**：本质是由 `Schedule` 事件驱动的另一个 Session；输入是"各 Task 的进度快照事件"，权限 = steer/interrupt/retry，禁止直接改代码。

### 5.3 触发源与事件规范（建议）

```
event.kind ∈
  user.message | user.steer | user.interrupt | user.approve
  schedule.fired | webhook.github.* | channel.im.message | channel.email.received
  task.reported | task.ended | session.turn_ended | session.tool_job_finished
  device.online | device.offline | policy.changed | watchdog.alert
```

---

## 6. 数据模型草案

> 目标：SQLite（WAL，`synchronous=FULL`）单文件、可迁移到 Postgres；Rust 端 `serde` + 判别联合。表以 `ULID/UUIDv7` 为主键。以下为草案，字段可在落地时再裁剪。

### 6.1 表结构

```sql
-- 1) 领域事件（不可变，幂等入库）。Trigger 是其中一类。
CREATE TABLE event (
  id            TEXT PRIMARY KEY,         -- ULID
  seq           INTEGER NOT NULL UNIQUE,  -- 全局递增，AUTOINCREMENT
  kind          TEXT NOT NULL,            -- 见 §5.3
  source        TEXT NOT NULL,            -- 'github:owner/repo' | 'ui:desktop-1' | 'cron' | 'agent:<session>'
  idem_key      TEXT,                     -- 来源原生ID；UNIQUE(source, idem_key)
  actor         TEXT,                     -- 来源自己的身份词汇
  human         INTEGER NOT NULL DEFAULT 0,
  addressed     TEXT,                     -- 'mention'|'direct'|NULL
  at            TEXT NOT NULL,            -- ISO8601 UTC
  payload       TEXT NOT NULL,            -- JSON，来源原生数据，核心不解析
  UNIQUE(source, idem_key)
);
CREATE TABLE event_thread (thread_key TEXT, event_id TEXT, at TEXT, human INTEGER, PRIMARY KEY(thread_key,event_id));

-- 2) Thread 与订阅（订阅=直通路由）
CREATE TABLE thread (
  key TEXT PRIMARY KEY,            -- "{source}:{id}"
  meta TEXT, last_at TEXT,
  evaluating TEXT,                 -- 当前 Eval 的 id，至多一个
  pending TEXT                     -- JSON array of event ids，下一批 Eval
);
CREATE TABLE subscription (
  thread_key TEXT, task_id TEXT, mode TEXT,   -- 'owner' | 'context'
  PRIMARY KEY(thread_key, task_id)
);

-- 3) Task（原型的 Ticket）：授权工作单元，状态独立于 Agent
CREATE TABLE task (
  id TEXT PRIMARY KEY, title TEXT,
  mandate TEXT NOT NULL,           -- JSON，不可变：{strength, policy_version, basis, actor, scope}
  state TEXT NOT NULL,             -- open|waiting|ready|blocked|failed|ended
  ended TEXT,                      -- JSON {at,by,outcome,reason}
  origin_event TEXT NOT NULL, channels TEXT,   -- 回复通道
  attention TEXT,                  -- 待人决定的结构化问题
  created_at TEXT, updated_at TEXT
);

-- 4) Session：任何"有状态Agent会话"（Router/Worker/Watchdog/外部Agent代理）
CREATE TABLE session (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL,              -- router|worker|watchdog|subagent
  backend TEXT NOT NULL,           -- 'native'|'claude_code'|'codex_appserver'|'acp:<name>'
  backend_ref TEXT,                -- 外部后端的 session/thread id（如 codex threadId、claude session_id）
  task_id TEXT, parent_session TEXT,
  forked_from_session TEXT, forked_from_seq INTEGER, inherited_count INTEGER,
  device_id TEXT, workdir TEXT, worktree_branch TEXT,
  state TEXT NOT NULL,             -- idle|running|parked|failed|archived
  activation_id TEXT,              -- 当前进程内 Activation（至多一个），重启清空
  preset TEXT, model_route TEXT, created_at TEXT
);

-- 5) Session 日志（append-only；原生 Agent 全量，外部 Agent 存摘要镜像）
CREATE TABLE session_event (
  session_id TEXT NOT NULL, seq INTEGER NOT NULL,      -- 会话内连续 seq
  id TEXT NOT NULL UNIQUE, parent_id TEXT,             -- 可选：树形(OpenHands式)而非复制前缀
  type TEXT NOT NULL,       -- user/message, assistant/message, tool/call, tool/result, turn/start, turn/end{reason}, step/*, compaction/replace, session/end-seed, steer/accepted, interrupt, ...
  data TEXT NOT NULL, at TEXT NOT NULL,
  source_event_id TEXT,     -- 触发它的领域 event（因果链）
  PRIMARY KEY(session_id, seq)
);

-- 6) Assignment：Task ↔ Session 绑定（可更换）
CREATE TABLE assignment (
  id TEXT PRIMARY KEY, task_id TEXT, session_id TEXT,
  state TEXT,                      -- pending|running|ended
  report_state TEXT, report_summary TEXT, report_at TEXT,
  delivered_at TEXT, idle_at TEXT
);
CREATE TABLE task_input (            -- 待投递给 Session 的输入
  id TEXT PRIMARY KEY, task_id TEXT, kind TEXT,  -- trigger|note|policy|resume|text
  event_id TEXT, delivered_to TEXT, read_at TEXT, mode TEXT  -- steer|followup|inject
);

-- 7) Effect outbox（提交后执行，指数退避；与 DSH 原型同构）
CREATE TABLE effect (
  kind TEXT, key TEXT, payload TEXT, seq INTEGER, attempts INTEGER DEFAULT 0,
  due INTEGER, error TEXT DEFAULT '', ordered_group TEXT,
  PRIMARY KEY(kind, key)
);
CREATE TABLE side_effect_ledger (     -- fork 防重复：对外副作用账本
  effect_id TEXT PRIMARY KEY, session_id TEXT, task_id TEXT,
  kind TEXT, target TEXT, status TEXT, inherited_from TEXT, at TEXT
);

-- 8) 设备与租约（多机、间歇在线）
CREATE TABLE device (id TEXT PRIMARY KEY, name TEXT, online INTEGER, last_seen TEXT, caps TEXT);
CREATE TABLE lease  (resource TEXT PRIMARY KEY, holder TEXT, expires TEXT);  -- 如 "session:<id>" 的 Activation 租约
```

### 6.2 Rust 类型草图

```rust
pub enum Delivery { Steer, Followup, Collect, Inject }          // 插话模式
pub enum CancelCause { User, Ancestor(SessionId), Watchdog, Shutdown }

pub struct ForkRequest {
    pub source: SessionId,
    pub at: ForkPoint,                       // Seq(u64) | Turn(TurnId) | Latest
    pub open_tail: OpenTailPolicy,           // CloseWithSyntheticResults | Reject
    pub workspace: WorkspacePolicy,          // NewWorktree | Share | Snapshot
    pub backend: Option<BackendKind>,        // 允许"以 Codex 分支，再换后端续"需另议
}

#[async_trait]
pub trait AgentBackend {                     // 原生 / Claude Code / Codex / ACP 统一端口
    async fn start(&self, spec: SessionSpec) -> Result<SessionHandle>;
    async fn resume(&self, r: &BackendRef) -> Result<SessionHandle>;
    async fn fork(&self, r: &BackendRef, at: ForkPoint) -> Result<BackendRef>;
    async fn send(&self, h: &SessionHandle, input: Input, mode: Delivery,
                  expected_turn: Option<TurnId>) -> Result<Accepted>;
    async fn interrupt(&self, h: &SessionHandle, keep_inbox: bool) -> Result<()>;
    fn events(&self, h: &SessionHandle) -> BoxStream<'static, BackendEvent>; // → 转为 session_event + 领域 event
    fn caps(&self) -> BackendCaps;           // supports_steer / supports_fork_at_turn / supports_background ...
}
```

### 6.3 状态机（Task 与 Assignment，沿用原型的"首个匹配"阶段表）

`person/delivery > person/answer > person/review(ready) > person/blocked,failed > working/queued > idle(waiting) > working`；人的新消息解除 blocked/failed。

### 6.4 外部 Agent（Claude Code / Codex）如何落入同一模型

| 能力 | Codex（app-server JSON-RPC） | Claude Code（Agent SDK / CLI） | 统一语义 |
| --- | --- | --- | --- |
| 建/续会话 | `thread/start`、`thread/resume` | `query({resume})`、`--resume` | `start/resume` |
| 分支 | `thread/fork{lastTurnId, ephemeral}` | `forkSession({upToMessageId})`、`--fork-session` | `fork(at_turn)` |
| 插话（当前 turn） | `turn/steer{expectedTurnId}` | 流式输入模式追加用户消息 | `send(mode=steer)` |
| 排队 | `turn/start`（线程忙则拒绝/排队，**未逐项核实**） | 流式输入排队 | `send(mode=followup)` |
| 中断 | `turn/interrupt` → `status: interrupted` | `Query.interrupt({cancel_queued})` | `interrupt(keep_inbox)` |
| 事件流 | `item/started|completed`, `item/agentMessage/delta`, `turn/completed` | `stream-json` 消息、hooks、`--include-hook-events` | `BackendEvent` |
| 日志读取 | `thread/turns/list`、`thread/items/list` | `getSessionMessages()`、`.jsonl` | 摘要镜像 |
| 文件隔离 | 线程 `cwd`/沙箱策略可每 turn 覆盖 | `--worktree`、checkpoint `/rewind`（**子代理的编辑通常不被 checkpoint 捕获**） | 由本项目的 worktree 策略统一负责 |

注意：外部 Agent 的内部 fork 只分历史；**文件隔离、副作用账本必须由本项目外层负责**。另有 ACP（`agentclientprotocol/agent-client-protocol`，已克隆在 `repos/`，本报告未深读）可作第三类通用适配器。

---

## 7. 对本项目的具体建议

1. **架构取向**：不要把 DSH 当底座（TS/Cordis、开发者预览、"THERE WILL BE COMPATIBILITY-BREAKING CHANGES"、原型存在安全弱点），而是**用 Rust 重新实现一个小而硬的事件内核**，逐点对齐 DSH Session 层与原型领域模型的**语义**。Rust 侧可选：`rusqlite`（WAL）+ `tokio`；actor 层可考虑 `ractor`（OTP 式监督/优先级，适合内核）或 `kameo`（易用、内建 libp2p，适合将来多机）——两者对比以 tellus 之外的来源为准（见 §4 表末说明），**建议先做 1 周的 spike 再定**，不要现在拍板。
2. **MVP 路径**（按价值/风险排序）：
   - M1：Event Gateway + `event/thread/task/session/session_event/effect` 七张表 + 单写者命令处理器 + outbox；一个原生 Router + 一个原生 Worker；`steer/followup/interrupt` 全链路 + 重启恢复；
   - M2：**Codex app-server 适配器**（协议最完整：fork/steer/interrupt/inject 一应俱全）与 Claude Code（Agent SDK）适配器；统一 `AgentBackend`；
   - M3：fork + worktree + 副作用账本；订阅直通；Router 批处理；
   - M4：设备 daemon（多电脑、远程浏览器作为 "hands"）+ 租约 + 凭证代理；Watchdog；
   - M5：投机执行（observe → auto）、Chain of Recall 记忆。
3. **默认安全姿态**：主动行为默认 `observe`；Worker 默认沙箱（至少独立 worktree + 命令白/黑名单 + 凭证不入上下文）；本机管理接口必须真认证（不要复刻原型中被质疑的"公开请求头即管理员"设计，**该质疑未证实但值得规避**）。
4. **Token 成本意识**：Super-agent 用更多缓存读 token 换低长尾延迟；桌面个人场景应：Router 用小模型、Worker 视任务选档、fork 尽量保持前缀不变以命中 prompt cache。
5. **产品面（呼应文章 §8.2）**：用户界面里的"一个对话"不必对应"一个 Session"。UI 层应展示 Task/Thread 视图 + 需要人处理的"待办收件箱"（原型 panel 理念："只显示需要人的"），Session 作为可展开的实现细节。这对"类 Muse"的界面设计有直接影响，建议与 UI 调研组对齐。
6. **复用而非重造**：
   - 事件溯源/Session 语义可参照 DSH `session.md` + 本报告 §6 自行实现；
   - 有状态+可 steer 的"持久化 agent"若不想自研，可评估 **Restate**（单 Rust 二进制，`restatedev/agent` 参考）——但许可为 BSL 1.1，且与"桌面轻量"相悖（需随应用分发另一个服务进程），**不建议作为桌面端底座**，可作为云端控制面选项；
   - 不推荐把 Temporal 放进桌面端。

---

## 8. 待用户拍板的问题

1. **事件内核语言与形态**：是否确认 Rust 单进程内嵌（SQLite）+ 可选云端同步？还是接受 TypeScript（可直接复用 DSH 思想和少量代码）以换取更快的 MVP？
2. **Session 日志的"真相"归属**：对 Claude Code / Codex，是以它们自己的会话文件为真相、我们只镜像摘要（轻、依赖其格式稳定），还是把全部事件复制进我们的 `session_event`（重、可跨后端迁移分支）？默认建议前者。
3. **分支实现**：复制前缀（简单、独立）vs 树形 `parent_id`（省空间）？建议原生 Agent 用树形，外部 Agent 用其原生 fork 接口。
4. **是否要做 Router 的 LLM 化**：一开始 Router 能否是"规则 + 小模型"，Worker 才用强模型？（文章主张 Router 轻量；个人场景的 Router 甚至可先不用 LLM，只用代码路由+手动确认）
5. **主动行为（投机执行）的初始范围**：是否首版就做 `observe` 模式？默认关闭还是默认记录？
6. **云端常驻是否在范围内**（决定是否需要 Watchdog/存算分离/云端 harness）？还是首版仅"桌面常驻 + 其他电脑 daemon"？
7. **许可/合规**：是否接受直接调用用户已登录的 Claude Code / Codex CLI（订阅协议、自动化使用条款需要法务确认，**我未核查各家 ToS**）？
8. **单用户 vs 团队**：Mandate/Policy/Allowlist 体系对个人 Agent 是否过重？建议个人版简化为"设备信任 + 三档主动度"。

---

## 9. 来源清单（含时间）

**DeepSeek Super-agent / DSH**
- 设计文章中文版（知乎转载，2026-10-31）：https://zhuanlan.zhihu.com/p/2099987320443237060
- 英译全文：https://offloop.org/learn/exploring-deepseek-super-agent-design
- 财联社 2026-10-31：https://www.cls.cn/detail/2521643 ；钛媒体：https://www.tmtpost.com/nictation/8188885.html
- 原型仓库及文档 000–008：https://github.com/deepseek-ai/dsh-superagent-prototype
- DSH 仓库：https://github.com/deepseek-ai/deepseek-harness ；Session 文档 `docs/subsystems/session.md`；子代理文档 https://deepseekplugin.com/docs/subsystems/subagent
- 源码笔记：https://rememorio.github.io/blog/deepseek-harness/en/event-sourced-session/ 、https://rememorio.github.io/blog/deepseek-harness/en/multi-agent-runtime/ ；https://hoco-scy.github.io/deepseek-harness-deep-dive/pages/log-replay.html
- Fork 实现决策记录（Gitea 镜像）：https://gitea.milesward.dev/mward4/deepseek-harness/commit/8696ec6cefd31344b9bb86c99369da133e764bd8
- 二手评论（含质疑，需交叉验证）：https://www.bytenote.net/article/dsh-superagent-deep-dive-report 、https://aicodewith.ai/zh/blog/deepseek-super-agent-review-dsh-superagent 、https://post.smzdm.com/p/ad7zx8vd/ 、https://stackademic.com/blog/deepseek-super-agent-router-worker-coding-agents 、https://dev.to/madnessbrains_i/deepseek-dsh-superagent-router-worker-isolation-for-parallel-coding-sessions-lia

**相关项目与文档**
- Anthropic Managed Agents（2026-04-08）：https://www.anthropic.com/research/managed-agents
- Claude Code 会话/Agent SDK：https://code.claude.com/docs/en/sessions 、https://code.claude.com/docs/en/agent-sdk/sessions 、https://code.claude.com/docs/en/agent-sdk/session-storage 、https://code.claude.com/docs/en/checkpointing 、https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode
- Codex app-server：https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md ；https://learn.chatgpt.com/docs/app-server
- OpenHands SDK 论文：https://arxiv.org/html/2511.03690 ；设计原则 https://docs.openhands.dev/sdk/arch/design ；事件 https://docs.openhands.dev/sdk/arch/events
- LangGraph：https://docs.langchain.com/oss/python/langgraph/use-time-travel 、https://docs.langchain.com/oss/python/langgraph/checkpointers
- Letta：https://www.letta.com/blog/sleep-time-compute/ 、https://www.letta.com/blog/our-next-phase/ （2026-03-16）、https://docs.letta.com/concepts/stateful-agents/index.md
- Restate：https://github.com/restatedev/agent 、https://docs.restate.dev/ai/patterns/interrupt-regenerate 、https://docs.restate.dev/ai/patterns/sessions
- DBOS：https://docs.dbos.dev/typescript/reference/methods （`forkWorkflow/rewindWorkflow`）
- 持久执行对比（2026-07~10，二手）：https://cadenya.com/other-content/durable-execution-for-ai-agents 、https://www.utilix.tech/blog/durable-execution-ai-agents-langgraph-temporal-inngest-dbos 、https://durableagents.com/landscape
- OpenClaw 队列/会话控制器：https://docs.openclaw.ai/concepts/queue 、https://docs.openclaw.ai/concepts/session-controller 、https://docs.openclaw.ai/concepts/architecture
- Rust actor 对比：https://tellus.rs/docs/explanation/comparison/ （有偏）、https://github.com/microsoft/dactor

## 10. 本地源码定位表

| 主题 | 路径 |
| --- | --- |
| 原型领域模型/端口/引擎 | `D:\code\xuqiu\repos\dsh-superagent-prototype\src\core\{model.ts,ports.ts,engine.ts,tickets.ts,evals.ts,intake.ts}` |
| 原型文档 | `...\dsh-superagent-prototype\docs\000-philosophy.md … 008-cookbook.md`（核心：001、002、003、007） |
| 原型 outbox/存储/投递/会话 | `...\src\app\{effects.ts,store.ts:60-100,delivery.ts:66-85,sessions.ts:48-62,notices.ts,runtime.ts}`；`...\src\executor\dsh.ts` |
| 原型 Router prompt | `...\prompts\orchestrator.md` |
| DSH fork | `D:\code\xuqiu\repos\deepseek-harness\packages\core\session\src\{fork.ts:21,index.ts:1403,repair.ts}` |
| DSH steer/followup/cancel | `...\packages\core\agent\src\runtime-types.ts:212,251,260` |
| DSH 子代理管理/interrupt/sendMessage | `...\packages\subagent\subagent\src\{manager.ts:188,561; activation.ts; control.ts; lifecycle.ts}` |
| DSH 定时 | `...\packages\schedule\schedule\src\` |
| OpenHands 树形分支/HEAD | `D:\code\xuqiu\repos\software-agent-sdk\openhands-sdk\openhands\sdk\conversation\{state.py:181,269-361; base.py:461-520; event_store.py; persistence_const.py; impl\local_conversation.py:2906,2931}` |
| Letta | `D:\code\xuqiu\repos\letta`（仅 README，旧 server 在 `archive` 分支，**未克隆**）；`D:\code\xuqiu\repos\letta-code\src\agent\memory-*.ts`（**仅看了目录，未深读**） |
| Codex app-server（他人已克隆） | `D:\code\xuqiu\repos\codex\codex-rs\app-server\README.md`（本报告通过网页读取，未在本地逐行核对） |

## 11. 局限与未证实项

- 未深读 `letta-code`、`codex`、`openclaw`、`agent-client-protocol` 本地源码；对应结论来自官方文档/搜索摘要。
- OpenHands 主仓库（`OpenHands/OpenHands`）未克隆：V1 事件溯源核心位于 `software-agent-sdk`，已克隆该仓库代替。
- DSH 的 v4 日志格式、持久化后端（JSONL 等）细节来自二手笔记；我仅在本地确认了 `fork.ts`、`runtime-types.ts`、`manager.ts` 的函数签名位置。
- Temporal 的 reset/fork 能力细节、Codex 在线程忙时 `turn/start` 的精确行为、各家 ToS：**未证实**。
- 实验数据均为 DeepSeek 自报的合成负载结果；"3.8 倍 token"为第三方推算。
- GitHub star 数、第三方安全审计结论随时间变化/来源单一，仅作参考。
