# 04 - UI/UX 与智能体形象设计规范

> 日期：2026-11-06　状态：设计草案 v0.1（待拍板项见 §14）
> **评审修订（05-review-roadmap.md）**：产品工作代号统一为 **Muster**，**Pip 仅指主 agent 的默认名字/吉祥物**（原稿把 Pip 同时当产品名）；风险分级与 03 引擎分级的映射见 §4.3；头像状态分工见 §9.2；技能页 v1 范围见 §3.7；阶段编号以 05 的 M0–M4 为准（§12）。
> 依据：docs/research/01~08（尤其 08 UI/形象、02 SuperAgent 事件架构、03 外部编码 agent、06 多设备/远程浏览器、07 技术栈）。
> 约定：事实性引用均来自上述调研报告；报告中标为"未证实/二手"的信息在此继续保持该标注。线框图内的文字刻意用英文/ASCII，以保证等宽对齐；中文说明写在线框下方。

---

## 0. 摘要（TL;DR）

1. **一句话定位**：一个"有名字、有形象、会汇报的小主管"（主 agent，极轻）+ 一队"有状态、能分支、能被插话的专才"（子 agent，含本机 Claude Code / Codex 等外部编码 agent）+ 你的所有电脑与远程浏览器，全部在同一个界面里被事件驱动地调度。
2. **界面的一等公民是 Agent，不是对话**（Grok Bot 与 Meta Muse 共同验证的范式）。左侧是 Agent 花名册，头像既是身份又是状态指示器；中间是异构时间线；右侧是上下文面板（电脑/浏览器、Diff、终端、产物、分支树）；全局有一个"待我处理"收件箱。
3. **SuperAgent 三原语在 UI 上都是一等交互**：
   - **插话（steer）**：运行中输入框永不禁用，发送即插话；
   - **分支（fork）**：任意消息/Checkpoint 都有"从此处分支"，配分支选择器 + 分支树；
   - **一切皆事件**：用户输入、定时、GitHub PR、子 agent 回调、设备上下线、审批结果都进入同一个收件箱/时间线，来源用头像区分。
4. **形象系统三层**：L0 自研"形状 + 眼睛 + 配饰"参数化角色（零授权风险，覆盖所有子 agent）；L1 一个请画师买断的主吉祥物 + Rive 状态机动画；L2（后置）VRM 语音伴侣与桌面悬浮宠物。头像状态是事件流的纯函数投影 `deriveAvatarState(events)`。
5. **视觉风格推荐**：默认方案 A "Pebble Studio"（柔和、圆润、有温度），同一套 design token 派生方案 B "Mission Control"（暗色、高密度、开发者向）作为暗色主题/专业模式；方案 C "Paper Office" 作为办公向浅色主题备选。
6. **组件栈**：React + TypeScript + Tailwind + shadcn/ui（含其 AI Elements 模式）+ assistant-ui（分支选择器、external-store 运行时）+ React Flow（分支树/拓扑）+ Rive + xterm + CodeMirror。UI 只依赖协议（内部事件模型对齐 AG-UI），不直接调用壳层 API。
7. **产品工作代号：Muster；主 agent 默认名/吉祥物：Pip**（对外品牌候选见 §14，均未做商标检索）。

---

## 1. 设计目标、原则与非目标

### 1.1 用户与场景

| 人群 | 典型场景 | UI 重点 |
|---|---|---|
| 开发者（核心） | 同时让 Claude Code、Codex 在不同电脑/worktree 上干活，自己做评审与决策 | 看板、Diff 评审、分支、审批、不盯屏 |
| 知识工作者 | 让 agent 整理文件、做表格/PPT、调研、定时汇总 | 产物面板、计划卡、定时任务、成本可见 |
| 重度自动化用户 | GitHub PR/定时/webhook 触发的长期任务 | 触发器配置、observe 模式、事件收件箱 |

### 1.2 十条设计原则

1. **Agent-first**：导航单元是 Agent（人格化的执行者），Session/Thread 是实现细节，展开才可见（呼应 DSH 文章 §8.2）。
2. **头像 = 身份 + 状态**：同一个形象同时回答"谁""在干嘛"，不再叠加第二个状态指示器（Grok Bot 官方设计文章，2026-09-03）。
3. **主 agent 轻，界面也轻**：主线程里主 agent 的话要短，主要产出是"派发卡/汇报卡"，细节折叠到子 agent 卡片中。
4. **永不阻塞输入**：任何时候都可以插话、改主意、再发任务。Stop（中断）与"等待审批"是两件事，外观必须区分。
5. **打扰门槛高**：后台完成后由主 agent 判断"值不值得打扰"，否则只落收件箱（Muse 的原则）。用户有全局"主动程度"旋钮。
6. **确定性控件不可被模型替代**：审批卡、凭据保险箱、设备配对、权限变更都是原生确定性 UI，内容由后端结构化数据渲染，不由模型生成文本拼出。
7. **默认安全可见**：不可逆操作才拦截；无人值守触发的审批自动拒绝；任何时候能看到"谁在用我的哪台电脑做什么"。
8. **成本透明**：会话/任务/子 agent 三级 token 与费用仪表，任务级预算上限在 UI 中是一等设置。
9. **可回放可审计**：时间线即事件日志的视图，支持 Manus 式 scrubber 回放（Jump to live）。
10. **多端同源**：同一套 Web UI 通过协议（WS 事件流）运行在 Tauri 桌面、浏览器/PWA、移动遥控器上，Agent 永不在手机上运行。

### 1.3 非目标（v1 明确不做）

- 写实/二次元 3D 伴侣、NSFW 内容（Grok Companions 下线教训；应用商店审核）。
- Muse 的 Feed / Ideas 信息流（后置；Goals 以"长期订阅"形式在 v1.5 上线）。
- 视频生成式实时头像（Meta Realtime Avatar 不可复现）。
- 桌面 GUI 级 computer-use 的默认开启（OSWorld 2.0 前沿模型仅约 20%，放后期且默认关）。

---

## 2. 信息架构与导航

### 2.1 对象模型（UI 名词）

| 对象 | UI 呈现 | 与事件模型的对应 |
|---|---|---|
| **Agent** | 花名册条目：头像 + 名字 + 职位标签 + 一行实时动作 | 事件的生产者/消费者；头像由其事件流投影 |
| **Task / Thread** | 主视图里的任务卡与时间线（对应 02 报告的 Thread↔Task 订阅） | Worker 订阅 Thread 后事件直通 |
| **Branch** | 分支选择器 `< 1/3 >` + 分支树 | 从事件日志偏移 fork 出的新 Session |
| **Event** | 收件箱条目 + 时间线系统行 | 统一信封：id/type/source/target/payload/idempotency_key |
| **Trigger** | 触发器页条目（cron、GitHub、webhook、文件监听、设备事件） | Source → Trigger；授权(Mandate)与订阅分离 |
| **Device** | 设备页条目、Computer 面板的"屏幕" | 上下线、配对、审批本身都是事件 |
| **Artifact** | 产物面板、Library | 事件的产出（文件、Diff、截图、PDF） |
| **Skill** | 技能页条目（SKILL.md 包） | 作为能力清单被 agent 按需加载 |

### 2.2 导航树

```
Muster
├─ Home            主线程（与主 agent 的永续对话 + 侧聊 Side chats）            [v1]
├─ Inbox           待我处理 / 未读 / 进行中（全局事件收件箱）                    [v1]
├─ Agents          花名册（侧栏常驻）+ 子 agent 看板 + 分支树                  [v1]
│    └─ Agent 详情  人设(Soul)、记忆(Memory)、权限、引擎、设备、成本、事件流
├─ Triggers        触发器与定时任务、事件实时流、模拟触发                      [v1]
├─ Devices         设备（电脑/VPS/云 VM）、远程浏览器、配对                    [v1]
├─ Library         产物（文档/Diff/截图/表格），可按 agent/任务过滤              [v1.5]
├─ Goals           长期目标（= 长期事件订阅的可视化）                          [v1.5]
├─ Skills          技能市场与已装技能                                          [v1]（精简版）
└─ Settings        账户与模型、权限与安全、通知、外观与形象、高级/开发者         [v1]
```

### 2.3 导航形态

- **桌面（≥1100px）**：三栏。左栏 = 花名册 + 导航图标条（图标条竖排贴边，花名册在其右侧）；中栏 = 当前视图；右栏 = 上下文面板（可折叠，宽度可拖拽）。
- **平板/窄窗（700~1100px）**：花名册折叠为头像竖条（只显示头像 + 注意力角标）；右栏改为抽屉。
- **移动（<700px，Web/PWA 遥控器）**：底部 4 个 Tab：Home / Inbox / Agents / Devices；Settings 在 Home 头像菜单里。以审批、插话、查看进度为主，不做重型 Diff 编辑。
- **全局层**：命令面板 `Cmd/Ctrl+K`（跳转 agent、发起 fork、触发手动事件、切换设备）；托盘/菜单栏常驻图标（头像状态同步）；可选桌面悬浮宠物（P4）。

### 2.4 三种注意力态（贯穿花名册、导航、Dock 徽标）

| 态 | 含义 | 视觉 | 例子 |
|---|---|---|---|
| **Needs attention** | 有事必须你做 | 蓝点 + 头像"求关注"动作；排序置顶 | 审批、提问、交接、设备配对请求 |
| **Unread activity** | 有新结果可看 | 数字徽标 | 子 agent 完成、PR 触发的汇报 |
| **Working** | 在干活，不打扰 | 头像工作态 + 悬停显示当前动作 | 长任务运行中 |

来源：Grok Bot settings-and-notifications 文档的三态划分。即使系统通知被用户关闭，侧栏与 Dock 徽标仍保持可见。

---

## 3. 关键页面线框

> 通用图例：`[x]` 按钮/控件；`(o)` 头像；`>>` 展开箭头；`~~~` 流式输出；`@` 设备；`⎇` 分支。线框图宽度按 100 列设计。

### 3.1 主对话 / 任务分发视图（Home）

