# 08 - UI 参考与智能体形象（grokbot 风格）资源调研

> 调研日期：2026-11-06。所有结论均标注来源与时间；无法核实的内容明确标为"未证实"。
> 源码引用基于 D:\code\xuqiu\repos 下的只读克隆（airi、ai-elements、three-vrm；assistant-ui 克隆在调研结束时仍未完成检出，其结论仅来自官方文档/二手评测）。

---

## 0. 结论速览（TL;DR）

1. **"Muse" 基本可以确定是 Meta 的 Muse**（2026-09 发布的个人 Agent，Muse Spark 模型驱动，iOS/Android/Web/WhatsApp/Mac，Windows 版已有 Microsoft Store 条目）。"grokbot" 指的是 **xAI/SpaceXAI 的 Grok Bot**（2026-08-11 beta），**不是** Grok 的 3D 伴侣（Ani/Rudi），后者已于 2026-09-01 前后被下线。
2. 这两个产品给出了同一个关键范式转变：**界面的一等公民不再是"对话"，而是"有身份、有头像、有状态的 Agent"**。头像 = 身份 + 状态指示器（Grok Bot 官方设计文章原话："The avatar now shows what the Bot is doing as well as which Bot it is"）。这与我们的"主 agent 轻量 + 有状态子 agent + 一切皆事件"哲学天然对齐。
3. **形象方案建议分三层**：L0 参数化"形状+眼睛"矢量角色系统（Grok Bot 路线，零授权风险、可无限扩展、适合子 agent 花名册）；L1 一个请专业画师买断的主 IP 吉祥物 + Rive 状态机动画；L2（可选、后置）VRM 3D/语音陪伴模式。**不建议**一开始做写实/二次元 3D 伴侣：Grok Companions 因"算力成本高、效果不稳定"被 xAI 自己砍掉，Meta 的视频生成式 Avatar 不可复现。
4. **组件库推荐栈**：shadcn/ui（含其新收编的 AI Elements 模式）+ assistant-ui（headless 聊天原语，含分支选择器）+ AG-UI/CopilotKit 协议思路（事件流）+ React Flow（分支树/子 agent 拓扑）+ Rive（头像状态机）+ three-vrm（可选 3D）。Vercel AI Elements 官方宣布 2026-11 末弃用并并入 shadcn/ui，新项目应直接从 shadcn/ui 的 AI Elements 模式起步。
5. 信息架构核心：**左侧 Agent 花名册（含状态头像）→ 中间异构时间线（消息/事件/子 agent 卡片/审批卡）→ 右侧可折叠面板（电脑/浏览器预览、Diff、终端、产物、分支树）+ 全局收件箱（事件通知中心）**。fork/steer/interrupt 在 UI 上落地为：消息级"从此处分支"、飞行中输入框的"插话"、分支选择器与分支树视图。

---

## 1. "Muse" 与 "grokbot" 到底指什么

### 1.1 Muse 候选与判断

| 候选 | 是什么 | 证据与时间 | 判断 |
|---|---|---|---|
| **Meta Muse（个人 Agent 应用）** | Meta Superintelligence Labs 的消费级个人 Agent；有自己的云端 Secure VM（Linux+完整浏览器）、主聊天+侧聊天、Feed/Ideas/Goals/Library 五个标签、审批卡、Artifacts、可自定义头像 | muse.ai 官网；introducing.muse.ai《How We Designed Muse》(2026-09)；TechCrunch 2026-09-18（Mac 版）；TechCrunch 2026-11-05（语音/视频头像）；36kr 2026-11-01（上线不到两个月累计 1040 万下载） | **最可能（约 90%+）**。用户说"近期很火的个人 agent 项目，类似 muse"完全吻合 |
| Muse Spark / Muse Wonder / Muse Glimmer | Meta 的模型家族（Spark 为 agentic 模型，另有开源权重版） | musebot.in 2026-10-05；musemuse.dev/models | 不是产品，是 Muse 背后的模型 |
| Muse Code | Meta 的编程 CLI | mausbot.com 博客 2026-10-08 提及（二手） | 与本课题相关度低，但值得后续对标 |
| OpenMuse（CopilotKit）、nanoMuse、MausBot、chyroc/open-muse 等 | 开源"山寨/致敬"项目。CopilotKit OpenMuse：Expo 移动端 + Hono API，MIT 但依赖其托管的 Intelligence 服务；nanoMuse：GPL-3.0，五端安装包；MausBot：Apache-2.0，多 bot 桌面聊天应用，驱动本机 claude/codex/grok CLI | mausbot.com/blog/openmuse-vs-mausbot（2026-10-08，竞品自述，需谨慎看待） | 可作为"开源对标物"研究，**MausBot 的形态（每个联系人是一个 bot，底层是本机 CLI agent）与我们的"桌面连接 Claude Code/Codex 当子 agent"高度同构** |
| 中国市场"中国版 Muse"（Today AI、Manus Cue、LiDan 等） | 追随者 | 36kr 2026-11-01 | 仅作市场背景 |

注意：Meta Muse 当前仅限美国/加拿大、18+（research.meta.ai 与 TNW 说明）。Mausbot 博客称 Nat Friedman 向 TechCrunch 说 Muse "heavily inspired as a product by OpenClaw"，连工作区文件名（SOUL.md、MEMORY.md）都很像——**该说法为二手转述，未证实**；但 Muse 的 SOUL.md/MEMORY.md 本身有 SmartScope 评测（2026-10-25）佐证。

### 1.2 "grokbot" 的真正含义

| 名称 | 说明 | 状态 | 来源 |
|---|---|---|---|
| **Grok Bot**（xAI，现品牌 SpaceXAI/SpaceXSI） | 持久化"AI 队友"：每个 Bot 有名字、头像、职位、记忆；共享一台云端电脑（浏览器+文件系统+终端）；可相互发消息、群聊、交接任务；macOS/Windows/Linux/iOS/Android | 2026-08-11 beta；2026-09-28 增加 Team Bots | docs.x.ai/grok-bot/overview；x.ai/news/designing-grok-bot（2026-09-03）；Interesting Engineering 2026-08-11 |
| **Grok Companions**（Ani、Rudi/Bad Rudi、Valentine、Mika） | iOS 端的 3D 动画语音伴侣，2025-07 上线，含 NSFW 争议 | **2026-07-24 宣布退役，约 2026-09-01 下线**；角色迁至 Animation Inc 的独立 18+ 应用 Animates | Eliza Report、Layer3 Labs、Aadhunik（均二手，xAI 官方声明经 @grok 回复转引）；官方未发布独立声明 |

xAI 官方转述的退役理由："heavy third-party tech with high compute costs and inconsistent results"（Eliza Report 引用 @grok 2026-07-28 回复，二手）。**这是对本项目的重要警示：写实/重 3D 的伴侣形象是高成本高风险路线；而 Grok Bot 的"纯形状+眼睛"路线活得好好的。**

