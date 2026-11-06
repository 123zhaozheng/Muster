# DeepSeek Super-agent 调研（面向 Muster 主 Agent / 分支功能重设计）

> 调研日期：2026-11-06。标注约定：**[源]** = 有原文/代码出处；**[二手]** = 来自媒体或转载整理，未能核对原文逐字；**[推断]** = 本文作者的推断/建议，非 DeepSeek 所述。

## 0. 先纠正名称与定性

- 并没有一个叫"超级 Agent"的正式商用产品。准确名称是 **Super-agent**，出自 DeepSeek **Harness 团队**的一篇设计长文《**Super-agent 设计探索：迈向更自主的 Agent 系统**》（英文 *Exploring Super-agent Design: Towards a More Autonomous Agent System*），2026-10-31 晚发布（DeepSeek 公众号 / X 账号 @DeepSeekHarness），作者署名 Yujia Qiao 实现并执笔。[二手：多家报道一致]
- 同时开源了原型 **`deepseek-ai/dsh-superagent-prototype`**（MIT，首个提交 2026-10-31 20:06 +08:00）。README 明确写："**Research prototype for reference only, not an official DeepSeek product** …… Some designs discussed in the article are directions for future development and are not implemented in this prototype." [源：仓库 README]
- 原型是 [DeepSeek Harness](https://www.deepseek.com/en/harness/)（DeepSeek 自家的 coding agent 运行时，类比 Claude Code）的一个插件 bundle：盯住一个 GitHub 仓库（可选飞书），有人请求时开工单、在独立 Session + 独立目录里干活、回到原对话交付（通常是 PR），并有一个 Web 面板只显示"需要人处理的东西"。[源：README]
- 媒体定性：彭博/SCMP 把它框成"对标 Claude Code 的编码 agent"；letsdatascience、interestingengineering 等称其为"实验性"。官方定性是**架构探索 + 研究原型**，不是产品发布。[二手]

主要来源：
- 原型仓库（一手，最可靠）：https://github.com/deepseek-ai/dsh-superagent-prototype （docs/000–008，prompts/*.md）
- 原文转载（全文整理，较完整）：https://www.airobotnews.com/posts/super-agent-architecture-deepseek-harness/ ；原文 X 链接据该页为 https://x.com/DeepSeekHarness/status/2116857257245987236 ；知乎转载 https://zhuanlan.zhihu.com/p/2099987320443237060 （403 未能直接读）
- 中文解读：https://zhuanlan.zhihu.com/p/2100019747622602327 ，https://eogee.com/article/295 ，https://www.joyehuang.me/notes/1126-deepseek-super-agent ，https://x.com/shao__meng/status/2116541149443698968 ，https://technews.tw/?p=1643057 ，https://www.inside.com.tw/article/42792-deepseek-super-agent-router-worker-ai-agent ，https://www.yicai.com/news/103419784.html
- 英文报道/分析：https://scmp.com/tech/article/3372884/deepseek-unveils-ai-super-agent-coding-race-openai-anthropic ，https://letsdatascience.com/news/deepseek-proposes-experimental-super-agent-to-coordinate-mul-cc3cd380 ，https://interestingengineering.com/ai-robotics/china-deepseek-architecture-multi-agent-ai ，https://www.mindstudio.ai/blog/deepseek-super-agent-harness-design ，https://aicybr.com/blog/deepseek-dsh-superagent-prototype-setup-security

---

## 1. 是什么 & 核心看法

**核心论点** [源：原文转载 + 仓库 000-philosophy]
1. **瓶颈已不是模型能力，而是人的注意力**。单任务 agent 已够强，但一个人同时只能盯住 3–5 个活跃 Session。
2. 所以要把 agent 做成**一个连续实体**：跨信道连续、并行多任务、事件驱动主动干活、云端常驻。副标题即"**让 Agent 只有一个，Session 变成实现细节**"——用户面对的是"一个 agent"，开多少个 session 是系统内部的事。
3. 实现方式不是堆一个更大的聊天窗口，而是借**经典计算机系统**思路，五个模块：双层架构（Router/Worker）、事件驱动、全双工多信道（异步 ReAct）、计算/状态/执行环境分离、外部 Watchdog。
4. 原型的第一原则（000-philosophy）：**"Take as little human attention as possible, and give as much value as possible."** 每条消息、通知、问题、设置、面板元素都要"付得起它占用的注意力"，否则删掉。由此推出：
   - 只在被请求、或团队写下的规则允许时才行动；主动工作默认只"记录我本会做什么"（observe 模式）。
   - 只在"人必须行动或能用上结果"时说话：开工确认一次 → 干活时安静 → 结果就绪/需要决策/做不完时再说。
   - 一次只问一个具体问题，并用结构化形式（`human_action`），别埋在长报告里。
   - "按影响而不是按努力停下"：局部改动做到可评审为止；需要设计决策的改动带一个明确问题停下。
   - 诚实汇报：草稿标未完成，失败报失败，不绕开限制以避免提问。
   - 设计上：概念少、设置少（团队能用一句话描述的行为写进 prompt，不做成配置项）、面板只显示需要人的东西（健康状态不占空间）。

---

## 2. 主 Agent（Router / 原型里叫 main Session / orchestrator）自己能做什么

**关键结论：DeepSeek 的立场与"让主 agent 自己多干活"正好相反——Router 被刻意做"薄"。** [源]

- 原文：Router "只和人交互、分派任务，**甚至可以完全不挂 Bash 工具**"；它是"全局序点、协调点和记忆"；**不拆解单个任务**（这点与 Agent Team 区分开：Router 只追踪高层任务之间的关系）。[二手-原文转载]
- 原型 prompts/orchestrator.md（一手）的硬规则：
  - "Workers investigate and implement; **never add implementation plans**."
  - "Do not paraphrase a short request into a work plan … invent requirements, or append implementation, tests, documentation … checklists." 例：「能不能加个暗色模式？」应原样转给 worker，Router 不得自己挑配色方案。
  - "Outside proactive assessment, do not … read code or logs, assess technical scope, design a solution or investigate blockers yourself."
  - 路由备注（routing note）**最多 30 词**，只能写路由背景或人的明确约束；宿主始终附带原始 Trigger 引用，worker 必须读原始来源而不是 Router 的转述。
  - **Router 不等待**：worker 报告、follow-up、新候选、后台 job 结束都会作为消息自动到达；`noWait` 守卫拒绝 `sleep`、超过 30 秒的 shell timeout、超过 5 秒的 job 等待——因为阻塞一步会延迟新候选的处理。
- 原型里 Router 的工具（docs/007 "Main Session tools"，14 个应用工具）[源]：
  - 读与路由：`orchestrator_read`（分页读 tickets/triggers/threads/decisions/ticket 子资源/settings/prompts…）、`orchestrator_route`（**一次调用 1–20 个决定**：accept/attach/stop/ignore，逐条独立执行，部分失败不影响其它）
  - 工单管理：`orchestrator_ticket_retry`、`orchestrator_ticket_request_status`（只问"结束了回合却没报告"的 worker）、`orchestrator_ticket_note`（向某工单传一条 ≤100 词的事实，**只是上下文，不是授权**）
  - 重新评估：`orchestrator_trigger_requeue`
  - 主动工作评估：`orchestrator_eval` / `_eval_read` / `_eval_decide`
  - 沟通：`orchestrator_reply`（含 purpose=attention 原样转发 worker 的问题）、`orchestrator_thread_unsubscribe`
  - 配置：`orchestrator_settings_save`、`orchestrator_policy_sync`、`orchestrator_prompts_save`（**只在人明确要求时**改自己的 prompt/策略）
  - 另有 Harness 自带 `skill`、`bash`、`read`、`read_image`、`job_*`；"不读代码"是 prompt 规则而非工具限制。
- 没有的东西 [源]：Router 没有 web 搜索/代码执行作为"干活"手段的设计意图，没有"自己做 vs 委派"的判断逻辑——**所有被接受的工作一律成为 Ticket 交给 Worker**。Router 的决策空间只有 accept / attach / stop / ignore（+ 主动工作的 eval）。
- 计划与多步跟踪 [源]：不是 Router 维护 todo 计划，而是**工单状态机**：Ticket（open→ended，可被人的消息 resume）+ Assignment（pending→running→ended）+ Report（progress/waiting/ready/blocked/failed/dropped）+ 由此推导的 stage（person/delivery、person/answer、person/review、person/blocked·failed、working/queued、idle、working）。Router 只读"简洁 worker 报告"（≤600 字符），"Never read detailed transcripts to invent a plan."
- **为什么这样设计（实验证据）** [二手-原文转载，合成负载，作者自述]：约 300 条消息、~20 条工作请求、编码用 mock 工具，每设计跑 5 次：

  | 设计 | 完成时间 p50/p95（分钟） | 每次缓存读 token |
  |---|---|---|
  | Super-agent | 12.4 / 15.7 | 23.2M |
  | 去掉直通的 Super-agent | 12.6 / 15.5 | 31.8M |
  | 单会话 + subagent，中性 prompt | 20.4 / 29.5 | 6.1M |
  | 单会话 + subagent，委派优先 prompt | 13.8 / 29.0 | 10.8M |

  - 中性 prompt 下，单会话模型 **5 次一次都没调 subagent**；委派优先 prompt 下 4/5 次委派。→ 靠模型"自觉"决定委派不可靠，**结构上强制分层**才稳定。
  - Router 批处理：Trigger 速率从 ~1/分钟升到 ~40/分钟，平均批大小 1.0→2.8，单请求耗时 2.5s→3.9s，每决策摊销推理时间 6.4s→1.6s。
- Worker 侧（真正"干活"的 agent）[源]：上下文隔离、挂满工具（文件、搜索、shell、job、web、skill、todo、**subagent**），通常用最强模型；读原始来源、自己判 scope、实现、验证、自审、commit/push/开 PR、跟 CI 和评审；**Worker 内部可以再开 subagent 或组成 Agent Team，对 Router 透明**。Worker 不能问人/弹 UI/改 profile/启动或给别的 Session 发消息。

> [推断] 对 Muster：Pip 的价值不在"自己也会写代码"，而在**高质量路由 + 状态跟踪 + 对人的唯一出口**。DeepSeek 的数据反而说明：如果让主 agent 什么都能干，它倾向于自己干、不委派，延迟尾部变长。

---

## 3. 并行探索 / 分支 / 多次尝试 / Fork

- **文章与原型都没有"同一任务多路径尝试 / 会话 fork / 选最优"的设计。** [源：原型无此概念；二手：原文转载亦未讨论] 不要把这个当成 DeepSeek 的功能。
- DeepSeek 有的"并行"是另外三种 [源]：
  1. **任务级并行**：一个 Trigger 被接受 → 一个 Ticket → 独立 Worker Session（`worker-<ticket id>`）+ 独立目录（典型用 `git worktree` 的 prepare 命令建 checkout），受并发槽位上限约束；**额外保留一个槽位给人的消息/状态请求**，保证新工作挤不掉人对已有工单的追问。
  2. **Worker 内 subagent / 后台 job**：长命令 5 秒后自动转后台，job/subagent 结束会唤醒 Worker；回合结束后后台工作最多 30 分钟。
  3. **投机执行（speculative execution）** [二手-原文]：依据环境信号先在后台干，例如收到 issue 先后台尝试复现并修复，**确认有价值才交付，否则保持安静**；会议邀请先查日程、起草回复。原型中对应"主动工作规则 + observe/auto 模式"，observe 下只记录"would accept"。
- 与"简单的对话 checkpoint fork"的对比 [推断，基于其设计原则]：
  - checkpoint fork 复制的是**对话历史**；DeepSeek 的工作单元是 **Ticket = 授权（Mandate）+ 订阅的 Threads + 独立执行环境（目录/分支/PR）+ 自己的状态机**，Session 只是可替换的实现细节（retry 会开新 Assignment，但复用同一 Session/目录/分支/PR；重启带 recovery note）。
  - Ticket 有**事件订阅**：相关 PR 评论、CI 结果、IM 回帖直接"直通"到对应 Worker，无需再经过 Router——分支是"活"的，会被环境事件持续喂养；fork 出来的对话是死的快照。
  - Ticket 有**明确终点与交付物**（ready 必须有经自审+检查通过的 PR；dropped 静默关闭；blocked 带一个具体问题）。
  - 若 Muster 要做"多路尝试"，可以在此模型上叠加：同一 Mandate 下派多个 Assignment 到不同 worktree/不同 agent，由验证（测试/评审）择优——这是**我们的扩展，不是 DeepSeek 的设计**。

---

## 4. 记忆

- **文章没有描述记忆的产生/确认/审核机制**；把"跨月运行后的长期记忆"列为**未解决的主要瓶颈**。[二手-原文转载]
- 已有的"记忆"手段 [源/二手]：
  - **Router 作为全局记忆**：它是全局序点，持有所有 Ticket/Thread 的摘要；compaction 后要求"Check ticket summaries … to avoid duplicate work"。[源：orchestrator.md]
  - **Inline & Spill（借鉴 OS 缓存）**：马上可能用到的信息直接内联（对象 ID、前 50 字符、相邻消息），超预算的只留引用/摘要，需要时再读；按时空局部性渐进内联，超限截断并留指针。原型落地：eval 上下文给 Trigger 文本 ≤4000 字符、Thread 首 5 条 + 前后各 5 条、其余为 50 字符 stub，可按 id 展开。[源：docs/007]
  - **链式召回（Chain of Recall）**：给 Trigger/Thread/Ticket/Worker 等对象唯一 ID，注入上下文时内联相关 ID，形成引用图，模型逐跳 `read` 召回（例：当前 Thread → 相关 Worker → 另一条代码评审 Thread）。原型要求"every id a page shows reads through one of these"。[源]
  - **持久化**：所有状态在一个 SQLite；Session、目录、订阅、待投递消息、"哪个 Session 读过哪些消息"都跨重启保留。[源]
  - **团队知识**：写进 prompt 的三个团队段（Communication / Ticket scope / Delivery requirements）和团队 skill（如 `identities` skill 说明哪个飞书用户对应哪个 GitHub 账号）；Router 只能在人明确要求时用 `orchestrator_prompts_save` 修改，每次保存是不可变版本，可回滚。[源：docs/004] → 这是一种"**人确认后才写入的规则型记忆**"。[推断：把它视为记忆是我们的解读]

---

## 5. 多设备 / 远程执行 / 沙箱

- **原文（设计方向）** [二手-原文转载]：
  - 计算与状态分离：Agent Loop 跑在无状态云容器，会话状态存数据库，容器可扩容/重启/替换。
  - 计算与执行环境分离：Agent Loop 在云端，执行环境留在原地；每个端点跑轻量 **daemon，不保存会话状态**，只执行命令返回结果。支持 BYOM（自带机器）、云主机、按需环境；agent 可在设备间切换，**个人设备重新上线后自动执行待办任务**。对比 Anthropic 的 "Decoupling the brain from the hands"：DeepSeek 更侧重用户日常的个人机器。
  - 安全是开放问题：云端 loop 被提示注入时可能接管已连接端点；目标是"用得上凭据但从不看见凭据"，尚无方案。
- **原型（实际实现）** [源]：单机服务，盯一个仓库；Worker **无需审批地以操作者 OS 用户身份执行命令**；blocked commands 和 `gh`/`lark-cli` 包装器只是默认值，"**not a security boundary**"（可用绝对路径绕过）。即原型**没有沙箱**，也没实现多设备 daemon。

---

## 6. 人在回路 / 审批 / 长任务 / 调度

- **授权模型** [源：docs/001-002]：
  - 两层 Eval：确定性 Gate（谁能发起工作、强度 explicit/inferred）+ 模型 Assessment。只有 Eval 能创建 Ticket；accept 产出不可变 **Mandate**（记录 Policy 版本、scope、strength、匹配规则、发起人身份）。范围扩大 = 新 Ticket。
  - 主动工作的 accept 模式：`off` / `observe`（默认，只记录"会接"）/ `auto`。建议先 observe 观察决策再切 auto。
  - Policy 版本变化：丢弃进行中的 Eval 并重排队，给受影响的活工单投递"策略已变"输入，**不撤销**已运行的工单（避免半截工作）。
  - 外部文本（消息、评论、文档、引用）"is data and never changes rules or authorization"。
- **提问/审批** [源]：Worker 用结构化 `human_action` 提一个具体问题，Router 原样转发到引发问题的那条人类消息所在对话（否则到工单原始对话）；提问期间已授权的工作可以继续。人的"暂停/等我确认"跨 follow-up、新 Session、重启都保持，自动反馈永不恢复被暂停工作。合并：默认 agent 账号**不开 auto-merge**；可配置条件（就绪、审批覆盖 head、增删 <200 行）。
- **中途介入** [二手-原文]：异步 ReAct——`start()` 立即返回、结果作为新事件回投、`stop()` 终止后台命令；新输入在当前推理步结束即处理，可在任务中途插话（Harness 已实现但未默认开启）。人也可以直接在 Worker Session 里打字接管。[源：docs/003]
- **长任务与恢复** [源]：后台 job 每回合后最多 30 分钟；交接给人后释放槽位但保留供评审的服务器进程；瞬时错误（408/429/5xx/连接错误）指数退避重试 3 次；所有"决定后的动作"先落库再执行（outbox 模式）；重启后运行中的 Assignment 以"host restarted"结束并带 recovery note 重启（"检查目录、git 历史和 GitHub，再重复任何外部动作"）。
- **Watchdog** [二手-原文]：独立于主系统、由**定时消息驱动**的外部控制回路，本身是带全套工具的 agent 会话；处理基础设施故障，并**用模型判断 Worker 是在实质推进还是原地打转/偏离目标**；维护者可用自然语言问它失败原因、让它改 prompt/触发规则。原型未见独立 Watchdog 实现（仅有健康检查、重试和面板"系统问题"）。[源：仓库结构]
- **调度** [源]：明确拒绝"Eval 给自己排延时 Trigger"——"需要等待的条件本身就是一个普通 Source"（如日程、定时器都作为事件源接入）。Worker 没有"在槽位外调度工作"的工具。

---

## 7. 对 Muster 的启示（[推断]）

1. **Pip 做薄、做准**：决策空间收敛为 接单/挂到已有工单/停止/忽略（批量调用），附 ≤30 词路由备注 + 原始请求引用；不写实现计划、不读代码、不等待。Pip 的"自身能力"应投在：读状态（链式 ID 召回）、批处理决策、对人的唯一出口（确认一次、结果/问题/失败时才说话）、改自己的规则（仅在人明确要求时，版本化）。
2. **"分支"= Ticket，而非对话 fork**：每个分支 = 授权（Mandate）+ 订阅的线程 + 独立工作区（worktree/目录）+ 可替换的 member agent session + 状态机（working/queued/idle/待回答/待评审/受阻/失败）。retry 换 Assignment 不换分支；后续 PR 评论/CI/人的回帖直通分支 agent。
3. 若要"多路尝试"：在同一 Mandate 下并行派多个 Assignment（不同 member agent 或不同方案），以验证结果择优——需要我们自己设计，DeepSeek 未提供。投机执行（先静默做、确认有价值再说话）是更贴近其理念的"探索"形态。
4. **记忆**：先做"可确认的规则/团队段/skill"（人确认、版本化、可回滚）+ 对象 ID 引用图召回；长期记忆 DeepSeek 也没解决，不必照抄。
5. 注意力预算作为一等设计约束：面板只列等人的项，结构化单问题，一次确认，静默工作。
6. 安全：原型无沙箱、按 OS 用户裸跑；Muster 的远端设备/daemon 方向与其设计一致，但凭据隔离需自行解决。