```
+--------+----------------------------------------------------+--------------------------+
| Roster | Pip (main)  "Dispatching 2 tasks, 1 waiting you"    | Panel: [Computer][Diff]  |
|--------|----------------------------------------------------| [Term][Files][Branch][Log]|
| (o) Pip|  you  10:02  Fix flaky test in repo A, and        |--------------------------|
|   main |       summarize yesterday's PRs for me             | Computer  @work-pc       |
|  *     |  (o)Pip 10:02  On it. Splitting into 2 tasks.      |  +--------------------+  |
|--------|  +----------------------------------------------+  |  | [live thumbnail]   |  |
| Agents |  | TASK #12  Fix flaky test        (o)Coder-1   |  |  |  terminal running  |  |
| (o)Cod1|  | engine: codex  @work-pc  wt: fix/flaky       |  |  +--------------------+  |
|  work  |  | [working] reading logs...  $0.21  2m14s      |  |  [Preview] [Takeover]    |
| (o)Rsch|  | [Steer] [Fork] [Stop]            >> details  |  |                          |
|  idle  |  +----------------------------------------------+  | Status: ● agent in control|
| (o)ClCd|  | TASK #13  PR digest             (o)Scout     |  |                          |
|  wait! |  | trigger: github  [done] 5 PRs   $0.04        |  |                          |
|--------|  | [Open artifact]                  >> details  |  |                          |
| Nav    |  +----------------------------------------------+  |                          |
| Inbox 2|  (o)ClCd 10:09  Needs approval: run `git push`    |                          |
| Triggers|  +----------------------------------------------+  |                          |
| Devices|  | APPROVAL  risk: HIGH (hard to undo)          |  |                          |
| Skills |  | push 3 commits to origin/fix/flaky           |  |                          |
|        |  | [Deny] [Allow once] [Allow for this task]    |  |                          |
|        |  +----------------------------------------------+  |                          |
|        |  ⎇ checkpoint "tests green" [Branch from here]     |                          |
|        |----------------------------------------------------|                          |
|        | > Steer Coder-1 ... (Enter=steer now, Alt+Enter=queue, Ctrl+Enter=interrupt&send)|
|        | [+] [@Coder-1 v] [mode: Local|Worktree|Cloud]  budget: $0.25/$2.00  [Send]      |
+--------+----------------------------------------------------+--------------------------+
```

要点：
- **中栏是异构时间线**：用户消息、主 agent 短回复、任务卡（派发回执 + 实时迷你状态）、审批卡、Checkpoint、系统事件行（"GitHub PR #482 opened → Scout notified"）共处同一条流（Grok Bot 异构 transcript 原则）。
- **主 agent 的路由决策**默认折叠为一行灰字（"routed to Coder-1 because: repo-bound task"），点开可见 Router 的快路径/慢路径判定，满足可审计而不喧宾夺主。
- **任务卡 = 子 agent 的摘要视图**：展开后是该子 agent 的完整内嵌时间线（工具调用、Diff、终端片段），不必跳页。
- **输入框目标选择器 `@Coder-1`**：默认发给主 agent；选中某个子 agent 即直接对其插话（等价 `steer` 事件，不经主 agent）。
- **输入框三种发送语义**见 §4.1。
- 顶部标题栏：主 agent 头像下方一行"当前动作"实时片段（Muse 模式），点击头像打开 Agent 详情（活动日志、已批准权限、Soul/Memory 两张可编辑卡）。
- 右栏默认 Computer 预览；若当前任务无远程画面则自动切 Diff/Log。

### 3.2 子 agent 看板（Agents Board）

```
+------------------------------------------------------------------------------------------+
| Agents    View: [Board] [List] [Topology]   Group by: [Status v]  Filter: [@all devices v]|
+--------------+---------------+------------------+----------------+-----------------------+
| QUEUED (1)   | WORKING (3)   | NEEDS YOU (2)    | DONE TODAY (5) | OFFLINE/ASLEEP (1)    |
+--------------+---------------+------------------+----------------+-----------------------+
| (o)Scout     | (o)Coder-1    | (o)ClCd  ‼        | (o)Writer      | (o)Coder-3 @laptop    |
| PR digest    | Fix flaky     | git push approval| Weekly report  | device offline        |
| waiting slot | codex @work   | 3 min ago        | [Open]         | last seen 2h          |
|              | $0.21 2m14s   | [Review]         |                |                       |
|              | reading logs  +------------------+ (o)Coder-2     |                       |
|              | [Steer][Fork] | (o)Rsch  ?        | Refactor auth  |                       |
|              +---------------+ asks: which      | PR #483 [View] |                       |
|              | (o)Coder-2    | source to trust? |                |                       |
|              | ...           | [Answer]         |                |                       |
+--------------+---------------+------------------+----------------+-----------------------+
| Totals: 3 running | $1.37 today | budget ok | loop-detector: 0 flags | tokens 412k          |
+------------------------------------------------------------------------------------------+
```

要点：
- 列 = 状态机状态，直接对应头像状态集合（见 §9）；"Needs you"列永远是最左侧高亮优先（可在设置里调整列顺序，默认 Needs you 置第一）。
- 卡片字段：头像、任务名、引擎（codex/claude/opencode/内置）、设备、worktree/分支名、已用成本与时长、最近一个动作、**行内操作 Steer / Fork / Stop / Open**。
- **Topology 视图**（React Flow）：主 agent 在中心，子 agent 环绕，边上是最近事件；设备作为外圈分组容器。适合"一眼看清我的 agent 网格"，而非日常操作。
- **父子关系**：子 agent 再派生子 agent 时（DeerFlow 语义默认深度 1，可配置）卡片缩进显示。
- 底部汇总条显示成本、循环检测命中数（来自"循环检测/任务级预算"差异化功能）。

### 3.3 分支时间线树（Branch Tree）

```
+---------------------------------------------------------------------------------------+
| Task #12 Fix flaky test       [Timeline] [Tree] [Compare]            Replay: |<  ||> >| |
+---------------------------------------------------------------------------------------+
|  main branch (Coder-1)                                                               |
|   o--o--o--o--[CP1: repro found]--o--o--[CP2: tests green]--o--> now (live)           |
|                    \                                                                  |
|                     \_⎇ "try mutex" (Coder-1b)  o--o--x  failed (tests red)  [archived]|
|                     \_⎇ "retry in test" (Coder-1c) o--o--[CP3 green]--> awaiting review |
|                                                                                       |
|  Legend: o event   [CP] checkpoint   x dead end   ● live   ◐ working   ◇ needs you    |
+---------------------------------------------------------------------------------------+
| Selected: ⎇ "retry in test"                                                           |
|  forked from CP1 · files: worktree wt/retry (isolated) · side effects before fork: 0 |
|  agent: codex @work-pc · cost $0.38 · diff +12 -3                                    |
|  [Open timeline] [Compare with main] [Adopt this branch] [Steer] [Archive]            |
+---------------------------------------------------------------------------------------+
| Scrubber:  |----o-----o--------[=======|======]-----------------|  Jump to live        |
+---------------------------------------------------------------------------------------+
```

要点：
- **两种形态**：时间线内的"分支选择器 `< 1/3 >`"（assistant-ui BranchPicker 原语）适合日常；这个 Tree 视图用 React Flow 渲染，适合比较多条分支。
- 节点类型：事件（小点）、Checkpoint（带标签的大点，来自自动或手动）、死路（x）、实时（脉动）。
- **Adopt this branch（采纳）**：把分支的结论并回主线——本质是向主线 Session 注入一条"分支摘要 + Diff 引用"事件，并合并/切换 worktree；不做 CRDT 式自动合并。
- **Compare**：并排对比两个分支的 Diff、测试结果、成本（`best-of-n` 体验，对标 Cursor）。
- **副作用账本提示**（02 报告 side_effect_ledger）：分支点之前已发生的外部副作用（发邮件、推代码、创建 PR）在分支详情里列出并标注"分支内不会重复执行"。
- **Scrubber**：事件日志回放，可拖拽、`Jump to live`；回放只读，不触发任何副作用。

### 3.4 事件中心 / 触发器配置（Inbox + Triggers）

**Inbox（待我处理）**

```
+--------------------------------------------------------------------------------------+
| Inbox     [Needs attention 2] [Unread 5] [Working 3] [All]     Filter: source v agent v|
+--------------------------------------------------------------------------------------+
| ‼ (o)ClCd   APPROVAL  git push to origin/fix/flaky               HIGH   3m   [Review]  |
| ?  (o)Rsch   QUESTION  Which source should I trust?              -      8m   [Answer]  |
| ✔ (o)Scout  DONE      PR digest ready (5 PRs)         via github-trigger  12m [Discuss]|
| ✔ (o)Coder2 DONE      Refactor auth -> PR #483        via subagent        1h  [View]   |
| ⚙ system    DEVICE    "laptop" went offline, 1 task paused               2h  [Details] |
+--------------------------------------------------------------------------------------+
| Bulk: [Mark all read] [Snooze 1h]       Proactivity: [Quiet | Balanced | Chatty]       |
+--------------------------------------------------------------------------------------+
```

**Triggers（触发器配置）**

```
+--------------------------------------------------------------------------------------+
| Triggers   [+ New]                                  Live event stream: [pause] [filter]|
+-----------------------------------------+--------------------------------------------+
| ● github  repo:acme/app  PR opened      | 10:21:04 github  pr.opened #484  -> Scout   |
|   mode: OBSERVE  -> Scout  [edit]       | 10:21:04   fast-path: matched rule#2        |
| ● cron    weekdays 09:00 "PR digest"    | 10:21:05   thread joined: PR#484 (new)      |
|   mode: ACT      -> Scout  [edit]       | 10:20:11 subagent Coder-1 turn.ended        |
| ○ file    ~/Reports/** changed          | 10:19:50 cron  "PR digest" skipped (dedup)  |
|   mode: OBSERVE  paused                 | 10:18:02 device laptop online               |
| ● webhook /hooks/deploy-failed          | 10:15:44 user  message -> main              |
+-----------------------------------------+--------------------------------------------+
| Edit trigger: "GitHub PR opened"                                                     |
|  Source:    github  [acme/app v]   events: [pull_request.opened][review_requested]   |
|  Filter:    (rule) label != "wip"        (LLM slow-path) "only if touches /auth"  [+]|
|  Subscribe: Thread per PR  ->  assign to [Scout v]  or  [spawn new coding agent v]    |
|  Mandate:   (what the agent MAY do)  [x] read repo  [ ] comment  [ ] push  [ ] merge |
|  Mode:      (o) Observe (draft only, show in Inbox)   ( ) Act (within Mandate)       |
|  Budget:    max $1.00 / run    Dedup window: 10 min    Unattended approvals: DENY     |
|  [Simulate with sample event]  [Save]                                                 |
+--------------------------------------------------------------------------------------+
```