用户说的"类似 grokbot 的有趣机器人形象"应指 **Grok Bot 的形状头像系统**（也可兼指 Rudi 红熊猫那种有趣吉祥物）。本报告两者都覆盖，但主推前者。

---

## 2. 竞品界面深度拆解

### 2.1 Meta Muse（桌面/移动）

来源：introducing.muse.ai（2026-09）、官方 walk-through 视频字幕、SmartScope 屏幕指南（2026-10-25）、Spyglass（2026-09-16）、metamuseai.site 测试（2026-10-03）、Android Authority（2026-10-06）。

**信息架构**
- 左侧（Web）：Chat、Search、Feed、Ideas、Goals、Library 六个图标；下方是聊天列表：**Main chat**（一条永续主对话）、Channels（如 WhatsApp）、**Side chats**（"+" 新建，用于项目隔离）。移动端五个标签可长按重排。
- 顶部：Agent 头像 + 头像下方一行"正在做什么"的实时片段（官方文章原话："under the Avatar, you'll see a snippet of what it's working on"）。点击头像 → "Muse is working" 面板：完整活动日志、已批准的权限、**Soul（SOUL.md）与 Memory（MEMORY.md）**两张卡，可直接编辑；Memory 每晚整理一次。
- **Feed**：个性化信息流，每条带点赞/点踩/"Discuss"（一键转成聊天），顶部有自然语言输入框调教信息流。
- **Ideas**：基于对话与已连接数据的"你可以让我做…"建议，解决"空白页问题"。
- **Goals**：长期任务/目标，7 类（健康/关系/财务/职业/兴趣/效率/其他），显示轻量状态、完整时间线。
- **Library**：Artifacts（文档、PDF、交互式仪表盘）与 Media。

**交互设计原则（官方文章可直接借鉴）**
1. 聊天气泡：主动消息会乱序到达，扁平 transcript 不可读，气泡标示"一个想法在哪里结束"。
2. **主动消息的门槛要高**：后台工作完成后先评估"值不值得打扰"，只在"有实质新内容或需要你输入"时通知。
3. **确定性控件不可替代**：结构化审批卡（明确 accept/reject）与凭据保险库。避免"横幅盲区"——默认放行普通浏览，只对**难以撤销**的动作拦截，且可调松紧。
4. 随时插话：可打断、可连发多个任务而不必等上一个完成。
5. 头像与人格是核心功能："对着公司 logo 聊天很怪"，创建/命名/定制头像是用户最喜欢的特性之一。默认吉祥物被 Android Authority 形容为"Teletubby 与 Labubu 的混合体"，用户可换（该评测者换成橙色猫，打字时会"敲笔记本"——即头像带**任务态动画**）。TechCrunch（2026-11-05）称其动画头像昵称 "Jolly"。
6. 语音/视频：2026-09-23 Connect 发布 **Muse Realtime Avatar**（扩散 Transformer，音频 token 驱动，448x768@25fps，端到端首字节约 870ms，Meta Video Seal 水印；单张 GB200 并发 12 路，research.meta.ai 2026-09-23）。2026-11-05 对美国全量开放。**这是服务端视频生成，个人项目不可复现**，只能借鉴交互（语音/头像并排/全屏三档显示）。

### 2.2 Grok Bot（最贴近我们哲学的一个）

来源：x.ai/news/designing-grok-bot（2026-09-03，官方设计文章，本节要点均出自此文）；docs.x.ai/grok-bot/bots、settings-and-notifications。

- **五个原语**：Bots（持久 agent，有身份/记忆/运行时/工具）、Chats、Prompts（一次性 → Skills → Routines 定时/触发）、Tools、Artifacts。"其余一切沉到界面之下，直到用户有理由关心"。
- **花名册替代聊天历史**：侧边栏是 Bot 列表（头像+名字+最近一句话+时间），可 pin、分 section（按项目/客户）、隐藏、复制（复制角色但不含记忆）。Cmd/Ctrl+N 新建 Bot：输入名字、选**形状和颜色**。
- **Presence 三问**：谁（头像可周边视觉识别）？在做什么（头像动作承载状态）？我需要知道多少（悬停看当前动作）？
- **头像系统**：官方探索过首字母、emoji、像素、水彩、黏土、Noritake 线稿、剪影、identicon；结论："水彩/黏土个性强但在侧边栏尺度细节过多；简单系统自然融入但千人一面" → 最终方案："**保持基本构造一致（简单形状 + 富表现力的眼睛），再通过受控变体与配饰产生区分**"。
- **状态集**：idle、thinking、working、waiting、blocked、done（官方）。动作语义："静止时平静且略带好奇；任务到达时确认；开工时进入状态；等待/求助时动作改变；完成后沉静"。
- **执行可见性分三级**（不要让用户被拉去"操作"Agent）：Status（标题栏图标变紫表示电脑在跑）→ Preview（固定侧栏，边聊边看）→ Takeover（全屏接管，再交还）。他们尝试过悬浮窗/并排/模态/全屏四种，结论是"越突出就越鼓励用户盯着监督"。
- **异构 transcript**：对话、系统事件（"创建了 Routine"）、交互对象（带"发送/丢弃"的邮件卡片）、可视化共用同一条时间线；Bot 之间互发消息的事件也出现在 transcript 里（"6 messages with Kenny, Tyler and Jenny"）。
- 侧边栏**三种注意力状态**（settings-and-notifications）：Needs attention（问题/审批/交接）、Unread activity（新结果）、Working/typing。
- 更多细节：头像可 "Bot"（形状）/ "Generate"（文生图）/ "Upload"（<25MB）三种来源；最多 50 个 bot+群聊；群聊内 @ 拉人；"chief of staff bot" 可管理其他 bot（i-scoop 2026-09-07，二手）。
- 第三方粉丝站 grokbotexplained.app/avatar-system 声称"8 形状（Circle/Pebble/Squircle/Capsule/Triangle/Hexagon/Cloud/Droplet）/12 颜色/16 表情/15 动画态（含 Idle/Thinking/Orbit/Notification/Swirl 等），回退渲染器沿身体轮廓采样 64 点并把两只眼睛投影到表面"——**该站为非官方，具体数量未证实**；Mascot Atlas（atlas.mascotti.studio，同样非官方）的描述一致：纯色形状+两条白色小斜杠状眼睛，"眼睛即状态显示器：等待时变平，完成时出现环绕圈"。

### 2.3 OpenAI Codex app / Cursor 3 / 并行 Agent 管理器