要点：
- **Subscribe（订阅=上下文）与 Mandate（授权=能做什么）在界面上分开两块**，对应 02 报告"授权与订阅分离"。
- **默认 Observe**：主动行为先只产生草稿/建议进收件箱，用户升级为 Act 要显式切换，并提示 Mandate 范围。
- **Live event stream** 即事件总线尾巴（tail），带 fast-path / slow-path 判定记录——Router 决策可审计。
- **Simulate with sample event**：用样例事件干跑，展示命中哪条规则、会派给谁、会请求哪些权限，且零副作用。
- 无人值守的审批默认 DENY 且在 UI 上显式展示（来自 05 报告的文件安全默认值）。

### 3.5 设备管理（Devices）

```
+--------------------------------------------------------------------------------------+
| Devices    [+ Pair new device]                         Hub: this computer (home-pc)   |
+--------------------------------------------------------------------------------------+
| ● work-pc      Win11   online  route: direct (iroh)   fp: 7F3A-91C2   [Manage]        |
|     capabilities: exec(ask) fs(/code) browser(isolated) screen(preview)               |
|     running: Coder-1 (codex), Coder-2 (opencode)       cpu 34%  mem 5.1/16G           |
| ● mac-mini     macOS   online  route: relay           fp: A210-0DDE   [Manage]        |
|     capabilities: exec(ask) fs(~/proj) browser(isolated)                              |
| ○ laptop       Linux   offline (2h)  1 task paused        [Wake/Retry] [Forget]        |
| ◐ cloud-vm-1   Ubuntu  online  route: relay    steel-browser attached   [Manage]      |
+--------------------------------------------------------------------------------------+
| Pending pair request:                                                                |
|   "new-phone"  fingerprint 5C09-E7B1  requests: browser, notifications               |
|   Verify the fingerprint matches the device screen.  [Approve narrow] [Deny]          |
+--------------------------------------------------------------------------------------+

Pair dialog:                         Device detail (work-pc):
 +-------------------------+          Capabilities         Policy
 |  [ QR CODE ]            |          exec                 ( )Allow (o)Ask ( )Deny
 |  or code: K7Q2-M9XP     |          fs paths             /code, ~/Reports  [edit] [denylist: .env .ssh *secret*]
 |  expires in 09:41       |          browser              isolated profile only
 |  one-time, 10 min       |          screen               preview only
 +-------------------------+          Network domain allowlist  [edit]
                                      Audit  [open hash-chain log]   Revoke key [Forget device]
```

要点（对应 06 报告）：
- **公钥短指纹**必须显示并要求用户核对；公钥变化或权限升级不得自动批准，回到 pending。
- 每台设备能力面独立开关；**exec 默认 Ask**（明确区别于 OpenClaw 默认 full）。
- 路由状态（direct/relay）可见，帮助用户理解延迟；中继自托管/官方的选择放在设置里。
- 设备离线时，其上的子 agent 头像呈 asleep 态，任务卡显示"已暂停，设备上线后自动 `task.resume(last_event_seq)` 补拉"。

### 3.6 远程浏览器视图（Remote Browser）

```
+--------------------------------------------------------------------------------------+
| Browser  Tier: [A isolated @work-pc v]   Agent: (o)Rsch   Mode: [Status|Preview|Takeover]|
+--------------------------------------------------------------------------------------+
| tabs: [github.com/acme..] [docs.rs/iroh] [+]       |  Action log                     |
| [<][>][R] https://github.com/acme/app/pull/484     |  10:21 goto github.com/...       |
+---------------------------------------------------+  10:21 snapshot (a11y tree, 212)  |
|                                                   |  10:22 click ref=e41 "Files"      |
|   [ live page render ]                            |  10:22 extract table -> artifact  |
|        ( agent cursor ◉ )                         |  10:23 !! login required          |
|                                                   |        [Take over] [Cancel step]   |
|   password / OTP fields are masked in snapshots   |                                    |
+---------------------------------------------------+------------------------------------+
| Site grants:  github.com [allowed this task]   mail.example.com [needs grant]           |
| Domain policy: SSRF/private-net blocked · evaluate(): OFF · downloads -> Files panel    |
| [Take over: you control; agent paused]   [Hand back to agent]   [Record session]       |
+--------------------------------------------------------------------------------------+
```

要点：
- **三级可见性**：Status（头像/标题栏指示，默认）→ Preview（右栏固定缩略图，边聊边看）→ Takeover（全屏，用户操作，agent 暂停，结束点"交还"）。Grok Bot 经验：越突出越诱导用户盯屏，所以默认 Status。
- **Takeover 的首要场景**是验证码/2FA/登录；Agent 触发 `needs_human` 事件，头像进入 waiting，收件箱出现"需要你登录"。
- 浏览器档位 A/B/C 徽标可见：A 隔离 profile（默认）、B 真实 Chrome 扩展桥接（v2，逐站点授权）、C 云浏览器（CDP URL）。B 档页面顶栏用醒目的橙色提示"正在使用你的真实浏览器会话"。
- 动作日志与事件总线同源；可回放。
- 下载、弹窗、崩溃均是事件，进入 Files 面板/收件箱。

### 3.7 技能市场（Skills）

```
+--------------------------------------------------------------------------------------+
| Skills   [Installed 12] [Discover] [Create]            Search: [______]  Trust: [All v]|
+--------------------------------------------------------------------------------------+
| Featured (curated, signed)                                                            |
| +----------------+ +----------------+ +----------------+ +----------------+           |
| | Excel Pro      | | PPTX Maker     | | PDF Toolkit    | | Deep Research  |           |
| | official ✔     | | official ✔     | | official ✔     | | official ✔     |           |
| | perms: fs(r/w) | | perms: fs(r/w) | | perms: fs(r)   | | perms: net     |           |
| | [Install]      | | [Install]      | | [Install]      | | [Install]      |           |
| +----------------+ +----------------+ +----------------+ +----------------+           |
+--------------------------------------------------------------------------------------+
| Skill detail: "PPTX Maker" v1.3  (SKILL.md, agentskills.io compatible)                |
|  Publisher: Muster Team (signature verified)   Source: github.com/...  License: MIT      |
|  Requested permissions:  fs.write ~/Documents/**   net: none   exec: soffice (sandbox)|
|  Runs in: office-runtime sandbox   Used by: Writer, Coder-2        [Update] [Remove]  |
|  Preview of SKILL.md  >>      Changelog >>      Past runs (3) >>                      |
+--------------------------------------------------------------------------------------+
```

要点：
- **【评审】范围**：与“不开放式市场、先不做签名生态”(PRD §10、P1-09) 一致，**v1 只上线 Installed + 本地/Git 导入 + 本机外部技能发现**；Featured/Discover/Community 分级与上图的 Install 按钮属 P1（办公技能首批在 PRD P1-03，v1.0 之前线框里的 Excel Pro/PPTX Maker 不存在）。
- **信任分级**：Official（官方签名）> Verified（作者签名 + 权限清单 + 自动扫描）> Community（沙箱 only，安装时二次确认）> Local（用户自写）。不开放"任意代码市场"（OpenClaw ClawHub 被投毒的教训）。
- **权限清单是安装对话框的主体**，不是附属说明；升级时权限变宽要重新确认。
- 原生兼容 SKILL.md 与 `~/.agents/skills`、`.claude/skills` 目录，Installed 页同时列出"发现于本机的外部技能"，一键导入。
- **已用技能回溯**：任务卡里能看到本次任务用了哪些技能（05 报告 UI 建议）。

### 3.8 设置（Settings）

```
+----------------+---------------------------------------------------------------------+
| Account        | Models & Cost                                                       |
| Models & Cost  |  Main agent (router):  [small-model v]   Workers: [per agent v]     |
| Agents         |  Providers: [DeepSeek ✔] [Kimi ✔] [GLM] [Qwen] [Anthropic key] [+]  |
| Permissions    |  Heartbeat model: [small v]  (never carries full context)           |
| Triggers       |  Budget: per task [$2.00]  per day [$10]  on exceed: (o)pause ( )ask|
| Devices        |  Loop detector: [on]  threshold 4 repeats                           |
| Notifications  |                                                                     |
| Appearance     | Permissions & Safety                                                |
| Avatar & Voice |  Approval strictness: Relaxed | (Balanced) | Strict                 |
| Channels       |  Only intercept hard-to-undo actions: [on]                          |
| Advanced       |  Unattended approvals: DENY (locked)    Approval timeout: 10 min->deny|
|                |  Credential vault: [open vault]  (values never enter model context)  |
|                |  Engines: claude (local, user-logged-in) [detected 2.x]  codex [..]  |
+----------------+---------------------------------------------------------------------+
```

要点：
- **Channels**（渠道）页：微信/飞书/钉钉/Telegram 等接入（国内适配差异化），v1.5。
- **Engines**：自动探测本机已登录的 `claude`、`codex`、`opencode` 等；明确提示"本产品不接触你的订阅令牌，使用你本机已登录的官方二进制"。UI 内引擎名以中性文字显示（"Claude (local CLI)"），**不使用 Claude Code 品牌与图标**（合规，见 03 报告）。
- **Appearance / Avatar & Voice**：主题（A/B/C）、字号、动效强度（含 reduced-motion）、主 agent 形象编辑器（§10.3）、桌面宠物开关。
- **Advanced**：数据目录、导出日志、协议端点（供第三方客户端连接）、开发者模式（显示 Router 判定、原始事件）。

### 3.9 移动端审批（PWA / Tauri Mobile）