- **Codex app**（macOS，2026-02-02，openai.com/index/introducing-the-codex-app/）：左栏 Projects → Threads → Automations；中栏对话流 + 输入框下方的 **Local / Worktree / Cloud** 模式、模型、权限选择；右栏 Review（可点击行评论、按 hunk stage/revert、范围可切 uncommitted/全分支/最近一轮）、集成终端、预览。Hand off 在 Local 与 Worktree 间转移。以上细节来自教程站 coding.flowo.design 与 developertoolkit.ai（二手，但与官方描述一致）。
- **Cursor 3 Agents Window**（2026-04-02 GA，cursor.com/docs/agent/agents-window、changelog 3-0）：侧栏统一管理跨仓库/本地/worktree/云/SSH 的并行 agent；`/best-of-n`（多模型各自 worktree 比结果）、`/multitask`、cloud subagent、Design Mode（在浏览器里圈选元素喂给 agent）；Agent Tabs 可并排/网格查看多个聊天。
- **管理器类产品**（Nimbalyst 对比文 2026-06-01，二手）：Vibe Kanban（看板，Apache-2.0；Bloop 2026-04-10 宣布关停，社区维护）、Conductor（Mac，侧栏+diff，Pro $50/月）、Claude Squad（tmux TUI, AGPL）、Superset、Sculptor、Mux（AGPL）、Opcode（AGPL）。**注意 AGPL 项目不可直接复用到闭源产品**。
- 对本项目的启示：编程类子 agent 需要 **worktree 隔离 + diff 评审 + 一键 PR** 三件套；这是"桌面连接 Claude Code/Codex"的标准 UI 配置。

### 2.4 Manus / Devin / Linear

- **Manus "Manus's Computer"**：底部 dock（缩略图 ~60x45 实时更新、状态点、计时、步骤计数 1/3）→ 展开面板（App 选择器 Browser/VS Code、任务进度）→ 全屏视图（真实页面）；**时间轴回放控件**（跳起点/播放/可拖拽 scrubber/Live 指示/Jump to live）；会话可回放、可分享；用户可随时接管（MIT Technology Review 2025-03-11；WorkOS 博客；gist 记录的设计细节为社区逆向，非官方）。
- **Devin 2.x**：Progress/Shell/Browser/Editor 标签 + 交互式 timelapse + 阶段分解 DAG（beyondchat.design 的 Stage Tracker 模式页，二手）。
- **Linear Agent Interaction Guidelines**（linear.app/developers/aig，官方）：六条原则——始终声明自己是 agent；原生融入平台；即时反馈；**清晰透明的内部状态**；尊重"退出"请求；agent 不承担责任。**AgentSession 六态：pending / active / error / awaitingInput / complete / stale**；AgentActivity 五类：thought / elicitation / action / response / error；"delegate"（委派）与"assignee"（责任人）分离——"issues can only be assigned to humans, and only delegated to agents"。收到 created 事件须 10 秒内发出 thought 以示响应。
- **Claude / ChatGPT 桌面端**：本次**未做源级深入调研**（仅在 Vellum 对比文中看到 Claude Cowork、ChatGPT Work 等名称），不据此下结论。建议后续补一轮截图级体验调研。

### 2.5 横向对照：状态词汇表（我们的设计应统一映射）

| 本项目建议状态 | Grok Bot | Linear Session | AI Elements Persona | AIRI Emotion |
|---|---|---|---|---|
| idle（空闲） | idle | stale/complete 后 | idle | neutral |
| listening（用户在输入/语音） | - | - | listening | curious |
| thinking（推理中） | thinking | active | thinking | think |
| working（工具/子任务执行中） | working | active | -（可映射 speaking 之外自定义） | -|
| waiting（等待审批/输入） | waiting | awaitingInput | - | question |
| blocked/error（失败/卡住） | blocked | error | - | sad / awkward |
| done（完成） | done | complete | - | happy |
| asleep/offline（休眠/设备离线） | - | - | asleep | - |

---

## 3. 信息架构建议（面向本项目）

### 3.1 对象模型（UI 层的"名词"）

直接借鉴 Grok Bot 五原语，并叠加我们的 SuperAgent 哲学：

| 对象 | UI 呈现 | 与事件模型的关系 |
|---|---|---|
| **Agent**（主 agent 与有状态子 agent，含外部 Claude Code/Codex 适配的子 agent） | 花名册条目：头像+名字+职位标签+一行实时状态 | 每个 Agent 是事件的消费者/生产者；头像状态由其事件流派生 |
| **Thread / Branch** | 时间线；分支以"分支选择器"+"分支树"呈现 | fork = 从某事件游标分叉出新 Thread |
| **Event** | 收件箱条目 + 时间线中的系统行 | 用户输入、定时触发、GitHub PR、子 agent 回调统一为事件 |
| **Task/Goal** | Goals 视图（Muse 式）：长期目标+计划+时间线 | 由事件驱动推进 |
| **Artifact** | Library：文档/代码/仪表盘/Diff/截图 | 事件的产出 |
| **Machine / Browser** | "设备"页：在线状态、远程浏览器会话、可接管 | 设备上下线本身是事件 |
| **Routine/Trigger** | 触发器页：cron、GitHub webhook、文件监听 | 触发即产生事件 |

### 3.2 桌面端布局（三栏 + 全局层）

```
┌─────────────┬───────────────────────────────┬──────────────────────┐
│ 左：花名册    │ 中：异构时间线                   │ 右：上下文面板（可折叠） │
│  主Agent(置顶)│  消息气泡 / 系统事件行 /          │  Tabs：              │
│  ├子agent A  │  子agent 卡片(可展开) /          │   Computer(三级)     │
│  ├子agent B  │  审批卡 / 内联组件 / 产物卡        │   Diff Review       │
│  └外部:Claude │  Checkpoint(可从此处分支)         │   Terminal          │
│    Code, Codex│  底部：输入框 + Steer/Interrupt │   Artifacts          │
│ 分组/Pin/隐藏  │  + 顶部头像下"当前动作"一行       │   Branch Tree        │
│ ─────────── │                               │   Activity Log       │
│ 导航：Inbox   │                               │                      │
│ Goals Library│                               │                      │
│ Triggers 设备 │                               │                      │
└─────────────┴───────────────────────────────┴──────────────────────┘
全局：命令面板(Cmd/Ctrl+K)、通知中心(Inbox)、菜单栏/托盘常驻、可选桌面悬浮宠物
```

关键设计决策与出处：
1. **花名册优先于会话列表**（Grok Bot）；同时保留 Muse 式"一条永续主对话 + 侧聊天"，对应我们的"主 agent 主线 + 分支"。
2. **三级电脑可见性**：Status（图标/头像上的指示）→ Preview（右侧固定面板）→ Takeover（全屏接管并交还），不默认并排以免诱导用户盯屏（Grok Bot 设计结论）。远程浏览器/多台电脑沿用同一模型，每台设备一个"屏幕"。
3. **Review 面板**对编程子 agent 必备（Codex app 模式）：行级评论、hunk 级 stage/revert、范围切换。
4. **时间线是回放源**：事件溯源天然支持 Manus 式 scrubber 回放（Jump to live）。

### 3.3 fork / steer / interrupt 的 UI 落地