```
Lock-screen push                     Approval card (full screen)
+--------------------------+         +---------------------------------+
| (o)Pip  now              |         | (o) Coder-1  @work-pc            |
| Coder-1 needs approval:  |         | wants to: git push               |
| push 3 commits (HIGH)    |         | origin/fix/flaky   (3 commits)   |
+--------------------------+         |---------------------------------|
                                     | Risk: HIGH - hard to undo        |
Home tab (mobile)                    | Why: tests passed, PR requested  |
+--------------------------+         | [View diff (+12 -3)]             |
| Pip      ●  Balanced     |         |                                 |
| 2 need you · 3 working   |         | [ Deny ]  [ Allow once ]         |
|--------------------------|         |   (Allow always: desktop only)   |
| ‼ Coder-1 push approval  |         | Quick reply: [ "use squash" ... ]|
| ?  Rsch   question       |         | Biometric required for HIGH      |
| ✔ Scout  PR digest       |         | Expires in 09:12 -> auto-deny    |
|--------------------------|         +---------------------------------+
| [type to steer...]  [mic]|
+--------------------------+
 Tabs: Home | Inbox | Agents | Devices
```

要点：
- 移动端是**遥控器**：审批、回答问题、插话、看进度、紧急 Stop；"Allow always"、权限放宽、设备配对授权只能在桌面端（或需桌面二次确认）。
- **HIGH 级审批必须生物识别**；审批卡内容由后端结构化字段渲染，防止被模型文本伪造。
- 审批有倒计时，超时自动拒绝并记录事件。
- 推送：Web Push（PWA，iOS 需添加到主屏幕——此条为通用平台限制，实现时需实测）；阶段 2 Tauri Mobile 提供原生推送。推送内容不含敏感正文，只含 agent 名与风险级别。

---

## 4. 关键交互规范

### 4.1 插话（Steer）、排队与中断

**状态**：目标 agent 处于 working/thinking 时，输入框保持可用，右下角显示三种发送语义：

| 操作 | 快捷键 | 语义 | 事件 | 后端映射（据 03 报告） |
|---|---|---|---|---|
| Steer（插话） | `Enter` | 在下一个 turn 边界注入，作为用户引导 | `user.steer{request_id, expected_turn_id}` | Codex `turn/steer`（带 expected_turn_id）；Claude `priority:now/next`；ACP 扩展 `_session/steering`；缺失则降级为 cancel 后重新 prompt |
| Queue（排队） | `Alt+Enter` | 当前任务结束后作为 follow-up | `user.followup` | Codex `thread/queue`；OpenCode `delivery:queue`；缺失则 Core 侧排队等 Idle |
| Interrupt & Send | `Ctrl/Cmd+Enter` | 立刻中断当前 turn 再发送 | `user.interrupt` + `user.message` | Codex `turn/interrupt`；Claude interrupt |
| Stop | 按钮 / `Esc` 两次 | 只中断，不发送新内容 | `user.interrupt` | 同上 |

交互细节：
1. 插话发出后在时间线显示**灰色待确认气泡**（"will be applied at next step"），agent 采纳后变正常气泡并记录采纳的 turn；
2. 若 `expected_turn_id` 校验失败（turn 已结束），UI 自动转为 follow-up 并给出一行提示，不丢消息；
3. 带 `request_id` 幂等：弱网重复点击不会重复注入；
4. **不能静默降级**：当后端降级（例如 steer→cancel+reprompt）时，气泡下方显示小标签"engine does not support live steering; restarted turn"，用户知道发生了什么；
5. 插话也可发给**多个** agent（`@Coder-1 @Coder-2`），逐个生成事件；
6. 引擎能力矩阵（steer/queue/fork 粒度/interrupt）在 Agent 详情中可见，能力缺失的按钮显示降级提示，而不是隐藏。

### 4.2 分支（Fork）

入口：任意消息或 Checkpoint 悬停出现"⎇ Branch from here"；命令面板 `Fork current task...`；任务卡菜单。

流程（弹窗，3 个选项，默认值已选好）：
1. **Fork 谁**：同一个 agent（默认）/ 换一个引擎（例如从 Codex 的会话分叉给 Claude 继续，走"摘要交接"而非原生 fork，弹窗里明确标注"跨引擎=摘要交接"）；
2. **文件隔离**：新 git worktree（默认开，所有可 fork 的编码子 agent 绑定 worktree）/ 共享工作区（需二次确认，警告冲突）；
3. **起点说明**：可选一句话作为分支的首个指令（"try a mutex instead"）。

结果：时间线上出现分支标记，原线程保持不变；分支选择器 `< 1/2 >` 可来回切换；Tree 视图出现新枝。
- 悬空 tool call 的合成结果由后端补齐，UI 只在分支起点处显示小标记"1 in-flight tool call was marked as cancelled in the branch"。
- 副作用账本提示见 §3.3。
- **反悔成本低**：分支可 Archive（保留日志不占列表）而不是删除；仅 Archive 超过 30 天且无引用时提示清理 worktree。

### 4.3 审批

**风险分级（决定 UI 形态）**

> **【评审】分级映射**：本表是 UI 展示用的 4 级，03-architecture §10.1 引擎内部为 R0–R5，以引擎为准、UI 只做折叠展示。UI-R0=引擎R0；UI-R1=引擎R1（worktree 内且有快照）；UI-R2=引擎R1（worktree 外）∪ R2（本地执行）∪ R3（非白名单出网）；UI-R3=引擎R4（对外副作用）∪ R5（凭据/管理）。“Balanced 只拦 R2/R3”即引擎对 R2–R5 与 worktree 外的 R1 返回 Ask。

| 级别 | 示例 | 默认策略 | UI |
|---|---|---|---|
| R0 只读 | 读文件、浏览公开网页 | 放行 | 不打扰，仅日志 |
| R1 可撤销写入 | 工作区内改文件（有 git 快照）、新建文件 | 放行但可回滚 | 时间线行内小标记 |
| R2 范围外写入/外网请求 | 写授权目录外、访问未授权域名、安装依赖 | 询问 | 行内审批卡，Allow once / Task / Always |
| R3 难以撤销 | git push、发邮件/消息、删除、付款、改系统配置、凭据使用 | 询问，强确认 | 突出审批卡 + 推送 + 生物识别（移动） |

规则：
- 只有 R2/R3 进入 Needs attention；**避免横幅盲区**（Muse 官方文章）。
- 卡片必备字段：谁（头像+名）、在哪台设备、要做什么（结构化命令/参数）、影响（Diff 摘要/收件人/金额）、为什么（agent 理由，标注"agent 自述"）、过期时间、可选的快速回复（让 agent 改方案而非简单拒绝：`Deny and tell why`）。
- **无人值守（cron/GitHub 触发、子 agent 自动流程）的审批一律自动拒绝**，并产出一条"被拒绝，等待你决定"事件，用户事后可一键"批准并重试"。
- 审批超时（默认 10 分钟）自动拒；超时后任务进入 blocked 而非 failed，可恢复。
- "Allow always" 生成可见、可撤销的规则，在 Settings → Permissions 列表中集中管理，规则有作用域（agent/设备/路径/命令前缀）。
- 审批结果是事件，进入审计账本（哈希链）。

### 4.4 回调通知（子 agent → 主 agent → 你）

事件流向：子 agent `TurnEnded / PermissionRequest / Error / BackgroundTaskEnded` → 事件总线 → Router（规则快路径 + 小模型慢路径）→ 判定"是否值得打扰" → UI。

| 事件 | 头像 | 时间线 | 收件箱 | 系统通知 | 主 agent 是否发话 |
|---|---|---|---|---|---|
| 子 agent 完成（常规） | done 一次后回 idle | 任务卡转绿 | Unread | 否 | 汇总进下一次对话，不主动打断 |
| 完成且用户在等（用户最近 5 分钟问过） | done | 任务卡 + 一句汇报 | Unread | 可选 | 是，一句话 |
| 需要审批 / 提问 | waiting | 审批/问题卡 | Needs attention | 是 | 一句话提示 |
| 失败/卡住 | blocked | 红色卡片 + 重试/改派建议 | Needs attention | 视设置 | 是 |
| 设备下线 | asleep | 系统行 | Unread | 仅当有运行中任务 | 是（影响任务时） |
| 外部触发（PR 等） | acknowledging → working | 系统行"PR #484 opened" | Working | 否 | 否（Observe 模式下只产生草稿） |

- **主动程度旋钮**：Quiet（只通知 Needs attention）/ Balanced（默认）/ Chatty（完成也通知）。
- **合并通知**：同一任务 60 秒内的多条事件合并成一条；批量处理积压事件时 Router 一次判定（02 报告：批处理积压事件）。
- **打扰预算**：每小时主动打断上限（默认 3 次），超限降级为静默落收件箱，避免噪声。

### 4.5 其他交互约定

- **Checkpoint**：自动在"测试通过/PR 创建/用户确认点/重大文件改动前"生成；用户可手动加。时间线中显示为带标签的分隔线。
- **撤销**：R1 写入有工作区自动 git 快照，时间线上每个文件改动行有 `Undo`。
- **成本**：输入框下方常驻迷你仪表（任务预算进度条）；超 80% 变黄并提示，超 100% 按设置暂停并走审批。
- **长任务可视化**：working 超过 60 秒，头像出现环绕进度光点；超过预估时长 2 倍触发"是否继续？"轻提示。
- **空状态**：每个页面空状态都用头像做主角并给出"一键示例"（例如 Triggers 空状态："Let Scout watch your PRs → [Try with a sample event]"）。
- **首次引导**（≤3 分钟闭环）：①给主 agent 起名并选形状/颜色（Grok Bot 的新建 Bot 体验）→ ②探测并授权本机 claude/codex →③配对第二台电脑（可跳过）→ ④发出第一个任务并看到头像从 acknowledging 进入 working。

---

## 5. 视觉风格方向（三个备选）

三套风格共享同一套 token 结构（颜色/圆角/间距/动效时长/字体），切换主题只换 token 值，不改组件。

### 方案 A：Pebble Studio（推荐默认）

- **气质**：柔和、圆润、有温度，像"一群住在你电脑里的小生物"；浅色为主，深色同样可用。
- **色板（草案）**：背景暖白 `#FAF8F5` / 深色 `#17161A`；面板 `#FFFFFF` / `#1F1E24`；主色（Pip 蓝绿）`#3DBDA7`；强调（求关注）`#4C7DFF`；成功 `#3FB950`；警告 `#E8A33D`；危险 `#E5534B`；子 agent 调色盘 12 色（饱和度统一、明度接近，保证头像并排时协调）。
- **形态**：大圆角（卡片 16px、按钮 12px、头像随形状）；轻阴影；卡片边界用 1px 低对比描边而非重阴影（降低 WebKit 渲染成本）。
- **字体**：UI 用 Inter 或 Geist（Latin）+ Noto Sans SC（中文，OFL 授权安全）；代码用 JetBrains Mono / Geist Mono。系统字体回退。
- **动效**：弹性缓动，时长 150~240ms；头像动画是主角，其余界面克制。
- **适合**：大众与办公用户、吉祥物主导的品牌感。风险：开发者可能觉得"太萌"，用方案 B 兜底。

### 方案 B：Mission Control（开发者/专业模式）

- **气质**：暗色、高密度、等宽字体为主、状态灯式的信息呈现，类似飞行控制台与 Linear/Vercel 暗色。
- **色板**：背景 `#0B0D10`；面板 `#12151A`；描边 `#222831`；主色荧光青 `#2DE2C4`；警告琥珀 `#FFB020`；危险 `#FF5C5C`；文字 `#D7DEE7` / 次级 `#8A94A3`。
- **形态**：小圆角（6~8px）；列表行高 28~32px；信息密度高；头像缩为 20~24px 且仅轮廓 + 眼睛（去掉配饰），状态靠眼睛与角标。
- **字体**：Geist Mono / JetBrains Mono 作为数据字体；中文 Noto Sans SC。
- **适合**：同时跑 5+ 子 agent 的重度用户、看板与 Diff 评审场景。可作为 A 的"Pro density"开关而非独立主题。

### 方案 C：Paper Office（办公向浅色）

- **气质**：纸张质感、编辑排版、衬线标题，像文档/笔记工具；产物（表格、文档、PPT）预览更像"一张纸"。
- **色板**：纸白 `#FBFAF7`；墨色 `#1F2328`；强调朱红 `#D9482B` 与墨蓝 `#2B4C7E`。
- **字体**：标题衬线（思源宋体/Noto Serif SC，OFL），正文无衬线。
- **适合**：以文档与办公产物为主的用户；与 05 报告的产物面板契合。风险：与"开发者控制台"气质冲突，建议仅作为可选主题。

### 5.1 推荐落地

- **默认 A（浅/深双模式）**，B 作为"Dense mode / Pro theme"，C 暂不做（后续按办公用户反馈）。
- 所有视觉通过 CSS 变量 + Tailwind theme 实现，设计 token 单源（`tokens.json` → CSS vars / Rive ViewModel 颜色），保证形象颜色、UI 颜色同步。
- 避免依赖 `backdrop-filter` 大面积毛玻璃与大量 CSS filter（Tauri 在 WebKit 内核上渲染性能与样式存在差异，07 报告 OpenCode 迁移案例）；所有视觉特性在 WebKit + Chromium 双内核截图回归测试中验证。
- 字体许可：HarmonyOS Sans、MiSans 等国产字体的商用条款本次**未核实**，默认只用 OFL 字体。

---

## 6. 组件库选型与前端架构

### 6.1 选型表

| 层 | 选择 | 理由 / 备注 |
|---|---|---|
| 框架 | React 19 + TypeScript + Vite | 生态资产（Markdown 流式、xterm、diff、React Flow、assistant-ui）最全；与 07 报告一致 |
| 样式 | Tailwind + CSS variables（token 单源） | 主题切换、WebKit 兼容可控 |
| 基础组件 | shadcn/ui（Radix 基础） | 代码拷入项目，可深度定制；已收编 AI Elements 模式 |
| Agent 界面模式 | shadcn AI Elements 模式（Message、Prompt Input、Reasoning、Tool、Plan、Queue、Task、Subagent、Checkpoint、Confirmation、Terminal、File Tree、Stack Trace、Test Results、Web Preview） | Vercel AI Elements 官方宣布 2026-11 末弃用并并入 shadcn/ui；**直接从 shadcn 新模式拷贝，已拷贝代码不受弃用影响**。artifact/sandbox/web-preview/workflow-graph/voice 无对应新模式，需自行拼 |
| 聊天原语 | assistant-ui（MIT） | BranchPicker（`useBranchPickerNext/Previous`）、external-store 运行时可接自有事件流和分支模型；自托管线程存储，不用其 Cloud |
| 协议/事件 | 内部事件类型对齐 AG-UI（含 `SUBAGENT_*`、`parentRunId`）| 第三方前端易接入；北向适配输出 |
| 分支树/拓扑 | @xyflow/react（React Flow，MIT）+ dagre/elkjs 自动布局 | Pro 示例属付费条款，不使用 |
| 虚拟列表 | TanStack Virtual | 时间线/事件流成千上万条 |
| Markdown | streamdown（流式 Markdown，07 报告选型）+ 代码高亮 | 流式渲染性能 |
| 终端 | xterm.js | |
| 代码/Diff | CodeMirror 6；Diff 视图用成熟开源 diff 组件（候选 react-diff-view / @git-diff-view，**许可与维护状态需选型时核实**）| 行级评论、hunk 级 stage/revert 为自研包装层 |
| 动画 | Rive（`@rive-app/react-*`）、Motion（微交互）、dotLottie（小图标）| Rive 运行时 MIT；不要为"纯 Rust"押注 rive-rs（08 报告） |
| 3D（可选） | three-vrm + Three.js/TresJS | 仅 L2 |
| 状态管理 | Zustand + 事件日志 reducer（`deriveXxx(events)` 纯函数投影）| UI 状态是事件的投影，可测试、可回放 |
| i18n | i18next；中英双语起步 | 文案抽离，避免硬编码 |
| 图标 | Lucide（ISC，shadcn 默认）| |
| 测试 | Playwright（WebKit + Chromium 双内核）+ Storybook 视觉回归 | Tauri 的 WebKit 兼容性当一等风险 |

### 6.2 前端架构要点

1. **UI 只依赖协议**：通过 WS 事件流与 Rust daemon 通信，使用生成的 TS 协议包；不直接 `invoke` Tauri command（07 报告建议）。这样壳可换 Electron / Tauri 3 CEF。
2. **事件批量**：daemon 侧 16~32ms 批量下发（参考 desktop-cc-gui `event_sink.rs`），前端用 `requestAnimationFrame` 合批 reducer，避免流式 token 导致每帧多次渲染。
3. **时间线渲染**：虚拟化 + 增量 Markdown；工具调用/子 agent 卡片折叠时不渲染内部内容。
4. **断线重连**：事件带单调序号，重连后 `resume(last_event_seq)` 补拉，UI 显示"重新同步中"但不清屏。
5. **离线/弱网（移动）**：审批操作入本地队列并带 `request_id` 幂等，恢复后重放；过期审批显示"已过期"。
6. **头像渲染层**：`AvatarRenderer` 接口（SVG / Canvas2D / Rive / VRM 四后端），见 §10.6。

---

## 7. Agent 花名册设计

### 7.1 条目结构

```
(o) Coder-1        [codex] [@work-pc]          10:21
    ▸ reading logs for flaky test…                ◐ $0.21
```

- 第一行：头像 + 名字 + 引擎徽标（纯文字小胶囊，不用第三方品牌图标）+ 设备胶囊 + 最近活动时间。
- 第二行：当前动作一行（`▸` 前缀），无任务时显示最近一句话；右侧注意力徽标/成本。
- 分组（Section）：Main（置顶）/ Projects（用户自定义分组，如"客户 A"）/ Ephemeral（临时子 agent，完成后 24h 自动折叠）/ External（外部引擎 agent）。
- 支持：Pin、隐藏、复制（复制设定但不含记忆，Grok Bot 做法）、拖拽排序、批量归档。
- 悬停卡：当前动作详情、使用的技能、本任务成本、最近 3 条事件，附 `Steer` 快捷输入。
- 最多同时展示 50 个（超出折叠到"更多"），避免花名册膨胀。

### 7.2 子 agent 的生命周期可视化

| 生命周期 | 花名册表现 |
|---|---|
| 临时 spawn | 头像以"孵化"动画出现（从主 agent 头像分裂弹出），Ephemeral 区 |
| 常驻 | 用户可点"Keep"提升为常驻，进入 Projects 区 |
| 休眠 | asleep，闭眼灰化；被事件唤醒时先 acknowledging |
| 分支体（fork 出的） | 同形象缩小 90%，叠加分支角标 ⎇，与本体成对显示 |
| 外部引擎 agent（Claude/Codex） | 头像描边为虚线环（表示"外部进程"），详情页显示引擎版本与会话引用 |

---

## 8. 与系统架构的对齐点（给工程）

| UI 需求 | 后端要求 | 来源 |
|---|---|---|
| 头像状态 | 事件流可订阅，事件含 agent_id/turn_id/类型 | 02/08 |
| 插话待确认气泡 | `request_id` 幂等 + `expected_turn_id` 校验结果回传 | 02/03 |
| 分支副作用提示 | `side_effect_ledger` 查询 API（分支点前副作用列表）| 02 |
| 能力矩阵显示 | AgentDriver 暴露 capabilities（steer/queue/fork 粒度/interrupt/background）| 03 |
| 设备指纹/路由 | 设备注册表含公钥指纹、路由类型 | 06 |
| 审批卡结构化字段 | 审批请求为结构化 payload（actor/device/command/impact/risk/expires）| 05/06 |
| 成本仪表 | 事件携带 token/cost，任务级预算在内核强制 | 01/05 |
| 回放 | 事件日志不可变、可按序号重放；回放模式隔离副作用 | 02 |
| Router 判定可见 | 快/慢路径判定写入事件 | 02 |

---

## 9. 状态模型与"事件 → 头像状态"映射

### 9.1 统一状态词汇（UI/头像/看板共用）