| 能力 | UI 落点 | 可参考实现 |
|---|---|---|
| **Fork（从某点分支）** | 每条消息/Checkpoint 悬停出现"从此处分支"；分支后在时间线上出现分支标记；分支选择器（< 1/3 >）切换同一节点的多个分支；右侧"分支树"视图 | AI Elements `checkpoint.tsx`（"A point in the conversation you can return to"）；assistant-ui 的 BranchPicker 原语（见官方文档 primitives 列表，二手评测：aparté 比较页列出 "branch picker"）；树/图用 React Flow |
| **Steer（插话）** | 任务运行时输入框不禁用，发送变为"插话"（作为 user.steer 事件投递给该 agent）；输入框旁显示该 agent 当前动作 | Muse："可以打断或一次发多个任务而不必等待"；Cursor `/multitask` |
| **Interrupt（中断）** | 运行中显示 Stop，区别于"暂停等待审批"；中断后 agent 进入 idle，保留状态可恢复 | Linear AIG "尊重退出请求" |
| **子 agent 回调** | 时间线内折叠卡片（含其工具调用与结果），完成/出错时头像状态变化 + 收件箱条目 | AI Elements `agent.tsx`、shadcn AI Elements 的 Subagent 模式 |
| **审批** | 确定性审批卡（Allow once / Always / Deny），按"是否难以撤销"分级 | Muse 官方文章；AI Elements `confirmation.tsx` |

### 3.4 通知中心（事件收件箱）设计

综合 Muse 与 Grok Bot：
- **三种注意力态**：Needs attention（审批/提问/交接）> Unread activity（新结果）> Working（过程，不打扰）。侧边栏 + Dock 徽标永远可见，即使系统通知被抑制（Grok Bot 文档）。
- **打扰门槛高**：后台任务完成后由主 agent 判断"是否值得打断"，否则只落入收件箱（Muse）。提供全局"主动程度"旋钮，让用户说"少打扰点"。
- **事件分类 + 来源标识**：user / schedule / github / subagent / system，每条显示来源头像；批量处理（全部已读、按 agent 过滤）。
- 避免横幅盲区：审批只对不可逆动作弹出，并按风险排序置顶。
- 收件箱条目可一键"Discuss"（转入对应线程，Muse Feed 的做法）。

---

## 4. 开源 UI 资源清单（可直接用）