| 状态 | 含义 | 看板列 | 注意力态 |
|---|---|---|---|
| idle | 空闲 | - | - |
| listening | 用户正在输入/语音 | - | - |
| acknowledging | 刚收到新任务/事件（≤800ms 瞬态）| Queued/Working | - |
| thinking | 推理中 | Working | Working |
| working | 工具调用/子任务运行中 | Working | Working |
| waiting | 等待审批/用户输入 | Needs you | Needs attention |
| blocked | 失败/卡住/预算耗尽/设备掉线中 | Needs you | Needs attention |
| done | 完成（瞬态 3s 后回 idle，保留 Unread 徽标）| Done | Unread |
| asleep | 休眠/设备离线 | Offline | - |
| forking | 正在分支（瞬态 ~1s）| - | - |
| celebrating (可选) | 大任务完成/里程碑（瞬态）| Done | Unread |
| error-recovered (可选) | 自动重试后恢复 | Working | - |

对照：Grok Bot 的 idle/thinking/working/waiting/blocked/done；Linear 的 pending/active/error/awaitingInput/complete/stale；AI Elements Persona 的 idle/listening/thinking/speaking/asleep（见 08 报告 §2.5）。

### 9.2 投影函数（纯函数，可单测）

> **【评审】分工**：持久态（idle/thinking/working/waiting/blocked/done/asleep）与注意力态由 Hub 的 Rust `derive_presence` 权威计算并经 `presence` 消息下发（03 §14.5）；下面的 TS 函数是 **UI 侧薄层**，只负责叠加瞬态（listening/acknowledging/forking/celebrating）、600ms 最短停留与 300ms 防抖，二者共用同一份 golden JSONL 用例。原伪代码中的持久态判断仅用于说明优先级，不应在 UI 重复实现。

```ts
// 伪代码：事件 → 头像状态，优先级从高到低
function deriveAvatarState(events: AgentEvent[], now: number): AvatarState {
  const last = tail(events)
  if (isOffline(last))                          return 'asleep'
  if (hasOpenApprovalOrQuestion(events))        return 'waiting'
  if (hasUnrecoveredError(events) || budgetExceeded(events)) return 'blocked'
  if (withinMs(lastOf(events,'fork.created'), 1000, now))     return 'forking'
  if (withinMs(lastOf(events,'task.assigned'), 800, now))     return 'acknowledging'
  if (hasOpenToolCall(events) || hasRunningSubtask(events))   return 'working'
  if (isTurnActive(events))                     return 'thinking'
  if (withinMs(lastOf(events,'task.completed'), 3000, now))   return 'done'
  if (userIsTyping(events))                     return 'listening'
  return 'idle'
}
```

规则：
- **最短停留**：除瞬态外，状态变化需保持 ≥600ms 才切换，避免工具调用间隙造成头像抖动；`thinking↔working` 之间加 300ms 防抖。
- **优先级固定**：waiting/blocked > working > thinking > 瞬态 > idle。多个事件并发时只显示最高优先级。
- **注意力态与头像态分离**：注意力徽标由"收件箱未处理项"决定，即使头像回到 idle，Unread 仍保留，直到用户查看。
- 花名册里所有头像共用一个 rAF 调度器，不可见头像（滚出视口）暂停动画。

---

## 10. 智能体形象系统

### 10.1 设计前提

- 参考 Grok Bot 的成功经验（"简单形状 + 富表现力的眼睛 + 受控变体"）与其 Companions 的失败教训（写实/重 3D 成本高、效果不稳）。
- **不模仿** Grok Bot 的具体形状 + 双斜杠眼睛组合；本项目通过"天线芽（sprout）"与"圆珠眼 + 眼睑"建立自己的识别度。
- 头像必须在 **20~32px** 可辨（侧栏/看板），在 **96~256px** 有表现力（头部、Takeover、引导页），在 **512px+** 可作营销主视觉。

### 10.2 角色设定：主 agent "Pip"

> 以下为设计简报（给画师/设计师的 brief），非最终美术。

- **物种**：Pip 是"住在你电脑里的小芽灵"——一颗圆润的小卵石（pebble）身体，头顶一根会发光的细天线，天线尖是一枚小芽/小灯泡（"sprout"）。灵感来自"种子/节点/信号"，对应"网格中心节点 + 轻量主管"的产品含义。
- **性格**：好奇、可靠、话少但清楚；做事前先点头确认，做完不邀功；遇到风险会"歪头"征求意见（避免谄媚与过度热情，呼应用户对"进度谎报"的痛点：Pip 的汇报永远具体）。
- **口吻**：短句、先结论后细节；不用颜文字刷屏；允许用户通过 Soul（人设文件）调整。
- **识别元素（品牌资产，三个必须固定）**：①卵石轮廓 ②头顶天线芽 ③圆珠眼 + 可动眼睑（眼睛是情绪与状态的主载体）。
- **配色**：主色 Pip 蓝绿 `#3DBDA7`，眼睛高光为白，天线芽颜色随状态变化（空闲=蓝绿、求关注=蓝、完成=绿、阻塞=琥珀/红）。
- **形象禁区**：不拟人化到有手有脸的人形；不使用 Clawd/Codex 云/Cursor 方块等邻近图形；吉祥物与名称提前做商标检索（OpenClaw 前身 Clawd 因 Anthropic 商标请求两度改名的前车之鉴）。

### 10.3 主 agent 与各子 agent 的形象区分

**一个物种，多个品种**：所有 agent 共享"圆珠眼 + 眼睑 + 天线芽"的基本构造（保证同一个"世界观"），通过四个可控维度区分：

| 维度 | 取值 | 表达什么 |
|---|---|---|
| 形状（Body） | pebble（主）/ squircle / capsule / droplet / cloud / hexagon / arch | **职能大类** |
| 颜色（Hue） | 12 色盘，按 agent ID 种子生成默认值，用户可改 | **个体身份** |
| 配饰（Accessory） | 头盔、护目镜、小帽、耳机、领结、放大镜、小扳手、围巾… | **角色细分/个性** |
| 天线（Antenna） | 芽 / 小灯泡 / 双叶 / 无（外部引擎无芽，改用"插头"）| **来源**（内置/外部）|

**职能 → 形状映射（默认值）**

| 子 agent 类型 | 形状 | 默认配饰 | 示例 |
|---|---|---|---|
| 主 agent（Router）| pebble（略大、唯一带发光天线芽）| 无 | Pip |
| 编码 agent | squircle | 护目镜 / 小头盔 | Coder-1 |
| 外部引擎（Claude/Codex/OpenCode 等）| 与职能一致，但外轮廓为**虚线环** + 天线改为"插头" | 引擎字母小徽章（纯文字，如 `cx`、`cl`）| ClCd |
| 研究/浏览器 agent | droplet 或 cloud | 放大镜 / 指南针 | Rsch |
| 办公/文档 agent | capsule | 眼镜 / 铅笔 | Writer |
| 监控/Watchdog | hexagon | 小盾牌 / 耳机 | Watch |
| 分支体（fork）| 同本体缩小 90% | 叠加 ⎇ 角标，颜色明度 +10% | Coder-1b |
| 设备（非 agent）| 不用角色头像，用"小房子/机箱"图标 | - | work-pc |

**识别性保证**：
- 在 24px 下，形状 + 颜色双通道必须可辨，配饰仅在 ≥48px 显示；
- 颜色不是唯一通道：形状、虚线环、角标共同区分，满足色觉障碍可用；
- 相同形状颜色冲突时，系统自动在色盘内选择距离最远的色相（按已存在 agent 集合）；
- 外部引擎 agent 的品牌合规：**不使用任何第三方官方 logo 和 "Claude Code" 品牌**，仅文字胶囊 `claude`/`codex` 标示引擎（见 03 报告合规条款；条款细节引用以官方最新页面为准，**本文未再次核实**）。

### 10.4 状态动画清单（规格）

> 时长为建议值，最终以设计师/动效评审为准。所有动画必须支持 `prefers-reduced-motion`：降级为静态姿态 + 角标，无位移无闪烁。

| # | 状态 | 眼睛 | 身体 | 天线芽 | 角标 | 循环 | 时长 |
|---|---|---|---|---|---|---|---|
| 1 | idle | 缓慢眨眼（4~7s 随机），偶尔环顾 | 呼吸式 1~2px 微动 | 轻摆 | 无 | 循环 | 4s |
| 2 | listening | 瞳孔放大，视线朝输入区 | 前倾 3° | 竖直、微亮 | 无 | 循环 | - |
| 3 | acknowledging | 快速睁大 → 恢复 | 点头一次 | 闪一下 | 无 | 单次 | 500ms |
| 4 | thinking | 眼睛上扬，视线游移 | 缓慢左右摇 | 呼吸式明暗 | 三点 | 循环 | 1.6s |
| 5 | working | 专注（眼睑下压 20%）| 节奏性律动（对应工具调用节拍）| 旋转光点绕芽 | 进度环（长任务）| 循环 | 1.2s |
| 6 | working-long（>60s）| 同 5 | 同 5 | 光点轨道变大 | 环绕圈 | 循环 | 2s |
| 7 | waiting | 眼睛睁圆，看向用户 | 轻轻起伏，间歇"歪头" | 闪蓝光 | 蓝点（Needs attention）| 循环 | 2.4s |
| 8 | blocked | 八字眼/斜眼 | 微下沉，抖动一次后静止 | 芽低垂 | 琥珀/红色三角（图形，不只靠色）| 单次 + 静止 | 700ms |
| 9 | done | 弯眼微笑 | 小跳 + 环绕圈一次 | 芽绽放（变绿）| 绿勾（保留至已读）| 单次 | 900ms |
| 10 | celebrating | 星星眼 | 小旋转 + 撒点 | 芽绽放大 | - | 单次 | 1.5s |
| 11 | asleep | 闭眼 | 缩小 90%、下沉 | 芽收拢、灰 | 灰 z | 循环（极慢）| 5s |
| 12 | forking | 眼睛双影 | 分身：残影分裂为二各自就位 | 双芽 | ⎇ | 单次 | 900ms |
| 13 | error-recovered | 眨眼 + 点头 | 抖一下恢复 | 芽闪黄再回蓝 | - | 单次 | 600ms |
| 14 | speaking（语音，L2）| 眼睛随音量微动 | 口型占位 | 随音量脉动 | 声波 | 循环 | - |