| 库 | 作用 | 许可证 | 状态/备注 | 来源与核实 |
|---|---|---|---|---|
| **shadcn/ui + AI Elements 模式** | 基础组件 + agent 界面模式：Chat、Message、Prompt Input、Reasoning、Tool、Plan、Queue、Task、Subagent、Checkpoint、Confirmation、File Tree、Terminal、Test Results、Stack Trace、Context、Model Selector、Chain of Thought、Inline Citation、Sources | shadcn/ui 为 MIT（常识，本次未逐项核实）；AI Elements 源仓库 LICENSE 为 Apache-2.0（已读 repos/ai-elements/LICENSE） | **Vercel AI Elements 官网横幅宣布将于 2026-11 末弃用并并入 shadcn/ui**（teaflask 2026-10-28、aparté 比较页转述；ui.shadcn.com/docs/ai-elements 页面已含迁移表）。已复制进项目的代码不受影响；shadcn 页面指出 artifact/sandbox/web-preview/workflow-graph/voice 无对应新模式，需自行拼 | ui.shadcn.com/docs/ai-elements；repos/ai-elements/packages/elements/src/* |
| **assistant-ui** | headless 聊天原语：Thread/Composer/Message/ActionBar/BranchPicker/附件/工具 UI；运行时可接 Vercel AI SDK、LangGraph、AG-UI、A2A、OpenCode 或自有服务端；已有 Vue 预览与 React Native/终端形态 | MIT（多篇评测一致；shipgarden 2026-08 版本 0.15.8） | 可选托管 Assistant Cloud（免费 200 MAU，Pro $50/月，pastaui 2026-10-07，二手）。**自托管线程存储即可，无需 Cloud** | assistant-ui.com/docs；本地克隆未完成，源码层面未验证 |
| **CopilotKit / AG-UI 协议** | AG-UI：开放的事件式 agent→UI 协议（消息、工具调用、状态同步、人在回路）；与 MCP（工具）、A2A（agent 间）互补 | CopilotKit 核心 MIT | **AG-UI 的"事件流"理念与我们"一切皆事件"一致，建议至少参考其事件类型设计，甚至直接兼容**。注意 CopilotKit 自家 OpenMuse 需要托管 Intelligence 服务，不要被其绑定 | CodeCudos 2026-10-16、alatirok 2026-06-02、mausbot 博客 |
| **React Flow（@xyflow/react 12.12.1）** | 分支树、子 agent 拓扑图、工作流画布 | MIT；Pro 示例（自动布局、undo/redo、协同）属付费条款 | 自动布局可用开源 dagre/elkjs 自行接入；商业使用鼓励赞助 | npmjs.com/package/@xyflow/react（2026-11-02）；xyflow.com/open-source |
| **Rive 运行时**（web/React/Flutter/Unity 等） | 头像状态机动画 | **运行时、渲染器、格式均 MIT**；编辑器闭源 | 详见 §6.2 | rive.app/pricing |
| **dotLottie**（@lottiefiles/dotlottie-web 0.82.1） | 轻量 Lottie/状态机播放 | MIT | 适合小图标动画、emoji 动画；AE 工作流 | npmjs（更新于 2026-11-02） |
| **three-vrm（@pixiv/three-vrm）** | Three.js 加载/驱动 VRM 3D 模型 | MIT（已读 LICENSE，© 2019-2026 pixiv） | 表情/视线/口型 | github.com/pixiv/three-vrm |
| **TresJS / Three.js** | 声明式 3D（AIRI 采用） | MIT（常识） | - | airi presence-bubble.vue 引用 `@tresjs/core` |
| **Noto 动画 Emoji / Fluent Emoji（动画）** | 快速得到状态小图标 | Noto 动画：CC BY 4.0（需署名）；Fluent Emoji：MIT；OpenMoji：CC BY-SA 4.0（改动须同协议，慎用） | 用于通知角标/反应，非主角形象 | googlefonts.github.io/noto-emoji-files；luizbizzio/emojis 指南 |

**未纳入推荐的**：Vercel AI SDK UI 的 `useChat`（Apache-2.0）可作为传输层，但我们有自己的事件协议，只取其理念；OpenAI ChatKit 依赖 OpenAI 脚本，不适合多模型/自托管。

### 4.1 AI Elements 源码中值得直接借鉴的位置

`D:\code\xuqiu\repos\ai-elements\packages\elements\src\`：
- `persona.tsx`（306 行）：**官方 Rive 头像组件**。5 个状态 `idle | listening | thinking | speaking | asleep`；固定状态机名 `"default"`；通过 `useStateMachineInput(rive, "default", "listening"|"thinking"|"speaking"|"asleep")` 设布尔输入驱动；6 个变体（command / glint / halo / mana / obsidian / opal）；通过 Rive ViewModel 的 `color` 属性在亮/暗主题下动态染色；`.riv` 文件托管在 Vercel Blob（**这些 .riv 文件的授权条款未在仓库中找到，复用前须确认，更稳妥是自制**）。**重要工程细节**（第 15-17 行注释）：为避免 React Strict Mode 双挂载耗尽 WebGL2 上下文，延迟一帧初始化——这提醒我们花名册里放几十个 WebGL Rive 画布会触及浏览器 WebGL 上下文上限，**小尺寸头像应使用 Canvas2D 渲染或共享画布/预渲染精灵**（此为基于该注释的工程推断，需实测）。
- `agent.tsx`、`checkpoint.tsx`、`confirmation.tsx`、`plan.tsx`、`queue.tsx`、`task.tsx`、`terminal.tsx`、`test-results.tsx`、`stack-trace.tsx`、`web-preview.tsx`、`sandbox.tsx`、`canvas.tsx`/`node.tsx`/`edge.tsx`（基于 React Flow 的工作流画布）、`context.tsx`、`model-selector.tsx`。

---

## 5. 智能体形象方案

### 5.1 设计原则（来自 Grok Bot / Muse / OpenClaw / Clawd 的共同经验）

1. **头像必须在 24-32px 侧边栏尺度可辨**（Grok Bot：水彩/黏土失败原因）。
2. **身份与状态合一**：同一个角色既表明"是谁"也表明"在干嘛"，避免再加一层指示器。
3. **一套构造 + 受控变体**，才能支撑"子 agent 无限增殖"和第三方 agent 市场。
4. **要有"可被喜爱的主角"**：Muse 把头像/命名/人格化列为最受欢迎特性；OpenClaw 龙虾、Claude Code 的 Clawd 都证明吉祥物能长出社区二创（desktop pet、周边）。但 Clawd 的案例也说明：**官方设定薄弱会被社区"收养"并产生多个不一致版本**（Mascot Atlas），应一开始就出品牌手册。
5. **规避商标雷区**：OpenClaw 前身 "Clawd" 因 Anthropic 商标请求改名为 Moltbot 再改 OpenClaw（openclaw.ai/blog/introducing-openclaw，2026-01-29）。我们的吉祥物与名字要做商标检索，不要模仿 Grok Bot 的具体形状+双斜杠眼睛组合，也不要靠近 Clawd/Codex 云/Cursor 方块。
6. **避免 NSFW 伴侣路线**：Grok Companions 争议（NBC 2025-07-15）与最终下线；Muse 为 18+、Animates 为 17+/18+。我们希望应用商店审核与企业使用无障碍。
7. **无障碍**：状态不能只靠颜色（Grok Bot 用眼睛形态+动作+角标）；支持 `prefers-reduced-motion`（AIRI 的 presence-bubble.vue 使用了 `usePreferredReducedMotion`）。

### 5.2 三层方案

#### L0：参数化"形状 + 眼睛"角色系统（强烈建议 MVP 就做）

- 构成：`shape(8~12) × color(12) × eyes(16) × accessory(若干)`；由 agent ID 种子确定性生成默认值，用户可改；也允许 Generate（文生图）与 Upload。
- 状态动画：每个状态定义"眼睛形态 + 身体微动 + 角标"（见 §5.3）。
- 实现：自研 SVG/Canvas2D 渲染器（沿轮廓采样点并把眼睛投影到表面，思路同 Grok Bot 回退渲染器；非官方描述，仅作参考）；动画用 Web Animations/Motion 即可。高保真版本用 Rive 重做，两者共享同一个"状态→参数"映射层。
- 授权：完全原创，无第三方风险；成本极低（设计师 1-2 周或自己做）。
- 默认子 agent 头像兜底：**DiceBear**（代码 MIT；各风格由艺术家定授权）。CC0 风格包括 shapes、glass、thumbs、pixel-art、bottts 之外的 identicon、initials、notionists 等 42 个；CC BY 4.0 风格需署名（fun-emoji、adventurer、micah 等 14 个）；**bottts / avataaars 等 4 个属艺术家自拟"个人与商用免费"条款**（dicebear.com/licenses，已核实）。注意 DiceBear 也提供托管 HTTP API，生产环境应使用其开源库本地生成，避免依赖第三方服务。Boring Avatars 的许可证本次**未核实**（印象为 MIT），使用前请自行确认。

#### L1：专业吉祥物（品牌主角，主 agent 形象）

- 目标：一个有辨识度的主 IP（不必是人形；可用"有趣机器人/生物"），含正/侧/背三视图、≥6-12 个表情差分、标志动作，PSD/AI 分层源文件。
- 动画：交给 Rive（状态机 + ViewModel 数据绑定）或让设计师在 Rive 里直接绑骨骼；Rive 官方现在也提供 CLI 让 Claude Code/Codex/Cursor 代理生成 .riv（rive.app/pricing 页面所述，营销宣称，质量未证实）。
- 获取渠道（见 §7）：国内米画师买断 / 国际 Dribbble、Behance、Fiverr 外包 / AI 辅助出概念稿再请人精修。

#### L2：伴侣/语音模式（后置，可选）

- 2D：Live2D（效果好但授权复杂，见 §6.4）。
- 3D：**VRM + three-vrm**（MIT 运行时；模型来源 VRoid Studio 免费创作）。
- 开源参考实现：**Project AIRI**（moeru-ai/airi，MIT，约 5 万 star，2026-10-03 扫描报告），是目前最完整的开源 Grok-Companion 替代品（README 自称 "open source alternative to Grok Companion"）。
- 视频生成式（Meta 路线）：不可复现；若未来需要，可评估 HeyGen LiveAvatar / Runway Characters 等第三方（Meta 的评测把它们列为 "两个领先商业系统"，本次未调研其价格/授权，**未证实**）。

### 5.3 状态表情规范（建议直接落成设计规格）

| 状态 | 触发事件 | 眼睛 | 身体 | 角标/颜色 | 通知行为 |
|---|---|---|---|---|---|
| idle | 无活跃任务 | 缓慢眨眼，偶尔环顾（"平静且略带好奇"） | 呼吸式微动 | 无 | 无 |
| listening | 用户正在输入/语音接入 | 瞳孔放大并看向输入区 | 微前倾 | 无 | 无 |
| acknowledging | 收到新任务/事件 | 快速睁大再恢复（"确认任务"） | 点头/弹一下 | 无 | 无 |
| thinking | 推理中 | 眼睛上扬/三点轮替 | 轻微摇摆 | 三点 | 无 |
| working | 工具调用/子任务运行 | 眼睛专注；周期性"环绕光点"（长任务 orbit） | 节奏性律动 | 进度环 | 悬停显示当前动作 |
| waiting | 等待审批/用户输入 | 眼睛变圆睁大，向用户看 | 轻轻起伏求关注 | 蓝点（Needs attention） | **进入收件箱，高优先级** |
| blocked/error | 工具失败/重试耗尽 | 斜眼/八字眼 | 轻微下沉、抖动一次 | 红/橙角标（配图形，不只靠色） | 收件箱 + 可选系统通知 |
| done | 任务完成 | 弯眼微笑 + 环绕圈一次 | 小跳 | 绿勾 | Unread activity |
| asleep/offline | 设备离线/长时间无事件 | 闭眼 | 下沉缩小 | 灰色 | 无 |
| forking（我们独有） | 从某点分支 | 分身/残影一次 | 一分为二后各自就位 | 分支图标 | 无 |

实现建议：**事件→状态机用同一份规范**。UI 订阅 agent 事件流，经一个纯函数 `deriveAvatarState(events)` 得到状态，再喂给渲染器（SVG/Rive）。这样"头像=事件流的一个投影"，与 SuperAgent 的事件化哲学一致，也便于测试。

### 5.4 AIRI 源码中可借鉴之处（只读分析，MIT）

`D:\code\xuqiu\repos\airi\`：
- `packages/stage-ui/src/constants/emotions.ts`：9 种统一情绪 `happy | sad | angry | think | surprised | awkward | question | curious | neutral`，并分别映射到 Live2D 动作名（`EMOTION_EmotionMotionName_value`）、VRM 表情名（`EMOTION_VRMExpressionName_value`）、Spine 动画名（`EMOTION_SpineAnimationName_value`）。**这是"一套语义状态 → 多种渲染后端"的现成范式**，我们的"agent 状态 → SVG/Rive/VRM"映射层可按此设计。
- `packages/stage-ui-three/src/composables/vrm/expression.ts`：`useVRMEmote`，情绪混合/过渡/复位，且注释记录了"主表情权重取 0.7-0.8 防止笑得太夸张（issue #590）"；`lip-sync.ts`、`animation.ts`、`interaction.ts`、`eye-tracking.ts`。
- `packages/stage-ui-three/src/components/presence-bubble.vue`：头顶气泡（Sprite），遵循 reduced-motion。
- `packages/stage-ui/src/stores/character/`（含 `orchestrator/`、`avatar-touch.ts`）：角色编排。
- `packages/stage-ui-live2d`、`stage-ui-spine`、`stage-ui-mmd`、`stage-ui-tachie`（立绘）、`stage-ui-three`：**多形象后端分包的架构**。
- `packages/ui-timeline`、`ui-trace`、`ui-panes/workbench`：时间线/追踪/工作台面板组件（Vue），可作为"事件时间线"UI 的参考。
- `apps/stage-tamagotchi`：桌面端。**当前实现是 Electron（electron-vite、electron-builder），而 2025 年早期博文称基于 Tauri**——说明该项目已切换，引用旧资料时要注意。其"悬停淡出并穿透点击"（Fade on hover，DevLog 2025.08.05）是桌面悬浮宠物必备的交互：置顶窗口会遮挡下层，手动开关又不便，所以鼠标悬停时整窗淡出并把点击穿透给下层应用（默认快捷键 Shift+Alt+I 开关）。
- 另有 `apps/stage-pocket`（移动）、`apps/stage-web`（PWA）、`engines/stage-tamagotchi-godot`、`services/computer-use-mcp`（electron-screen-capture 等）。

---

## 6. 技术选型对比

### 6.1 形象技术总表

| 方案 | 适合 | 表情随状态变化 | 许可证/成本 | 风险 | 评级 |
|---|---|---|---|---|---|
| 自研 SVG/Canvas 参数化 | L0 花名册 | 代码驱动，任意 | 0 | 美术上限取决于设计 | **强烈推荐** |
| **Rive** | L0 高保真 / L1 主角 | **状态机 + 数据绑定，原生强项** | 运行时 MIT；编辑器免费但免费版导出带 Rive 启动画面；Cadet 付费去除（官网价 $9/seat/月，另一页文档写 $17/月、年付 $108/seat——两处不一致，以官方定价页为准并复核）；>1000 万美元营收的公司须 Enterprise（$1,440/seat/年）| 编辑器闭源；`.riv` 导出在付费墙后（2025-10-20 起，官方博客） | **推荐** |
| Lottie / dotLottie | 小图标、emoji 级动画 | dotLottie 已有状态机（点击/悬停/滚动），但能力弱于 Rive | 播放器 MIT；Lottie 公共动画 Simple License 可商用；**LottieFiles 服务本身 Starter/Individual 套餐不得商用，需 Team（$24.99/用户/月年付）**（2026-10-29 官方商用政策页）| 在 LottieFiles 平台上编辑商业动画须 Team 套餐 | 辅助 |
| Spline 3D | 营销页 3D、轻量交互 | 有事件/变量 | Free 导出带水印；Pro $25/seat/月（年付）；**2026-10-29 生效的新条款允许 Spline 用去标识化内容与 AI 交互数据训练模型，并追溯到旧内容**（respawnstack 2026-11 引述）| 数据条款、锁定 | 不推荐用于核心形象 |
| **VRM + three-vrm** | L2 3D 伴侣 | 表情/口型/视线 | 运行时 MIT；VRoid Studio 免费；模型授权看各自 VRM 元数据 | 见下方 VRoid 条款 | 可选 |
| **Live2D Cubism** | L2 2D 立绘伴侣 | 动作+表情参数 | SDK 开发期免费；发行须签 Publication License：年销售 <1000 万日元的个人/小企业免费，中型 ¥5万初始+¥2万/月/平台，大型 ¥30万+¥10万/月/平台；**含"可导入任意模型"的头像类应用属 "Expandable Application"，须单独审批，且原则上不批准完全免费的模式，要求收入分成（个人/小企业 ¥300/单或 20%，中大型 5%）** | 授权最重 | **早期避免** |
| Ready Player Me | - | - | **已于 2026-01-31 关闭**（Netflix 收购，TechCrunch 2025-12-19）；官方 Unity SDK 已归档 | 死项目 | 不可用 |
| MetaPerson / Avaturn | 自拍转 3D | - | 各 Pro $800/月（Avatar SDK 2026-08-31 博客，竞品自述）| 贵 | 不推荐 |
| 视频生成式（Meta Muse Realtime Avatar 路线） | - | - | 不可复现 | 算力 | 不适用 |

### 6.2 Rive 细节

- 运行时：`rive-app/rive-runtime`（C++，MIT，1201 star）；Rust 运行时 `rive-app/rive-rs`（MIT，仅 134 star，**使用 Vello 作后端，存在已知偏差：图像网格接缝、超多裁剪错误、描边一律圆角；Rive Renderer 后端"正在推进"**）。因此：**若 UI 走 Tauri/Web 视图，用 JS 运行时（`@rive-app/react-webgl2` 或 canvas 版）；不要为了"纯 Rust"去押注 rive-rs。**
- 状态机：输入（布尔/数值/触发器）+ ViewModel 数据绑定（AI Elements 的 Persona 即用 `useViewModelInstanceColor("color")` 动态改色）。
- 定价（官网 rive.app/pricing，抓取于本次调研）：Free $0（Rive 启动画面、CLI 每月 50 次发布）；Cadet $9/seat/月（≤3 席，去启动画面）；Voyager $32/seat/月（≤25 席，Libraries、CDN）；Enterprise（营收 >$10M）。**无运行时费用、无版税、无分成**。

### 6.3 AI 生成与外包渠道

| 渠道 | 用途 | 授权/价格要点（来源） |
|---|---|---|
| Meshy | 文/图生 3D，自动绑骨，600+ 动作库 | 免费 100 积分/月，产物 CC BY 4.0（商用须署名）；付费版（Pro $20/月起）为私有、你拥有产出、可商用（meshy.ai/pricing、docs.meshy.ai 定价页）；有 MCP 服务器 |
| Tripo | 同上 | 免费版：模型公开、**仅限非商用，Tripo 保留权利**；Pro $20/月（3000 积分）起可商用私有（respawnstack 2026-10-29 摘引其条款，二手） |
| 即梦 / 豆包 / Nano Banana Pro | 2D 概念稿、三视图 | 2025-12-19 优设网实测：即梦**商用规则模糊**，豆包免费仅个人、企业宣传需另购授权；Nano Banana Pro 称"商用无门槛、可下载版权证明"（单一二手评测，**未经官方条款核实**）。生成式图像的著作权归属本身存在法律不确定性，**建议只用于概念探索，终稿请人类画师重绘并买断** |
| Midjourney | 概念稿 | 授权条款本次**未核实** |
| 米画师（mihuashi.com） | 国内 IP 形象外包 | 2026 年挂牌需求示例：原创 IP 形象单张预算 ¥52~5200；另一条"IP 人设立绘｜全版权买断商用"预算 ¥500~5000，交付 PNG+PSD 分层+过程稿；平台手续费 5%；画师常见价目表规则"授权商用乘 2、买断乘 3"（某画师主页，2026）。典型交付清单：三视图+≥6 款表情差分+分层源文件，命名规范，著作权财产权结清尾款后转让，画师保留署名/作品集展示权 |
| Dribbble / Behance / Figma Community | 找设计师、找灵感 | 社区素材各文件授权不一，**本次未逐项核实；仅作灵感与招募，禁止直接拿来当产品形象** |
| 海外外包（Fiverr、Upwork、Contra） | 吉祥物 + 绑定 | 价格本次未核实 |

### 6.4 许可证细节（容易踩坑处）

- **VRoid Studio**（vroid.com/en/studio/guidelines）：自己创作的贴图/发型版权归你；但 pixiv 提供的**基础模型/服饰/预设不是 CC0**，无特殊条款时个人与企业均可商用、可售卖；**禁止基于 VRoid Studio 产物开发"可生成/输出 3D 模型或头像的创作工具类应用"，需另行申请授权**（pixiv 可能拒绝）。VRoid 官方 FAQ：部分样例（HairSample_Male/Female、β Ver AvatarSample_1-4）为 CC0，AvatarSample_A/B/C 与 VRoidPreset 系列有自带条件。→ 我们若只**内置少量自制/CC0 VRM 供选择**是安全的；若做"在线捏人工具"则需 pixiv 授权。
- **VRM 元数据**（three-vrm `VRM1Meta`）：`avatarPermission`（onlyAuthor / onlySeparatelyLicensedPerson / everyone）、`commercialUsage`（personalNonProfit / personalProfit / corporation）、`creditNotation`、`modification` 等，加载时应读取并在 UI 上提示。
- **Live2D**：见上表。个人项目上线 Web 版（Web 应用属"非分发"类）且年销售 <1000 万日元可免费，但一旦允许用户导入自定义模型即触发 Expandable Application 审批，且要求"有效收益模式、收入分成、使用指定声明、展示 Live2D 标识"。
- **Spline**：新条款有训练数据授权，企业/隐私敏感项目需评估。
- **LottieFiles**：公共动画 Lottie Simple License 可商用（不得转存做竞品库）。
- **Noto 动画 Emoji CC BY 4.0**：必须署名。**OpenMoji CC BY-SA 4.0**：衍生作品需同协议开放，对闭源产品不友好。

---

## 7. 对本项目的具体建议（落地路线）

### 7.1 分阶段

| 阶段 | 目标 | 交付 | 验收 |
|---|---|---|---|
| P0（1-2 周） | 打通"事件→头像状态→花名册" | 自研 SVG 参数化头像 + `deriveAvatarState` + 花名册侧栏 + 三种注意力态 + 收件箱骨架 | 同时跑 5 个子 agent，侧栏一眼看出谁在干活/谁在等我 |
| P1（2-4 周） | 编程子 agent 工作台 | 异构时间线（shadcn AI Elements 模式 + assistant-ui 原语）、审批卡、右侧 Diff/Terminal/Preview、worktree 模式切换、Checkpoint + 分支选择器 | 能对 Claude Code/Codex 子 agent 完成"派发→评审→PR"闭环；能从任意 checkpoint 分支 |
| P2（4-8 周） | 分支树 + 回放 + 远程电脑/浏览器 | React Flow 分支树；Manus 式回放 scrubber；设备页；Computer 三级可见性 | 事件日志可回放；远程浏览器可接管再交还 |
| P3（并行进行） | 品牌 IP | 委托画师做主吉祥物 + Rive 绑定；品牌手册 | 主 agent 形象定稿并上线，替换 L0 默认主角 |
| P4（可选） | 语音/伴侣模式 | VRM 或 Rive 说话态 + 口型；桌面悬浮宠物（透明置顶窗口 + 悬停淡出穿透） | 参考 AIRI 实现 |

### 7.2 技术栈建议（需与架构调研文档协调）

- UI 用 **React + TypeScript + Tailwind + shadcn/ui**，通过 webview 壳（Tauri 或 Electron，由架构文档决定）一次开发覆盖 Win/Mac/Linux，并复用到 Web/PWA 与移动端（Tauri 移动或 React Native，assistant-ui 已有 RN 形态）。AIRI 同时覆盖 web / 桌面 / PWA / 移动，证明这条路可行。
- 事件协议对 UI：**内部事件模型与 AG-UI 事件类型对齐**（messages、tool call start/args/end、state delta、人在回路），让第三方前端/SDK 容易接入。
- 头像渲染层抽象为 `AvatarRenderer` 接口：`render(state, params, size)`，实现 SVG / Rive / VRM 三种后端（AIRI emotions.ts 的做法）。
- 小尺寸（<48px）头像一律走 Canvas2D/SVG，不要每个头像一个 WebGL 上下文。

### 7.3 借鉴与规避清单

借鉴：Grok Bot 的"花名册+头像即状态+三级电脑可见性+异构 transcript"；Muse 的"主聊天+侧聊天、Goals、Ideas、Soul/Memory 可编辑、高门槛主动消息、确定性审批卡"；Codex/Cursor 的"worktree + diff 评审 + best-of-n"；Manus 的"回放 scrubber"；Linear 的"delegate 与 assignee 分离 + 六态 session + 五类 activity"。

规避：写实/NSFW 伴侣、AGPL 代码复用（Claude Squad、Mux、Opcode）、依赖第三方托管的 Avatar 服务（RPM 已死）、Live2D 早期绑定、直接使用 Persona 的 Vercel Blob `.riv` 资源。

---

## 8. 待用户拍板的问题

1. **形象调性**：偏"极简酷感的形状机器人"（Grok Bot）、"可爱吉祥物"（Muse/OpenClaw 龙虾）还是"二次元/拟人"？这决定 L1 画师风格与是否做 L2。我的建议：L0 形状系统 + L1 一只有趣的机器人/生物吉祥物，暂不做拟人。
2. **是否做语音/伴侣模式**及优先级？若做，选 VRM（授权友好）还是 2D 立绘（需 Live2D 授权）？
3. **品牌名与吉祥物商标**：是否愿意先做商标/域名检索（OpenClaw 改名两次的前车之鉴）？
4. **IP 预算与归属**：是否接受买断外包（米画师 ¥500~5000 量级起，复杂 IP+绑定可能更高，**需实际询价**）？还是先 AI 出概念稿再人工重绘？
5. **Rive 付费**：接受 Cadet $9/席/月（去掉启动画面）吗？还是 MVP 阶段全部自研 SVG，延后 Rive？
6. **目标市场与语言**：中文优先还是全球？影响设计渠道（米画师 vs Dribbble）与 UI 文案。Muse 当前仅限美加，国内"中国版 Muse"赛道正在升温。
7. **UI 框架是否锁定 React？**（AIRI 为 Vue 栈；若团队偏 Vue/Svelte，需改选 aparté 等框架无关库或 assistant-ui 的 Vue 预览版，成熟度较低）
8. **Muse Windows 版**：Microsoft Store 条目存在，但官方说法为"即将推出"，具体时间**未证实**，是否对标需继续观察。

---

## 9. 来源索引（含时间）

- Meta Muse 官网 muse.ai；《How We Designed Muse》https://introducing.muse.ai/ （2026-09）
- TechCrunch 2026-09-18 https://techcrunch.com/2026/09/18/metas-muse-hits-mac-letting-the-ai-take-actions-on-your-computer/
- TechCrunch 2026-11-05 https://techcrunch.com/2026/11/05/meta-says-us-users-can-now-video-chat-with-their-muse-ai-avatar/
- TNW 2026-11-04 https://thenextweb.com/news/meta-muse-ai-voice-chat-animated-avatars
- Meta Research《Bringing Your Muse to Life》2026-09-23 https://research.meta.ai/blog/bringing-your-muse-to-life
- Meta Connect 2026 汇总 https://www.meta.com/blog/meta-connect-2026-everything-we-announced/ （2026-09-23）
- SmartScope Muse 屏幕指南 https://smartscope.blog/en/blog/meta-muse-screen-guide-features-main-chat-feed-2026/ （2026-10-25）
- Spyglass https://spyglass.org/metas-amusing-muse/ （2026-09-16）；Android Authority（2026-10-06）；36kr（2026-11-01）；mausbot 对比（2026-10-08）
- Grok Bot：https://docs.x.ai/grok-bot/overview 、/bots 、/settings-and-notifications ；https://x.ai/news/designing-grok-bot （2026-09-03）；Interesting Engineering（2026-08-11）；Mascot Atlas https://atlas.mascotti.studio/m/grok-bot/ ；粉丝站 https://www.grokbotexplained.app/avatar-system （非官方）
- Grok Companions：Eliza Report、Layer3 Labs（2026-08-14）、Aadhunik（2026-09-08）、NBC（2025-07-15）、Decrypt（2025-07-14）
- Codex app：https://openai.com/index/introducing-the-codex-app/ （2026-02-02）；Cursor：https://cursor.com/docs/agent/agents-window 、https://cursor.com/changelog/3-0 ；Nimbalyst 对比（2026-06-01）
- Manus：MIT Tech Review（2025-03-11）、WorkOS；Linear AIG：https://linear.app/developers/aig 、/agent-interaction 、/agents
- Rive：https://rive.app/pricing 、https://rive.app/runtimes ；https://rive.app/blog/rive-s-new-9-mo-plan （2025-10-20）；rive-rs、rive-runtime（GitHub）
- Live2D：https://www.live2d.com/en/sdk/license/ 、/running_plan01/ 、/expandable/（日文）；Live2D Open Software License v1.4（2025-02-03）
- Ready Player Me：TechCrunch 2025-12-19；Avatar SDK《Avatar Platforms in 2026》2026-08-31
- DiceBear 许可证 https://www.dicebear.com/licenses/ ；Meshy 定价/授权；Tripo（respawnstack 2026-10-29）；LottieFiles 商用政策（2026-10-29）；Spline 定价与条款（respawnstack）；Noto 动画 Emoji；VRoid Studio Guidelines；VRM Public License 1.0
- 组件库：CodeCudos（2026-10-16）、shipgarden（2026-08-07）、aparté 比较页、teaflask（2026-10-28）、pastaui（2026-10-07）、xyflow npm（2026-11-02）
- 米画师需求单（2026-05、2026-10-30）；优设网 AI 生图对比（2025-12-19）
- 本地源码：D:\code\xuqiu\repos\airi（MIT）、D:\code\xuqiu\repos\ai-elements（Apache-2.0）、D:\code\xuqiu\repos\three-vrm（MIT）

## 10. 调研局限

- assistant-ui 仓库在报告撰写后才克隆完成，仅做了目录级核实：LICENSE 为 MIT（© 2026 AgentbaseAI Inc.）；monorepo `packages/` 含 core、react、react-ag-ui、react-a2a、react-ai-sdk、react-data-stream、react-google-adk、react-ink（终端）、generative-ui、assistant-stream 等；分支选择器逻辑在 `packages/core/src/react/primitive-hooks/useBranchPickerNext.ts` / `useBranchPickerPrevious.ts`，外部存储运行时在 `packages/core/src/runtimes/external-store/external-store-adapter.ts`（可用于接入我们自己的事件流/分支模型）。未做更深的源码分析。
- Claude / ChatGPT 桌面应用、Notion/Raycast 等其他界面未深入；Dribbble/Behance/Figma Community/Midjourney/海外外包价格未核实。
- 所有"2026"年数据均取自网络检索结果，部分来自 SEO 型二手站点，已尽量标注"二手/未证实"，关键决策前请复核官方页面。