**迁移规则**：状态机显式定义允许的转换及混合时长（`idle→working` 经 `acknowledging`；`working→waiting` 用 200ms 交叉淡化；`any→asleep` 慢速）。

### 10.5 L0 参数化渲染（MVP 必做）

- **参数结构**（可序列化为 JSON，存于 agent 配置，也可导出分享）：

```json
{
  "body": "squircle",
  "hue": 168,
  "eyes": "bead-round",
  "accessory": "goggles",
  "antenna": "sprout",
  "ring": "none | dashed(external)",
  "seed": "agent_01HZ..."
}
```

- **组合空间**：形状 8 × 色 12 × 眼型 6 × 配饰 ~12 × 天线 4 ≈ 数万种，足够子 agent 增殖。
- **渲染**：SVG 单文件组件，眼睛与天线芽独立图层，状态通过 CSS/Web Animations 驱动；<48px 退化为"轮廓 + 眼睛 + 角标"。
- **种子**：由 agent ID 哈希确定默认形状/色/眼型，保证同一 agent 在各设备上外观一致。
- **兜底**：用户上传自定义图片（<25MB）或文生图结果时，仍套一个状态环与角标，保证状态可读（Grok Bot 的 Bot/Generate/Upload 三来源模式）；DiceBear CC0 风格仅用于"批量临时 agent"的极简兜底，代码本地生成，不调用其托管 API。

### 10.6 Rive 状态机（L1 主 IP 与高保真头像）

**文件组织**
- `pip_main.riv`：主 IP（Pip）一个 artboard；
- `agent_base.riv`：通用子 agent 一个 artboard，用 ViewModel 枚举切换形状/配饰（Rive Data Binding）；
- 所有 `.riv` 自制或买断，**不复用 AI Elements Persona 的 Vercel Blob `.riv`（授权未明）**。

**状态机设计（State Machine 名：`agent`）**

| 输入类型 | 名称 | 说明 |
|---|---|---|
| Number | `mood` | 0 idle / 1 listening / 2 thinking / 3 working / 4 waiting / 5 blocked / 6 done / 7 asleep（持续态）|
| Trigger | `ack` | 触发 acknowledging 瞬态 |
| Trigger | `celebrate` | 触发 celebrating |
| Trigger | `fork` | 触发分身 |
| Trigger | `recover` | 错误恢复 |
| Boolean | `longRunning` | working 轨道变大 |
| Boolean | `reducedMotion` | 降级静态姿态 |
| Number | `intensity` | 0~1，音量/强度（语音态）|
| ViewModel | `color`、`shape`(enum)、`accessory`(enum)、`ring`(bool)、`eyeStyle`(enum) | 数据绑定外观 |

- **层结构**：Layer 0 = 持续情绪（`mood` 驱动 blend/transition）；Layer 1 = 眨眼与随机环顾（独立定时器层，避免与情绪层耦合）；Layer 2 = 瞬态叠加（ack/celebrate/fork/recover，播完回到 Layer 0）。
- **渲染与性能**：
  - Rive Web 运行时按画布创建 WebGL 上下文；AI Elements Persona 源码注释显示 React Strict Mode 双挂载会耗尽 WebGL2 上下文 → **花名册/看板小头像不用 Rive**，改用 L0 SVG/Canvas2D；Rive 只用于：窗口顶部主 agent 头像、Agent 详情、Takeover、引导页、桌面宠物（同时最多 ~4 个 Rive 画布）。
  - 若要在列表中也用 Rive 质感：离线把 Rive 各状态**预渲染为精灵图/WebM 小循环**，运行时用 CSS sprite 播放；或评估共享单画布。（均需实测，**未验证**）
  - 不可见时暂停（IntersectionObserver）；`prefers-reduced-motion` 时只渲染静态帧。
- **颜色同步**：UI token → Rive ViewModel `color`，暗/亮主题自动切换（Persona 使用 `useViewModelInstanceColor` 的同类做法）。
- **Rive 许可成本**：运行时 MIT，无版税；编辑器免费版导出带启动画面，Cadet 约 $9/席/月（官网定价页，另一页文档写法不一致，购买前以官方为准）。MVP 阶段可全部走 L0，延后 Rive。

### 10.7 `AvatarRenderer` 抽象

```ts
interface AvatarRenderer {
  mount(el: HTMLElement, params: AvatarParams, size: number): void
  setState(state: AvatarState, opts?: { longRunning?: boolean }): void
  trigger(name: 'ack' | 'celebrate' | 'fork' | 'recover'): void
  setReducedMotion(on: boolean): void
  setVisible(v: boolean): void   // 不可见时暂停
  dispose(): void
}
// 实现：SvgRenderer (L0, 默认) | CanvasRenderer (大量并发) | RiveRenderer (L1) | VrmRenderer (L2)
// 语义状态 → 渲染后端的映射表放在单一文件，借鉴 AIRI 的 emotions.ts 范式
```

### 10.8 桌面悬浮宠物与托盘（P4）

- 透明置顶小窗，显示主 agent；**悬停时整窗淡出并将点击穿透到下层**（AIRI 的 Fade on hover 方案，快捷键开关）；
- 状态同步：waiting 时蹦跳 + 气泡一句话；done 时撒花；用户拖动可吸附屏幕边缘；
- 托盘图标 = 主 agent 头像的 16/32px 单色版 + 状态点；
- 默认关闭，不做全屏游戏检测以外的任何自动弹出（避免打扰）。

### 10.9 L2：语音/伴侣模式（后置）

- 2D/3D 选 **VRM + three-vrm**（MIT）；模型限用自制/CC0/授权清晰的 VRM，加载时读取 `VRM1Meta`（avatarPermission、commercialUsage、creditNotation）并在 UI 提示；
- 不提供"在线捏人工具"（VRoid 条款禁止基于其产物做创作工具类应用，需另行授权）；
- Live2D 暂不做（Expandable Application 审批与收入分成要求）；
- 语音：实时语音模式下头像与波形并排，三档显示（语音 only / 头像并排 / 全屏）参考 Muse，但不做视频生成式头像。

### 10.10 资源获取与制作路径

| 资产 | 路径 | 优先级 | 备注 |
|---|---|---|---|
| L0 参数化角色（形状/眼型/配饰/状态动画）| 自研（设计师 1~2 周 + 前端 1~2 周）或工程师自己用 Figma/SVG 做 | P0 | 零授权风险 |
| 主 IP Pip（三视图、≥6~12 表情差分、PSD/AI 分层源文件）| 国内：米画师（mihuashi）买断；海外：Dribbble/Behance/Fiverr 外包。先用 AI 工具出概念稿，**终稿请画师重绘并买断** | P1（并行）| AI 生成物著作权归属有法律不确定性；各 AI 平台免费版条款多不可商用（Tripo 免费版仅非商用；Meshy 免费版 CC BY 4.0 须署名；即梦商用规则模糊），仅用于概念探索 |
| Rive 绑定与动画 | 画师/动效师在 Rive 中完成，或工程师依据 §10.4 规格绑定 | P1 | 要求交付 `.riv` 源与可编辑工程 |
| 状态图标/徽标 | 自绘 SVG；或 Fluent Emoji（MIT）、Noto 动画 Emoji（CC BY 4.0，须署名）| P0 | 避免 OpenMoji（CC BY-SA，对闭源不友好）|
| 默认子 agent 兜底头像 | DiceBear CC0 风格（shapes/glass/thumbs/identicon/initials 等），本地生成 | P0 | 避开 bottts/avataaars 等艺术家自拟条款 |
| 品牌手册 | 画师交付 + 内部补充（用法、禁用、安全边距、最小尺寸）| P1 | 避免社区"收养"出多个不一致版本（Clawd 的教训）|
| 3D/语音伴侣模型 | VRoid Studio 自制 + 官方 CC0 样例 | P4 | 见 §10.9 |
| 商标/域名检索 | 律师或在线商标库；国内 + 美国 | 立刻 | 吉祥物与名称分开检索 |

**外包 brief 清单（给画师）**：风格关键词（圆润、克制、有点好奇）、必须包含的三个识别元素、不得相似的参照（Clawd、Grok Bot 形状与斜杠眼、Codex 云、Cursor 方块）、交付物（三视图、表情差分、小尺寸版 24/32/48px 可读性测试稿、PSD/AI 分层、著作权财产权转让条款、署名权说明）、最小可读性要求。

### 10.11 预算估算

> 所有金额为**估算**，米画师报价来自 2026 年挂牌需求示例（¥500~5000 量级、手续费 5%），复杂 IP + 绑定的真实报价需询价；其余需实际询价，未核实。

| 项 | 方案 | 估算 | 备注 |
|---|---|---|---|
| L0 角色系统设计 | 自研/自由设计师 | ¥0~8,000 | 取决于是否外请；内部做则为人力成本 |
| L1 主 IP 买断 | 米画师买断 + 三视图 + 表情差分 | ¥2,000~10,000（估）| 需询价；复杂 IP 可更高 |
| Rive 动画绑定 | 外包动效师或内部 | ¥3,000~15,000（估）或内部 1~2 周 | 视状态数量与精度 |
| Rive 订阅 | Cadet | 约 $9/席/月 × 1~3 席 ≈ $108~324/年 | 以官网为准 |
| AI 概念稿 | 订阅类工具 | ≈ $20~60/月，仅阶段性使用 | 仅概念探索 |
| 商标注册（吉祥物 + 名称）| 国内/美国 | 需询价 | 未核实 |
| L2 语音/VRM | 自制 VRoid + 引擎开发 | 人力为主 | 后置 |
| **合计（不含人力、不含商标）** | L0 + L1 + Rive | **约 ¥5,000~30,000 量级** | 主要变量是主 IP 与动效外包 |

---

## 11. 无障碍、国际化与性能

**无障碍**
- 状态不能只靠颜色：形状/眼睛/角标/文字（ARIA label 如 "Coder-1, working, needs your attention"）共同表达；
- 键盘全可达：花名册 `↑↓`、切换 agent `Alt+1..9`、命令面板 `Ctrl/Cmd+K`、批准 `Ctrl+Enter` 于聚焦审批卡时、拒绝 `Esc`；
- `aria-live`：Needs attention 事件用 assertive，完成类用 polite，批量合并避免刷屏；
- 对比度：正文 ≥ 4.5:1，两套主题均检查；
- `prefers-reduced-motion`：关闭位移/闪烁/持续动画，仅保留静态姿态与角标；
- 动画安全：禁止 >3Hz 闪烁。

**国际化**：中英双语起步；日期时间本地化；中文字体栈 `Inter, "Noto Sans SC", system-ui`；国内渠道文案（微信/飞书/钉钉）在 v1.5 加入；模型选择器对 Kimi/GLM/MiniMax/DeepSeek/Qwen 一等展示。

**性能预算（待实测）**
- 时间线 10k 事件滚动 ≥ 55fps（虚拟化）；
- 流式输出批量渲染，单帧脚本时间 < 8ms；
- 花名册 50 个头像并发动画 CPU 占用 < 5%（不可见暂停 + 共享 rAF）；
- 冷启动到可交互 < 2s（壳 + daemon 已运行时）。

---

## 12. 分阶段落地与验收

> **【评审】编号对照**：本节的 P0–P4 是 UI 工作包编号，与 PRD/架构的里程碑不同。对照 05 的里程碑：UI-P0 ≈ M1 前半；UI-P1 ≈ M1 后半；UI-P2 中的“远程浏览器 Status/Preview/Takeover”属 M4，其余（设备页、触发器页、PWA 审批）≈ M2；UI-P3（Rive 主 IP、Goals、Library、渠道）≈ M4 及之后；分支树的完整 React Flow 视图 MVP 先用列表（02 §7.2 S7 已写“可简化为列表”）。

| 阶段 | 周期 | 交付 | 验收 |
|---|---|---|---|
| P0 | 1~2 周 | 事件 → `deriveAvatarState` → L0 SVG 头像 → 花名册 + 三种注意力态 + 收件箱骨架；design token；双内核 CI 骨架 | 同时跑 5 个子 agent（可用模拟事件源），侧栏一眼看出谁在干活、谁在等我 |
| P1 | 2~4 周 | 主视图异构时间线、任务卡、审批卡（R0~R3）、插话/排队/中断、右栏 Diff/Terminal、Checkpoint + 分支选择器、worktree 模式 | 对 Claude/Codex 子 agent 完成"派发 → 插话 → 评审 → PR"；可从任意 Checkpoint 分支；审批超时自动拒 |
| P1.5 | 并行 | 主 IP 外包启动；品牌手册；商标检索 | 拿到概念稿并评审 |
| P2 | 4~8 周 | 看板、分支树（React Flow）、回放 scrubber、设备页与配对、触发器页（cron + GitHub，observe 模式）、远程浏览器 Status/Preview/Takeover、移动端 PWA 审批 | 事件日志可回放；断线重连补拉；远程浏览器可接管再交还；手机批准一次 R3 操作 |
| P3 | 6~10 周 | Rive 主 IP 上线、技能市场精简版、Goals、Library、渠道（微信/飞书/钉钉）| 主形象替换 L0 默认主角；技能安装有权限确认 |
| P4 | 可选 | 悬浮宠物、语音/VRM 伴侣 | 参考 AIRI |

**设计验证方法**：
- 5 秒测试："打开界面 5 秒内，用户能否指出谁在等我、谁在干活？"；
- 插话误操作率：用户是否曾因 Enter=steer 误发？（若 >5%，改为可配置默认）；
- 审批疲劳指标：每日 R2/R3 审批次数与"Allow always"占比；
- 头像可辨度：24px 下 12 个并列 agent 的识别正确率 ≥ 90%；
- 双内核截图回归：WebKit（macOS/Linux Tauri）与 Chromium（Windows WebView2）像素差在阈值内。

---

## 13. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| 形象与 Grok Bot 过于相似 | 品牌/法律 | 固定三元素（卵石 + 天线芽 + 圆珠眼）；不用斜杠眼；商标检索；画师 brief 明确禁区 |
| Rive 大量实例耗尽 WebGL 上下文 | 花名册卡顿/崩溃 | 小头像走 SVG/Canvas2D；Rive 仅限少量大头像；预渲染精灵备选；实测 |
| WebKit 渲染与样式差异（Tauri）| 视觉不一致、性能问题 | 避免重毛玻璃；双内核 CI；保留 Electron 回退 |
| 通知噪声 → 用户关闭通知 | 失去审批通道 | 打扰预算 + 合并 + 主动程度旋钮；Needs attention 永远在侧栏可见 |
| 审批疲劳 → 用户一路 Always | 安全形同虚设 | 只拦 R2/R3；Always 规则需作用域；定期审阅提示；规则可见可撤销 |
| 插话降级让用户误以为生效 | 信任受损 | 不静默降级，气泡标注实际语义 |
| 外部引擎品牌/条款 | 合规 | 中性文字标示；不使用 Claude Code 品牌/图标；Codex clientInfo 登记；上线前复核官方条款 |
| 免费/AI 素材授权不清 | IP 风险 | 终稿人类画师买断；不直接复用社区素材；不复用 Persona `.riv` |
| 事件量大致时间线卡 | 体验差 | 虚拟列表、折叠子 agent 内容、批量渲染、事件摘要镜像 |
| AI Elements 弃用 | 维护 | 直接拷贝 shadcn 新模式并 vendoring，锁定版本 |

---

## 14. 待拍板问题与项目代号

### 14.1 项目暂定代号

**评审后口径**：产品工作代号 = **Muster**（全文档统一），**Pip = 主 agent 的默认名字/吉祥物名**；下面讨论的是“Pip 是否也适合作为对外品牌名”。原稿暂定：Pip（同时也是主 agent 的默认名字）。理由：短、好读好记、中英文都顺口、与"小而灵、轻量主管"的定位一致。**以下候选均未做商标/域名检索**，在公开使用前必须检索：

| 候选 | 含义 | 优点 | 风险 |
|---|---|---|---|
| **Pip**（暂定）| 种子/小芽，也是 Python 包管理器名 | 短、可爱、与天线芽形象一致 | 与 Python `pip` 搜索冲突，SEO 差 |
| **Nodi** | node + 可爱后缀 | 呼应"节点/设备网格" | 可能撞已有品牌 |
| **Tandem** | 多个 agent 协同 | 含义贴合"多 agent 协作" | 英文常见词，商标拥挤 |
| **Sproutly** | sprout + ly | 与天线芽直接相关，品牌感强 | 偏"植物/育儿"联想 |
| **Hive-pip / 芽芽（中文名）** | 中文主名候选"芽芽"/"小芽" | 中文亲切、易传播 | 需配套英文名 |

建议：中文名"小芽"+ 英文代号 Pip 先用于内部，检索通过后再定；若 Pip 冲突，次选 Sproutly。

### 14.2 待用户拍板

1. **形象调性**：同意"卵石 + 天线芽 + 圆珠眼"的小生物方向吗？还是想要更偏"机器人"（金属感）或更偏"吉祥物"（动物）？（影响 L1 画师 brief）
2. **视觉默认主题**：A（Pebble Studio）为默认、B 为密度模式，是否接受？C 是否需要？
3. **是否做 Goals 与 Library**（v1.5）以及 Feed/Ideas 是否永远不做？
4. **插话默认键位**：`Enter = steer` 是否会让你误发？或改为 `Enter = 发给主 agent / 排队`、`Ctrl+Enter = 插话`？（本文选前者，倾向"运行中输入框就是插话框"）
5. **移动端形态**：先 PWA 遥控器（本文建议）还是直接 Tauri Mobile？是否需要 iOS 推送优先？
6. **品牌预算**：L1 主 IP 买断 + Rive 绑定总预算上限？是否接受先以 L0 上线、主 IP 后续替换？
7. **语音/伴侣模式**是否纳入路线图？VRM 路线是否可接受（不做 Live2D）？
8. **语言与市场**：中文优先还是全球同步？影响画师渠道、渠道接入（微信/飞书/钉钉）与文案。
9. **外部引擎在 UI 的展示**：中性文字标示（本文方案）是否可接受？是否愿意先向相关厂商确认品牌使用边界？
10. **默认审批严格度**：Balanced（只拦 R2/R3）是否合适？无人值守自动拒绝是否锁定为不可关闭？
11. **是否保留 Muse 式"一条永续主对话 + 侧聊"**，还是改成 Grok Bot 式"每个 agent 一个会话"为主？本文采用"主 agent 永续主线 + 子 agent 各自线程 + 侧聊"。
12. **UI 框架是否锁定 React**（若团队偏 Vue/Svelte，需重估 assistant-ui/AI Elements 的复用度，AIRI 为 Vue 栈）。

---

## 15. 来源与置信度说明

- 竞品界面细节来自 08 报告（Meta Muse 官方设计文章 introducing.muse.ai 2026-09、Grok Bot 官方设计文章 x.ai/news/designing-grok-bot 2026-09-03、Linear AIG、Codex app、Cursor 3、Manus 等）；其中第三方粉丝站/评测的具体数字（如"8 形状 12 颜色 16 表情 15 动画"）为**非官方、未证实**。
- 协议能力映射（steer/queue/fork/interrupt）来自 03/02 报告对 Codex app-server、Claude Agent SDK、ACP、OpenCode 的源码级调研。
- 设备配对/浏览器分级来自 06 报告；其中 OpenClaw 源码位置原为 DeepWiki 转述，已在 01 报告中由其他任务读码佐证。
- 风格方案 A/B/C 的色值与字体、预算数字、性能目标、快捷键默认值均为**本文设计建议/估算**，非调研事实，需设计评审与实测确认。
- Web Push 在 iOS 上的限制、Rive 在列表中的并发上限、共享画布可行性：**未验证**，需要 PoC。
- 本文未做的事：未制作任何实际美术资源；未对 Claude/ChatGPT 桌面端做截图级体验调研（08 报告已说明）；未核实字体（HarmonyOS Sans/MiSans）与 diff 组件库的许可。
