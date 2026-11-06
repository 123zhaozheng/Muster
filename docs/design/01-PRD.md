# 产品需求文档（PRD）——工作代号 Muster

> 版本：v0.1 草案（已经 05-review 评审修订）　日期：2026-11-06　状态：待拍板
> **代号统一（评审结论）**：产品工作代号 = **Muster**（与 03-architecture 的 crate/二进制前缀一致）；主 Bot 的默认名字/吉祥物 = **Pip**（见 04）。Colony/Roster 仅作为对外品牌候选保留在 §20，均未做商标检索。里程碑与 MVP 范围以 `05-review-roadmap.md` 为准。
> 输入：`docs/research/01~08` 八份调研报告。本文只引用其中已核实结论；调研里标为“未证实”的内容在本文同样标注，不作为设计前提。
> 术语：**Bot** = 花名册中一个有名字、有形象、有状态的智能体（可以是主 agent、内置子 agent 或外部编程 agent）；**Node** = 一台被纳入网格的电脑/VM/浏览器；**Hub** = 用户自己的核心 daemon（Rust）；**事件** = 系统里一切输入的统一信封。

---

## 0. 摘要（给决策者的 1 分钟版）

- **做什么**：一个开源、可自托管、默认安全的个人 Agent 网格。用户有一个常驻的“主 Bot”，它很轻，只做分发；真正干活的是一群**有状态、可分支、可插话**的子 Bot——包括自带的，也包括用户本机的 **Claude Code、Codex、OpenCode、Goose** 等外部编程 agent。用户的多台电脑、云 VM、远程浏览器统一成一张“网格”。
- **为什么现在**：2026-09 Meta Muse（吉祥物 Jolly，Muse Spark 模型）、Grok Bot、OpenAI dots、Claude Cowork/Dispatch 等把“有名字有形象的常驻 Agent + 自己的电脑 + 24/7 + 审批”做成了消费级范式；开源侧 OpenClaw（约 39.4 万 star）和 Hermes Agent（约 26 万 star）验证了需求，但存在安全（60+ CVE、技能市场投毒、默认沙箱关闭）、成本不透明、调教门槛高、对大厂隐私不信任等痛点。2026-10-31 DeepSeek Harness 团队发布的 Super-agent 设计文章给出了“Router/Worker + 事件化 Trigger/Thread”的清晰架构方向。
- **怎么赢**：不与 Meta 拼模型和云，拼**“你自己的机器 + 你自己的编程 agent + 可审计的安全 + 透明成本 + 有趣的状态化形象”**。
- **怎么做**：Rust 核心 daemon + 协议化薄 UI 壳（Tauri 2 + React），内部自建 Thread/Turn/Item/Event 事件模型，南向 ACP + Codex app-server 原生驱动外部 agent，Agent 内核阶段一基于 DeepSeek Harness（MIT）或自建薄内核（见 §15 待拍板）。
- **v1 范围收敛**：联系人式 UI + 3 个外部编程 agent 子 Bot + 2 台以上电脑配对 + 审批卡 + cron 与 GitHub PR 事件触发 + 分支/插话。Goals/Feed/硬件/语音伴侣后置。

---

## 1. 产品定位

### 1.1 一句话价值主张

> **“你的电脑们、你的编程 agent 们，由一个会说话、会表情、你能随时插话和分叉的 Bot 团队统一管起来——开源、可自托管、每一步都可审计。”**

英文版：*Your machines and your coding agents, run as one crew you can steer, fork and audit.*

### 1.2 定位陈述

| 维度 | 定位 |
|---|---|
| 品类 | 个人 Agent 指挥台（Agent Mesh + Bot 花名册），不是聊天机器人，也不是又一个 IDE |
| 与 Muse/Grok Bot 关系 | 对标其“常驻 Bot + 形象即状态 + 审批卡 + 电脑可见”的交互范式，但**算力在用户自己的机器上** |
| 与 OpenClaw/Hermes 关系 | 借鉴其 Gateway/Node 协议设计，但**安全默认值反转**、内核更薄、外部编程 agent 为一等公民 |
| 与 Claude Code/Codex 关系 | **不竞争，做它们的指挥层**：它们是子 Bot，由本产品调度、观察、插话、分叉、审批 |

### 1.3 “Muse”澄清（调研结论）

用户所指 Muse 最可能是 **Meta Muse**（2026-09-08 发布的个人 AI Agent，吉祥物 Jolly；每用户一台云 VM，Agent 跑在 systemd-nspawn 容器内，凭据服务/安全分类器/Sentinel 权限裁决在容器外，Agent 仅拿凭据替身）。其他同名项（Microsoft Muse 游戏模型、Muse Group、Muse 头环、原 muse.ai 等）已排除；开源仿品有 OpenMuse（CopilotKit）等。“grokbot”指 xAI 的 **Grok Bot**（2026-08-11 beta），而不是已下线的 Grok Companions。

### 1.4 产品原则（用于评审时判定取舍）

1. **主 Bot 极薄**：不执行任务、不挂 Bash，只做过滤、路由、汇报；重活一律交给子 Bot。
2. **一切皆事件**：用户输入、定时、PR/Webhook、子 Bot 回调、节点上下线、审批结果同构，持久化、可重放、可审计。
3. **子 Bot 是有状态的会话**，不是一次性函数：可分支（fork）、可插话（steer）、可打断（interrupt）。
4. **默认安全**：执行默认询问；凭据不进模型上下文；无人值守触发的审批默认拒；主动行为默认 observe。
5. **形象即状态**：头像的表情和动效是 UI 的状态指示器，不是装饰。
6. **成本透明**：每个任务有预算、有仪表、有熔断。
7. **不造轮子**：不自研打洞/relay/远程桌面/浏览器内核/Agent 协议；组合 ACP、MCP、iroh、Playwright、CDP 等成熟件。
8. **协议先行**：UI 只依赖协议；换壳、换内核对用户无感。

---

## 2. 目标用户画像

> 画像对照：本文 P1 阿凯 ≈ 02-user-stories 的 Lin；P2 小米 ≈ Mia；P3 老陈 ≈ Ken；02 另有移动优先创业者 Ava（驱动 PWA 审批）。两文档以 02 的故事 ID 为准，不再互相改名。

### 2.1 画像 P1：多机重度开发者“阿凯”（核心种子用户）
- 28–40 岁，日常同时用 Claude Code + Codex，家里台式机 + 公司笔记本 + 一台 VPS。
- 痛点：多个终端开多个 agent，各自会话不互通；离开电脑后任务停摆；PR 来了要手动喊 agent；订阅额度和 token 消耗不清楚；担心 agent 乱删文件/泄露 key。
- 期望：手机上看到“Codex 在台式机上改完了，Claude 在 review”，一键插话/批准；PR 一来自动派个 Bot 去看。
- 成功判据：每周至少有 5 个任务由事件触发（而非手动发起）。

### 2.2 画像 P2：独立创业者/一人公司“小米”
- 做产品、写文案、做数据、跑投放，没有团队。要一个“能干杂活的数字助理团队”：整理文件、写周报、做 PPT、调研竞品、监控竞品动态。
- 痛点：国内 OpenClaw 套壳版本质量不稳、安全不明；Meta Muse 在国内不可用且隐私不信任。
- 期望：微信/飞书里能叫到；定时任务稳定；文件操作可回滚；成本可控。

### 2.3 画像 P3：隐私/合规敏感的专业人士“老陈”
- 律师/财务/研究员/安全工程师，数据不能出本机或自己的 VPS。
- 期望：全本地或自托管；审计账本；技能签名；可对接本地模型/国产模型；每次出站可见。

### 2.4 画像 P4：Agent 爱好者/Hacker“Neo”
- 玩 OpenClaw、Hermes、各类 skill；喜欢折腾、写插件、做自定义形象。
- 是社区传播与插件生态的发动机，需要开放的协议、SDK、模板与可玩的形象系统。

### 2.5 画像 P5：小团队技术负责人“Lina”（B 端试水，P2 阶段）
- 3–20 人团队，想要共享一套 Bot 花名册、统一审批与审计、统一预算。
- v1 不专门做多租户，但数据模型预留 workspace/owner 字段。

---

## 3. 核心场景（每个场景都要有端到端 demo 脚本，用于发布与回归）

| # | 场景 | 流程概要 | 涉及能力 |
|---|---|---|---|
| S1 | **PR 自动协助** | GitHub PR 打开 → Webhook 事件 → Router 判断需要处理 → 在配对的开发机上派 Codex 子 Bot 在独立 worktree 里 review；同时派 Claude Code 子 Bot 跑测试 → 汇总评论草稿 → 审批卡待用户确认 → 发布评论 | 事件中心、外部 agent、worktree、审批、Thread 订阅 |
| S2 | **手机上遥控长任务** | 用户出门，手机 PWA 看到“Claude 子 Bot 在重构，卡在权限请求”→ 批准一次 → 插话“先别动 lockfile”→ 任务继续 | 多端、steer、审批卡、推送 |
| S3 | **从某一步分叉** | 子 Bot 方案 A 跑偏 → 用户在时间线 Checkpoint 点“从此处分支” → 新分支用方案 B；两个分支在各自 worktree 并行 → 分支树对比 → 采用其一 | fork、worktree、副作用账本、分支树 |
| S4 | **跨机协作** | 用户说“把家里台式机上那个仓库的测试在 VPS 上也跑一遍” → 主 Bot 路由：台式机 Node 取 diff，VPS Node 跑 | 网格、能力清单、路由 |
| S5 | **远程浏览器任务** | “帮我查三家竞品定价并做成表格” → 浏览器子 Bot 在隔离 Chromium profile 中工作 → 用户在 Computer 面板实时看画面 → 遇到验证码出现“需要你接管”事件 → 用户接管后交还 | browser.*、可见性三级、人工接管 |
| S6 | **每日简报/监控** | cron 触发 → 小模型心跳（不带全量上下文）→ 发现异常才唤醒 Worker → 通过飞书/微信推送摘要 | 定时事件、成本控制、渠道 |
| S7 | **办公产出** | “把上周数据做成 10 页 PPT” → 办公子 Bot 用技能生成原生 PPTX → 渲染成图片自检一轮 → 产物面板预览 → 用户点修改意见 | Skills、产物面板、验证回路 |
| S8 | **成本失控保护** | 子 Bot 循环重试 → 循环检测触发 → Watchdog 事件 → 暂停并通知 → 用户决定继续/终止 | 预算、Watchdog |

---

## 4. 竞品与差异化

### 4.1 竞品对照

| 产品 | 形态 | 强项 | 与我们的差距/机会 |
|---|---|---|---|
| Meta Muse | 云 VM 个人 Agent，免费 + $20/$100 | 分发、形象、UI、模型 | 闭源、云端、隐私不信任；不接用户本机编程 agent |
| Grok Bot | 花名册 + 状态头像 + 电脑可见性 | 设计语言 | 同上；生态封闭 |
| OpenAI dots / Claude Duet·Cowork·Dispatch / Gemini Spark / Perplexity Personal Computer / Manus / Genspark Claw | 厂商云端或半本地 Agent | 模型与品牌 | 绑定单一模型/厂商；不是“指挥别家 agent” |
| OpenClaw | 开源 Gateway + 渠道 + Node | 生态、渠道、协议 | TS 巨型代码库（非测试 TS 文件约 1.43 万个）、60+ CVE、默认不安全、无“形象即状态”UI、不以分支/插话为核心 |
| Hermes Agent | 开源，技能环 + 记忆 | 技能自演化 | 主打单 Agent，非多 Bot 指挥 |
| 国内 OpenClaw 系（Kimi Claw、QClaw、WorkBuddy 等约 20 家） | 套壳/托管 | 本地化入口 | 同质化、安全不透明 |
| Eigent / DeerFlow 2.0 / Goose / OpenCode / Codex app | 办公或编程 agent | 各有强项 | 都是“单个 agent 产品”，我们是它们的上层调度 |
| **MausBot**（Apache-2.0，多 bot 桌面聊天，每个联系人驱动本机 claude/codex/grok CLI；来源为其自家博客 2026-10-08，二手，需自行核实成熟度） | 开源桌面 | 形态与本产品最接近（联系人式 + 本机 CLI agent） | **评审补充的遗漏项**：M0 需读码评估（是否可借鉴/复用其 UI 或 Driver 思路；Apache-2.0 允许复用，但成熟度未证实）；我们的差异化是事件内核、分支/插话、多机网格、审计 |

### 4.2 差异化主张（七条，每条都对应可验证的功能）

1. **指挥外部编程 agent 的一等公民支持**：Claude Code、Codex、OpenCode、Goose 以带名字的 Bot 出现在花名册，统一事件流、统一审批、统一分支/插话。
2. **分支（fork）+ 插话（steer）+ 打断（interrupt）作为产品原语**，而非隐藏功能。
3. **你的机器网格**：多台电脑 + VPS + 云浏览器，配对即用，P2P 直连，设备间不经第三方存数据。
4. **安全可审计作为卖点**：默认询问、凭据替身、哈希链审计账本、签名技能，开源可自托管。
5. **事件驱动的常驻性**：PR、Webhook、cron、子 Bot 回调统一事件化，任务不依赖用户在线。
6. **成本透明**：任务级预算、循环检测、token 仪表、心跳用小模型。
7. **有趣且有信息量的形象**：头像动效 = 状态；形象系统可定制、可社区共创。

### 4.3 不做什么（边界）

- 不自研基础模型；不做云 VM 托管作为 v1 核心（可后续作为付费可选项）。
- 不做写实/NSFW 伴侣（Grok Companions 下线教训、应用商店风险）。
- 不做开放式无审核技能市场（OpenClaw ClawHub 被投毒的教训）。
- 不转售/中转 Claude.ai、ChatGPT 订阅额度（Anthropic 条款禁止第三方提供 Claude.ai 登录或中转订阅额度）。
- 不在 v1 实现桌面 GUI computer-use（OSWorld 2.0 上前沿模型约 20%，默认关闭，后期可选）。

---

## 5. 功能架构（模块树）

```
Muster
├─ A. 客户端层（协议化薄壳，只依赖生成的 TS 协议包）
│   ├─ A1 桌面壳（Tauri 2 + React；Win/Mac/Linux；托盘、桌宠窗口、全局快捷键、通知）
│   ├─ A2 Web/PWA（同一套 UI；局域网桥 + 出站中继；作为手机遥控器）
│   ├─ A3 移动壳（阶段 2：Tauri mobile，扫码、生物识别、推送）
│   ├─ A4 渠道适配（微信/飞书/钉钉/Telegram/Slack 等，作为“事件源 + 回复通道”）
│   └─ A5 UI 模块：花名册 / 异构时间线 / 收件箱 / 右侧面板（电脑·浏览器·Diff·终端·产物·分支树）/ 审批卡 / 凭据保险箱 / 设置
├─ B. Hub 核心 daemon（Rust，独立进程）
│   ├─ B1 事件内核：proto（Thread/Turn/Item/Event）· journal（SQLite WAL 追加日志 + 投影）· bus · outbox
│   ├─ B2 事件触发中心：Source 注册 · 去重/claim · Router（快路径规则 + 慢路径小模型）· Thread 订阅直通
│   ├─ B3 Agent 运行时：主 Bot（Router）· Worker Session 管理 · 内置子 Bot · Watchdog
│   ├─ B4 外部 Agent 驱动：AgentDriver trait · AcpDriver · CodexNativeDriver · ClaudeNativeDriver · 能力矩阵与降级
│   ├─ B5 网格：设备注册表 · 配对 · 传输（iroh 默认 / WS relay）· 能力清单 · 资源租约 · 路由
│   ├─ B6 浏览器：browser.* 工具面 · A 隔离 profile(CDP) · C 云浏览器适配器 · （B 档真实 Chrome 扩展桥 v2）
│   ├─ B7 技能与插件：SKILL.md 兼容 · MCP 宿主(rmcp) · 内置 MCP 服务器 · 签名与权限清单
│   ├─ B8 记忆：事实/情景/技能记忆 · FTS5 + 向量 · 可审阅可编辑
│   ├─ B9 安全：策略引擎 · 审批 · 凭据代理 · 沙箱 · 出口策略 · 审计账本
│   ├─ B10 成本：预算 · 计量 · 循环检测 · 模型路由
│   └─ B11 网关：axum WS/HTTP · ACP-server 北向 · AG-UI 输出 · 鉴权
├─ C. Node 代理（每台被控机器上的常驻小程序，Rust）
│   ├─ C1 execute（流式返回，不存会话状态）· C2 本机审批强制点 · C3 worktree 管理
│   ├─ C4 外部 agent 进程托管（仅管理自己启动的子进程）· C5 浏览器宿主 · C6 凭据代理侧
├─ D. 形象系统：deriveAvatarState(events) · AvatarRenderer(SVG/Rive/VRM) · 参数化角色生成器 · 主吉祥物
├─ E. 生态：技能注册表(签名) · 形象商店(P2) · 模板/Bundle · SDK
└─ F. 云端可选服务（非必需）：出站中继 · 推送网关 · 配置同步(E2EE) · 托管 Hub（付费）
```

---

## 6. 三类 Agent 的产品形态

### 6.1 主 Bot（“管家”，Router）

- **形态**：花名册里置顶的联系人，一条主对话线 + 可随时开的侧聊。用户可改名、换形象、改性格设定。
- **职责**：接收所有事件；先走程序化快路径（规则/去重/订阅匹配），再走慢路径（小模型判定：忽略/回复/派发给谁/新建 Thread）；批量处理积压事件；对用户汇报。
- **约束**：不执行任务，没有 Bash/文件写权限；上下文只有路由所需摘要；心跳不带全量上下文；主动行为默认 observe（只提议、不执行，用户在设置中逐类开启）。
- **验收**：在 100 条/分钟的合成事件压测下，主 Bot 不阻塞，用户输入响应 P95 < 1.5 s 出现首个反馈（头像状态变化）。

### 6.2 内置子 Bot（Worker）

- **形态**：每个任务一个有状态 Session（追加式事件日志，模型历史是日志的投影）；Activation 与 Session 分离（可休眠、可唤醒）。
- **内置角色模板**：Researcher（深度研究+引用）、Office（文档/表格/PPT）、Browser（浏览器任务）、Ops（文件整理/系统任务）、Watchdog（监控卡死与循环，仅有 steer/interrupt/retry 权限）。
- **子 Bot 语义**：独立上下文、深度限制（默认 maxDepth=2：Router → Worker → 一层 helper；与 03-architecture §4.5 一致；外部 agent 视为叶子，其内部子 agent 仅镜像可见）、max_turns 与墙钟上限、结构化回报与验收标准；插话在 turn 边界注入并标记为“用户新增指令”；父→子授权（Mandate）与订阅（上下文）分离。
- **原语**：`fork(session, at_event)`、`steer(session, msg, mode)`、`interrupt(session)`、`followup`、`cancel`。

### 6.3 外部 Agent Bot（Claude Code / Codex / OpenCode / Goose / Gemini 等）

- **形态**：花名册中的 Bot，头像带“来源徽标”（不使用厂商品牌 logo，特别是不使用 Claude Code 品牌），可绑定到某台 Node 和某个仓库。
- **接入策略**：ACP 南向主干 + 原生 Driver 逃生舱。Codex 优先直连 `codex app-server`（thread/fork、turn/steer、turn/interrupt、diff/plan）；Claude Code 优先走 `claude-agent-acp`/官方 Agent SDK；OpenCode 可走 `opencode serve`（inbox、steer|queue、fork）；其余经 ACP Registry。
- **能力矩阵与降级**：每个 Driver 声明 steer/queue/fork 粒度/interrupt/后台任务/子会话/权限记忆。缺能力时：steer → cancel 后重新 prompt；fork → 会话级 fork 或摘要交接；queue → Hub 侧排队等 Idle。UI 对降级给出明确提示。
- **文件隔离**：所有可 fork 的外部 Bot 默认绑定 **git worktree**（各家会话 fork 都不分叉文件系统）。
- **回调通道**：通过 `session/new` 的 mcpServers 注入本产品内置 MCP（`dispatch`、`notify`、`emit_event`、`memory`、`browser`、`remote_machine`），子 Bot 用它回调主 Bot。
- **会话真相**：外部 agent 的会话日志以其自身为准，Hub 只存引用 + 事件摘要镜像。
- **合规**：默认使用用户本机已登录的**未修改**官方 `claude` 二进制，另提供 API Key / Bedrock / Vertex 选项；本产品不接触订阅 token；Codex 集成的 clientInfo.name 需向 OpenAI 登记（待办）。Gemini CLI 个人版已迁往 Antigravity CLI（agy），不作为 v1 默认。

---

## 7. 事件触发中心

### 7.1 统一信封

```
Event {
  id, type, source, target?, thread_id?,
  payload, occurred_at, expires_at?,
  idempotency_key, seq (单调),
  claim { owner, lease_until }, causation_id, correlation_id
}
```
参照 OpenClaw `cron/event-source.ts`（持久化队列 + 去重）、Eigent 收件箱字段（幂等/租约/过期）、DSH 的 Source/Trigger/Thread/Subscription 模型。

### 7.2 事件源清单

| 类别 | 事件源 | 版本 |
|---|---|---|
| 用户 | 主对话输入、侧聊、Bot 对话中插话、审批决定、接管/交还 | P0 |
| 定时 | cron 表达式、一次性提醒、间隔心跳 | P0 |
| 外部触发 | GitHub（PR/Issue/CI/Review 评论，经 Webhook 或 CLI 轮询）、通用 Webhook（带签名校验） | P0（GitHub）/P1（通用） |
| 子 Bot 回调 | TurnEnded、PermissionRequest、Error、BackgroundTaskEnded、Progress、请求澄清 | P0 |
| 系统 | Node 上线/下线、配对请求、预算阈值、浏览器弹窗/下载/崩溃、Watchdog 告警 | P0/P1 |
| 渠道 | 微信/飞书/钉钉/Telegram 消息 | P1（飞书先） |
| 文件/本地 | 目录变化、剪贴板、邮件（可选） | P2 |

### 7.3 处理流程

1. **入箱**：任何输入先持久化为事件（outbox 事务），再调度——崩溃不丢。
2. **快路径**：去重（idempotency_key）、权限/来源白名单、订阅匹配（已被某 Thread 订阅的事件直通订阅的 Worker，不经 Router）。
3. **慢路径**：小模型 Router 对未订阅事件分类：忽略 / 归并到已有 Thread / 新建 Task 并选择 Bot。批处理积压事件。
4. **Thread**：同一 PR、同一 IM 话题、同一任务的事件归为 Thread；Worker 订阅后后续事件由代码直通（调研中去掉直通会使 Router 决策数增加 30%，数据来自合成负载，仅作量级参考）。
5. **效果执行**：对外副作用（发评论、发消息、写文件）写 `side_effect_ledger`，通过 effect outbox 执行，分支重放时依据账本避免重复。
6. **模式**：每个事件源可配置 `observe`（只记录并提议）/ `ask`（生成待审批的动作，用户确认后执行）/ `auto`（在 Mandate 范围内经策略允许后自动执行）。默认 observe；与 03-architecture 的 `autonomy` 枚举、`source_binding.autonomy` 一致。

### 7.4 验收（摘要）
- 同一 GitHub 事件重复投递 10 次只触发 1 次任务。
- 进程在处理中被 kill -9，重启后事件不丢、不重复执行副作用。
- 用户可在“事件时间线”页看到任一事件的来源、路由决策、触发的 Bot 与结果。

---

## 8. 多设备与远程浏览器

### 8.1 拓扑
Hub + Node + Operator 三角色（借鉴 OpenClaw Gateway/Node）：Hub 为信任边界与事件真相；Node 主动外连并以 `node.invoke` 暴露能力；Operator（桌面/Web/手机）是操作端。一个 Hub 一个信任边界；每台机器的 daemon 是自己线程的唯一写者，跨设备靠“远程附着”（v1 不做多写复制）。

### 8.2 配对与身份
- 设备身份 = Ed25519 密钥对（私钥存 OS 钥匙串）。
- 首次入网：Hub 生成一次性配对码/二维码（10 分钟过期，只存哈希）→ Node 用设备公钥签名 challenge → UI 展示公钥短指纹供人工核对 → 用户批准。
- 两层授权：设备准入 + 能力面审批；能力面变宽回到 pending；公钥变化与权限升级**绝不自动批准**。

### 8.3 传输
- v0：WebSocket + 配对码；v1：iroh 按公钥拨号（官方称约 9/10 直连，其余走端到端加密 relay）+ 自托管 relay + Bearer 访问控制；Tailscale/Headscale/NetBird 地址可作为用户自带 overlay。传输做成 trait 以便替换；Web 端使用 WS relay（iroh 浏览器内不能打洞）。
- 单连接内按 ALPN 分流：ctl / evt / blob / screen。

### 8.4 路由与恢复
- 能力清单 + 资源租约 + 按资源类型路由（借鉴 Eigent Brain/Hands）；任务粘在首个处理它的后端，失败**不跨机重放**，显式 target 优先。
- 事件带单调序号，Node 重连后 `task.resume(last_event_seq)` 补拉。

### 8.5 远程浏览器（统一 `browser.*` 工具面，三档后端）
| 档 | 说明 | 版本 |
|---|---|---|
| A 隔离 profile | Node 本地 Chromium，CDP 驱动（第一版用 Playwright MCP sidecar），默认 | P0 |
| C 云浏览器 | 填 CDP URL；自托管选 steel-browser（Apache-2.0） | P1 |
| B 真实 Chrome | 扩展 + native messaging 桥，逐站点授权 | P2 |
- 页面感知默认用可访问性树快照 + ref，视觉兜底；快照对密码/OTP/卡号脱敏；`evaluate` 默认关闭。
- **Computer 面板三级可见性**：状态 / 预览 / 接管。接管时 Agent 暂停，交还时产生事件。

---

## 9. 功能清单与验收标准

> 优先级：**P0** = v1.0 必须；**P1** = v1.x（发布后 3 个月内）；**P2** = 后续。验收标准写“可测试”的表述。

### 9.1 P0（v1.0）

| ID | 功能 | 验收标准 |
|---|---|---|
| P0-01 | Hub daemon 与事件日志 | SQLite WAL 追加日志，重启后会话可恢复；事件有单调 seq；kill -9 后无事件丢失；1 万条事件下启动 < 3 s |
| P0-02 | 统一事件信封与去重 | 重复 idempotency_key 仅处理一次；有 claim/lease，崩溃后租约过期可被重新认领 |
| P0-03 | 主 Bot Router（快/慢路径） | 规则命中事件不调用 LLM；慢路径使用可配置小模型；Router 无任何写文件/执行权限（单测断言工具集为空） |
| P0-04 | 内置 Worker Session | 创建/休眠/唤醒；上下文独立；max_turns 与墙钟上限生效 |
| P0-05 | Fork | 从任一 Checkpoint/事件偏移分叉；悬空 tool call 补合成结果；分支与父会话互不影响；UI 显示分支树 |
| P0-06 | Steer / Interrupt / Followup | 运行中输入框不禁用；发送即插话事件；带 request_id 幂等与 expected_turn_id 校验；Stop 与“等待审批”视觉区分；在 turn 边界生效（原生支持处立即生效） |
| P0-07 | AgentDriver trait + 能力矩阵 | 至少 3 个 Driver 通过同一套契约测试；缺能力时按降级表降级并在 UI 提示 |
| P0-08 | Claude Code 子 Bot | 经 claude-agent-acp 或官方 SDK；**必须在“API Key / Bedrock / Vertex”模式下通过验收**（合规确定）；“用户本机已登录 `claude`（订阅）”模式属合规灰区（claude-agent-acp 基于 Agent SDK，而 Anthropic 要求第三方产品用 API Key；“不限制终端用户登录未修改的 Claude Code 二进制”的豁免是否覆盖经 SDK 适配器驱动，**未证实，待法务**），默认关闭并经 P0-31 合规 Gate 显式确认；能流式显示文本/工具调用/diff；审批请求进入统一审批卡；UI 只用纯文本来源标注（可写“Claude Code”字样），不用其 Logo/吉祥物，不作产品名 |
| P0-09 | Codex 子 Bot | 经 `codex app-server`；支持 fork(指定 turn)、steer、interrupt、plan/diff 展示 |
| P0-10 | OpenCode 或 Goose 子 Bot（至少一个，经 ACP） | 走 ACP Registry/配置安装；与前两者同一花名册呈现 |
| P0-11 | Git worktree 隔离 | 每个可 fork 的外部 Bot 任务默认独立 worktree；结束提供“合并/丢弃”操作；不污染主工作区 |
| P0-12 | 内置 MCP 服务器（dispatch/notify/emit_event） | 外部子 Bot 可调用 `notify` 触发主 Bot 通知；调用产生事件并入日志 |
| P0-13 | 事件源：用户 / cron / 子 Bot 回调 | **Hub 在线时** cron 精度 ±5 s（电脑休眠/关机期间不触发，属物理限制，需引导用户把 Hub 放常开机器）；错过的任务按策略补跑或跳过（默认 `once` 补一次并标注延迟；与 02 Q8、03 DDL 一致）；重启不重复触发 |
| P0-14 | 事件源：GitHub PR | **MVP 仅 `gh`/REST 轮询**（Notifications/Events API + ETag）；Webhook（带签名校验）需公网入口，依赖出站中继，放 v1.x（P1）；PR opened/synchronize/comment 触发；按仓库显式 opt-in；默认 observe |
| P0-15 | Node 配对（2+ 台） | 配对码 10 分钟过期；短指纹核对；撤销后立即断开；能力扩权需再审批 |
| P0-16 | node.invoke 与远程执行 | 流式 stdout；Node 本机强制审批（默认 ask）；断线重连 resume 补拉事件 |
| P0-17 | 审批卡 | 确定性原生 UI（非模型生成）；展示命令/路径/diff/所在机器/风险等级；选项“仅此次/本任务/本会话/拒绝”；无人值守触发的审批默认自动拒；审批超时自动拒 |
| P0-18 | 凭据保险箱 | 密钥存 OS 钥匙串；模型上下文只见句柄；日志与快照中不出现明文（自动化扫描测试） |
| P0-19 | 浏览器 A 档 | 隔离 profile 启动；`navigate/snapshot/click/type/screenshot`；域名策略与 SSRF 拦截；快照脱敏 |
| P0-20 | Computer 面板 + 人工接管 | 实时画面延迟 < 2 s（局域网）；接管/交还事件入日志 |
| P0-21 | 联系人式 UI | 花名册（头像即状态，pin/分组/隐藏）、异构时间线、全局收件箱、右侧面板；注意力态三档（Needs attention / Unread / Working） |
| P0-22 | L0 形象系统 | 参数化形状 + 眼睛系统，按 Bot ID 种子生成；状态词汇以 04 §9.1 为准：Hub 端 `derive_presence`（Rust，权威）输出持久态 idle/thinking/working/waiting/blocked/done/asleep，UI 只叠加瞬态（listening/acknowledging/forking/celebrating）与防抖；同一份 golden JSONL 用例在 Rust 与 TS 两侧回归 |
| P0-23 | 成本仪表与预算 | 任务级预算上限；超限自动暂停并发事件；实时 token/费用显示（按模型价格表估算，外部订阅 agent 显示 token 而不显示金额）；循环检测（相同工具调用 N 次） |
| P0-24 | 模型提供方 | Anthropic/OpenAI 兼容端点/OpenRouter；国产模型（DeepSeek/Kimi/GLM/MiniMax/Qwen）一等配置；Ollama 本地 |
| P0-25 | 审计账本 | 哈希链追加；每个审批、外部副作用、Node 调用可追溯；UI 可查询并导出；篡改校验命令 |
| P0-26 | 桌面壳 | Win/Mac/Linux 安装包；托盘常驻；安装包体积硬门槛 < 100 MB（工程目标 ≤ 60 MB，见 03 §15；均不含按需下载的 Node 适配器运行时、Playwright/Chromium）；空闲内存 < 300 MB（含 daemon，不含子 agent） |
| P0-27 | Web/PWA 遥控 | **MVP：局域网 + 用户自带 Tailscale/Headscale（由 `tailscale serve` 提供 HTTPS，PWA 安装与 Web Push 需要 secure context）**；出站 E2EE 中继放 M4/v1.x；二维码配对；可查看时间线、审批、插话 |
| P0-28 | SKILL.md 兼容 | 读取 `~/.agents/skills` 与 `.claude/skills`；渐进披露；技能清单展示所需权限 |
| P0-29 | 记忆（基础） | 用户偏好/事实记忆，可查看、编辑、删除；每次注入记忆可在时间线展开溯源 |
| P0-30 | 开机自启与崩溃自恢复 | daemon 异常退出 10 s 内被拉起；UI 重连后无状态丢失 |
| P0-31 | 订阅合规 Gate（由 P1-15 提前） | 首次启用 Claude/Codex 子 Bot 时展示使用方式与条款提示，检测登录方式（API Key / 订阅）；订阅模式需用户显式勾选“我自行承担”；产品不读取、不存储、不转发任何订阅 OAuth token（自动化测试扫描） |

> **MVP 切线（评审新增，详见 05-review-roadmap.md §2）**：30+1 项 P0 对 6–10 周过大。
> - **MVP（M0–M3，约 10 周）必做**：P0-01、02、03（仅规则路由 + 手动确认，小模型慢路径后置）、05（**只做外部引擎原生 fork + worktree + turn 级 git 快照 checkpoint**——没有快照，分支拿到的文件状态是当前 HEAD 而不是切点，会话与文件会不一致；原生 Session 前缀共享 fork 后置）、06、07、08、09、10、11、12、13、14（仅轮询）、15（2 台、WS + 配对码，LAN/Tailscale）、16、17、21（精简版）、22（7 个持久态）、23（token 计量 + 任务预算 + 循环检测，金额估算后置）、25（哈希链最小实现）、26（Win + Mac；Linux 尽力而为）、27（LAN/Tailscale PWA）、30、31。
> - **v1.0 公开 Beta（M4）补齐**：P0-04（原生 Worker，办公/研究类）、P0-18 完整凭据保险箱与出口代理（MVP 仅 API Key 入 OS 钥匙串）、P0-19/20（浏览器 A 档 + Computer 面板 + 接管）、P0-24 全量模型提供方（MVP：OpenAI 兼容 + Anthropic）、P0-28、P0-29；并含出站 E2EE 中继。
> - 其余 P1/P2 不变。

### 9.2 P1（v1.x）

| ID | 功能 | 验收标准 |
|---|---|---|
| P1-01 | iroh 传输 + 自托管 relay | 公网环境两台设备直连成功率可观测；失败自动走 relay；after_handshake 白名单生效 |
| P1-02 | 飞书/微信/钉钉渠道 | 消息收发、卡片审批回传；渠道身份与用户绑定；群聊默认不响应除非被 @ |
| P1-03 | 办公技能首批（自写） | Word、Excel（公式重算零错误）、可编辑原生 PPTX、PDF、文件整理（先计划后执行、可撤销）；产物带“渲染→校验→修正一轮”回路 |
| P1-04 | 产物面板 | 表格/文档/幻灯片预览；revision 防覆盖 |
| P1-05 | Goals 视图 | 长期事件订阅的可视化（例：盯某仓库所有 PR） |
| P1-06 | 云浏览器 C 档 | 填 CDP URL 即用；steel-browser 自托管文档 |
| P1-07 | MCP Apps 宿主 | `ui://` 沙箱 iframe 渲染；符合 2026-01-26 规范 |
| P1-08 | ACP-server 北向 | 第三方 ACP 客户端（如编辑器）可连接 Muster 作为 agent |
| P1-09 | 技能签名与权限清单 | 安装时校验签名；运行时按清单限权；不合规拒装 |
| P1-10 | 通用 Webhook 与 Watchdog | Watchdog 为 Schedule 事件驱动的独立 Session，仅 steer/interrupt/retry 权限 |
| P1-11 | 记忆进阶 | FTS5 + sqlite-vec 检索；自动整理（压缩/去重）可回滚；记忆膨胀告警 |
| P1-12 | L1 主吉祥物 + Rive 动画 | 买断授权；三视图、≥6 款表情差分；状态机驱动 |
| P1-13 | 移动 Tauri 壳 | 扫码配对、生物识别审批、推送 |
| P1-14 | 沙箱容器模式 | Docker/容器或 namespace 隔离执行；无容器环境回退受限本地模式 |
| P1-15 | 订阅合规 Gate | **评审提前为 P0-31（成本很低、法律风险高）**：首次使用外部 agent 时展示使用条款并检测登录方式 |

### 9.3 P2（后续）

| ID | 功能 | 说明 |
|---|---|---|
| P2-01 | 真实 Chrome 扩展桥（B 档） | 逐站点授权 |
| P2-02 | 形象商店 / 社区共创 | 创作者分成、审核 |
| P2-03 | VRM 语音/伴侣模式 + 桌宠悬浮窗 | three-vrm；透明置顶窗口 |
| P2-04 | 桌面 GUI computer-use Hand | 默认关闭；call_user 接管 |
| P2-05 | 托管 Hub（云 VM） | 付费增值 |
| P2-06 | 团队版 | workspace、SSO、统一预算与审计 |
| P2-07 | A2A 对接 | 调用/暴露远程第三方 agent |
| P2-08 | E2EE 日志同步 | 加密 blob 中继 |
| P2-09 | Feed/Ideas/Library | 参考 Muse 的标签页 |
| P2-10 | 硬件/可穿戴入口 | 暂不规划 |

---

## 10. 技能 / 插件市场

### 10.1 分层
1. **Skills（SKILL.md，agentskills.io 标准）**：渐进披露的说明书 + 脚本；原生兼容并读取 Claude/Agents 目录。
2. **MCP 服务器**：工具扩展；通过 rmcp 宿主，兼容 MCP 2025-11-25 与 2026-07-28 双栈。
3. **Bundle**：技能 + MCP + Bot 模板 + 形象 + 事件规则的组合包，一键导入“办公团队”“开发团队”。
4. **Driver 插件**：新外部 agent 适配（P2 开放）。

### 10.2 安全策略（反 ClawHub 投毒）
- **不开放式市场**：官方精选 + 签名开发者；其余来源以“本地/Git 安装”并显示强警告。
- 每个技能必须带**权限清单**（文件路径、网络域名、命令、凭据句柄）；运行时由策略引擎强制，超范围即审批。
- 安装前静态扫描（脚本/外联/混淆）+ 沙箱试跑；社区举报与撤销列表；版本固定与差异审阅。
- 技能 Hub 的收录规则、签名流程、撤销机制写入公开治理文档。

### 10.3 许可注意
- **严禁复制 Anthropic docx/xlsx/pptx/pdf 技能**（source-available，禁止复制与派生）；办公技能自写，或改造 MIT 的 DeerFlow 技能。
- Pandoc（GPL）、Skyvern（AGPL）仅以子进程方式或不引入；RustDesk/HyperAgent（AGPL）只借鉴设计。

### 10.4 市场里的“钱”
- v1 全部免费；P2 引入创作者付费包（形象、Bundle），平台抽成 15–20%（待拍板）。

---

## 11. 记忆

| 层 | 内容 | 存储 | 规则 |
|---|---|---|---|
| 工作记忆 | 当前 Session 上下文 | 事件日志投影 | Inline & Spill：长输出溢出到文件，保留引用，需要时 Recall |
| 用户记忆 | 偏好、事实、常用路径、联系人 | SQLite（FTS5，P1 加向量） | 可见、可编辑、可删除；来源可溯；敏感类别需确认才写入 |
| 任务记忆 | Thread/Task 摘要与产物索引 | SQLite | 任务结束时生成摘要；可被主 Bot 路由使用 |
| 技能记忆 | 从成功任务中沉淀的流程 | SKILL.md 草稿 | 沉淀需用户确认；不自动安装 |
| 共享记忆 | 通过内置 MCP 暴露给外部子 Bot | 只读/追加受控 | 外部 agent 自有记忆（如 CLAUDE.md）不覆盖 |

原则：记忆写入前过滤凭据；记忆膨胀有上限与告警（调研中“记忆膨胀、进度谎报”是用户痛点）；子 Bot 汇报“已完成”必须附验收证据（测试输出/产物链接），Router 校验。

---

## 12. 权限与安全

### 12.1 威胁模型要点
提示注入（网页/PR 内容/邮件）、恶意技能、越权执行、凭据泄露、配对劫持、无人值守下的误操作、Node 被攻破的横向影响。

### 12.2 设计要点
1. **三层授权**：设备准入 → 能力面 → 调用时风险分级（可逆/难撤销/对外发送/花钱）。
2. **默认询问**：Node 本机 exec 默认 ask（与 OpenClaw 默认 full 相反）；难以撤销操作使用更强确认（不只是横幅）。
3. **凭据替身**：真实凭据只在 Node/凭据代理侧；模型和子 Bot 看到句柄；出站请求由代理注入（借鉴 Muse 的 surrogate token 思想，但开源、可审计）。
4. **出口策略**：网络层域名白名单 + SSRF 拦截；浏览器与 exec 的出站同样受控。
5. **文件安全**：仅挂载/允许授权目录；denylist（`.env`、`.ssh`、`*token*`、`*secret*`）；写操作先出变更计划与 diff；工作区 git 自动快照可回滚。
6. **来源标记**：来自网页/PR/渠道的内容标记为不可信输入；不可信输入触发的动作提升审批等级。
7. **无人值守规则**：事件触发 + 子 Bot 触发的审批默认自动拒绝；只有用户预先授权的“例行规则”可例外且记录。
8. **审计**：哈希链账本与事件总线同源；可导出。
9. **沙箱路线**：v1.0 靠“路径白名单 + 审批 + 外部 agent 自带沙箱（如 Codex sandbox 模式）”；容器/namespace 隔离为 P1-14；**git worktree 只提供文件互不覆盖，不是安全隔离**；暂不做 eBPF 污点追踪。
10. **本机管理接口真认证**：所有 daemon 接口需令牌/签名，禁止仅依赖 localhost（吸取 OpenClaw 类 CVE 教训）。
11. **供应链**：二进制签名、依赖审计（cargo-audit/deny）、可复现构建目标、漏洞披露流程与赏金（社区起量后）。
12. **安全作为发布门槛**：每个版本通过“红队清单”（提示注入、路径穿越、配对重放、越权升级）回归。

### 12.3 验收（摘要）
- 外部渗透/自测：未经审批无法在 Node 执行非白名单命令；配对码重放失败；篡改审计账本被校验命令发现；日志扫描无明文凭据。

---

## 13. 商业模式与开源策略

### 13.1 开源策略
- **许可证建议**：核心（Hub、Node、协议、SDK、UI）采用 **Apache-2.0**（专利授权友好，利于企业与二次集成）；不用 AGPL 以避免社区疑虑，但需承认这限制了对抗云厂商的“护城河”（待拍板，备选 MPL-2.0 / 带商标保护的 Apache-2.0）。
- **商标保护**：名称与吉祥物独立注册并发布商标政策（OpenClaw 前身因商标请求两次改名，是前车之鉴）。
- **治理**：公开路线图、RFC 流程、安全披露流程；协议规范独立版本化，便于第三方实现。
- **第三方许可**：DSH（MIT）在 NOTICE 中如实标注；产品名避开“DeepSeek Harness”全称（品牌条款）。

### 13.2 商业模式（开源 + 增值）

| 层 | 内容 | 价格（草案，待拍板） |
|---|---|---|
| Free（自托管） | 全部核心功能，无功能阉割；BYOK | 免费 |
| Cloud Relay & Sync | 托管出站中继、推送网关、E2EE 配置/日志同步、短域名 | $5–8/月 |
| Cloud Hub（托管 Hub / 云电脑） | 一台托管 VM，含浏览器与沙箱，24/7 在线 | $20–30/月（含基础算力，模型用量另计或自带 Key） |
| Pro 模型额度 | 预付费聚合模型额度（透明加价，显示成本） | 按量 |
| Team | 共享花名册、SSO、统一预算与审计、保留策略 | $15–25/人/月（P2） |
| 市场 | 形象/Bundle 创作者分成 | 15–20% 抽成（P2） |

### 13.3 原则
- 不把安全与审计功能作为付费墙；付费买的是“省心的托管与便利”。
- 价格数字为占位，需用户访谈与 Muse（免费 + $20/$100）参照后再定。
- 不转售第三方订阅额度。

---

## 14. 增长与社区策略（如何做到“非常流行”）

> “非常流行”不等于功能多，而是**可传播的时刻 + 低安装门槛 + 社区共创**。

### 14.1 传播钩子（内容化产品）
1. **“看 Bot 干活”可录屏**：花名册头像表情 + Computer 面板，天然适合 10–30 秒短视频（“我睡觉时，我的 3 个 Bot 修了 2 个 bug 并回复了 PR”）。
2. **分支树**：同一任务两个 agent 并行 PK 的可视化，适合技术社区传播。
3. **形象共创**：用户生成自己的 Bot 形象并分享“名片”（带种子的链接），形象 = 社交货币。
4. **安全可见**：“审计回放”页，一键生成分享卡片（脱敏）。

### 14.2 安装与首次体验（TTFV < 10 分钟）
- 单文件安装包；首次启动检测本机已安装的 `claude`/`codex`/`opencode` 并一键加入花名册；5 步引导：命名 → 选形象 → 加一个编程 Bot → 配对第二台设备（可选）→ 跑官方 demo（“修复示例仓库的一个测试”）。
- 零配置模式：无 API Key 时引导接入免费/低价模型（国产模型预置）。

### 14.3 渠道节奏
| 阶段 | 动作 |
|---|---|
| T-8 周内测 | 邀请 100 名多机重度开发者；GitHub 私有仓库；每周迭代；收集 demo 视频 |
| 公开 Beta | GitHub 开源 + Hacker News / Product Hunt / V2EX / 即刻 / 掘金 / X 同日发布；发布“安全白皮书 + 与 OpenClaw 的差异”技术博文 |
| 增长期 | 每月一次“Bot 创作大赛”（形象 + Bundle）；技能/Bundle 精选榜；与 Claude Code/Codex/OpenCode/Goose 社区做“指挥层”联动教程 |
| 国内 | 飞书/微信渠道文档、B 站教程、国产模型厂商联合活动（Kimi/GLM/DeepSeek/Qwen） |
| 生态 | 开放 SDK + 示例仓库；`good-first-issue`；Discord/飞书群/微信群；月度社区电话会 |

### 14.4 增长风险与对策
- OpenClaw 已占心智：用“安全 + 指挥编程 agent + 形象状态”差异化，避免正面比渠道数量。
- 依赖外部 agent 条款：合规 Gate；不触碰订阅 token；准备 OpenCode/Goose 作为默认可用选项。
- 流行靠颜值：投入首个主吉祥物买断与 Rive 动画，并在发布前做商标检索。

---

## 15. 技术路线摘要（与 PRD 相关的约束，细节见设计文档）

| 议题 | 结论 | 依据 |
|---|---|---|
| 核心语言/形态 | Rust 核心 daemon + 薄 UI 壳；UI 只依赖生成的 TS 协议包 | 07 |
| 桌面壳 | Tauri 2.12+ 起步；WebKit + Chromium 双内核 CI；保留 Electron 回退 | 07 |
| Agent 内核 | **评审口径**：03-architecture 推荐“自建 Rust 薄内核（journal/outbox/inbox/调度，约数千行）+ 库级复用（rusqlite、rmcp、agent-client-protocol、iroh、rig-core）”，MVP 不写原生编码 loop（编码全交外部 Agent），Router 仅需最小工具循环；04 调研推荐阶段一用 DSH。二者冲突，**M0 两周 spike + 止损闸门后拍板**（用户待拍板 Q1）；DSH 无论如何可作为 ACP 子 Agent 被驱动；pi 为退路；阶段二可换 goose-agent + rig-core + rmcp | 02/04 |
| 内部事件模型 | Thread/Turn/Item/Event，借鉴 Codex app-server 与 ACP v2、AG-UI | 07 |
| 南向协议 | ACP client（agent-client-protocol crate）+ Codex app-server + MCP | 03/07 |
| 北向协议 | 自有 WS 事件流 + ACP-server + AG-UI | 07 |
| 存储 | SQLite WAL（追加日志 + 投影），FTS5 + sqlite-vec | 07 |
| 移动 | 阶段 1 PWA 遥控；阶段 2 Tauri mobile；Agent 永不在手机运行 | 07 |
| UI 栈 | React + TS + Tailwind + shadcn/ui + assistant-ui + React Flow + Rive（+ three-vrm 可选） | 08 |

注意：DSH 是否等同于“DeepSeek SuperAgent”原型未证实（只确认设计吻合）；Bun/Node 打包为 sidecar 的可行性未验证；goose-agent 能否编译到 wasm32 未实测——以上均需 PoC。

---

## 16. UI 与形象需求（摘要）

- **信息架构**：左侧花名册；中间异构时间线（消息、事件、子 Bot 卡、审批卡、Checkpoint）；右侧可折叠面板（电脑/浏览器三级可见性、Diff、终端、产物、分支树）；全局收件箱。
- **头像状态**：词汇以 04 §9.1 为准——Hub 端 `derive_presence` 输出持久态 idle / thinking / working / waiting（需要你）/ blocked（含 error 徽标）/ done / asleep（离线或休眠），UI 本地叠加瞬态 listening / acknowledging / forking / celebrating；（原稿的 10 态 error→blocked+徽标、sleeping/offline→asleep 已并入）；花名册小头像用 SVG/Canvas2D，避免每头像一个 WebGL 上下文。
- **形象三层**：L0 自研参数化形状 + 眼睛（零授权风险，覆盖所有子 Bot）；L1 主吉祥物请画师买断（米画师等预算 ¥500–5000 量级，复杂 IP 套装需询价；交付三视图、≥6 表情差分、PSD 分层源文件、著作权转让）+ Rive 状态机；L2 VRM 语音/伴侣（后置）。形象资源去向：自研、DiceBear（CC0 风格）兜底、定制画师、Rive Community（逐个核对许可）、VRoid/VRM（P2）。
- **规避**：不模仿 Grok Bot 的具体形状与双斜杠眼睛组合；不直接复用 Persona 的 Vercel Blob .riv 资源；不早期绑定 Live2D；petdex 等精灵资源须逐一核对许可。

---

## 17. 成功指标

### 17.1 北极星指标
**每周活跃 Muster 用户的“事件触发任务数”**（由事件而非手动发起、且用户最终采纳结果的任务）——衡量“常驻 + 事件化”价值，而非聊天次数。

### 17.2 分阶段目标（占位，待拍板）

| 阶段 | 时间 | 指标 |
|---|---|---|
| 内测 | 发布前 | 100 位种子用户；W4 留存 ≥ 40%；每用户平均 ≥ 2 个外部 Bot、≥ 1 台额外 Node |
| 公开 Beta | +0–3 月 | GitHub star 1 万；周活 5,000；TTFV 中位数 < 10 分钟；审批卡误拒/误批投诉 < 1% |
| 增长 | +3–12 月 | star 5 万+；周活 10 万；社区技能/Bundle ≥ 300（均签名）；付费转化 ≥ 3% |

### 17.3 质量与安全指标
- 任务成功率（有验收证据）≥ 75%（定义标准任务集）；
- 平均每任务成本可见率 100%，预算超限事故 0；
- 严重安全漏洞（CVSS ≥ 7）发现到修复中位数 < 7 天；
- 崩溃率 < 0.5%/会话；daemon 空闲内存 < 150 MB；
- Fork/Steer 使用率：≥ 30% 的周活用户至少使用过一次（验证核心原语被感知）。

### 17.4 埋点与隐私
默认关闭遥测，开启为明确 opt-in；仅采集匿名功能使用计数；不采集内容；公开遥测字段清单。

---

## 18. 里程碑（评审后版本，与 05-review-roadmap.md 一致）

> 原稿的 M0–M5（共 28 周）与 03 的 M0–M3、04 的 P0–P4 三套编号互相冲突，统一为下表。人力假设：3 名全职（2 Rust + 1 前端/设计工程）+ 兼职设计与法务；人手减半则周期约翻倍。

| 阶段 | 周期 | 交付（详见 05 §3） |
|---|---|---|
| M0 Spike + 止损闸门 | W1–W2 | Rust ACP 客户端驱动 claude-agent-acp / codex-acp / opencode acp；Codex app-server fork/steer/interrupt；内核骨架（journal + 崩溃恢复）；Tauri sidecar（Windows）；适配器运行时分发方案；DSH vs 自建内核结论；法务/商标/吉祥物外包三条并行线启动 |
| M1 单机指挥台 | W3–W5 | 内核 + Router（规则）+ 3 个外部 Bot + 审批卡 + worktree + 插话/中断/分支 + 花名册/时间线 UI + L0 头像 |
| M2 事件与网格 | W6–W8 | cron + GitHub 轮询 + 内置 MCP 回调 + 第二台电脑 Node（WS + 配对）+ 成本/预算 + 审计 + PWA（LAN/Tailscale） |
| M3 MVP 收口（内测） | W9–W10 | 合规 Gate + 钥匙串 + 混沌测试 + 安装包 + 引导 + Demo 脚本；20–30 位种子用户内测 |
| M4 v1.0 公开 Beta | W11–W20 | 浏览器 A 档 + Computer 面板 + 接管；原生 Worker（办公/研究）+ 记忆；出站 E2EE 中继 + 推送；SKILL.md；L1 主 IP + Rive；飞书渠道；安全评审与白皮书 |
| P1 迭代 | 之后 3 个月 | 见 §9.2 |

---

## 19. 风险与对策

| 风险 | 级别 | 对策 |
|---|---|---|
| 外部 agent 协议变动（ACP v2、Codex app-server、Claude control protocol 未承诺稳定） | 高 | AgentDriver 隔离 + 能力探测 + 版本锁定 + 契约测试；Codex 用 generate-json-schema 生成类型；Claude 优先官方 SDK/claude-agent-acp |
| 订阅条款（Anthropic/OpenAI/Google） | 高 | 只用用户本机未修改官方二进制或自带 Key；合规 Gate；法务复核；OpenCode/Goose 兜底 |
| DSH 为 developer preview、有破坏性变更 | 中高 | 锁版本、不 fork 主干、月度对账、保留 pi/自建退路；M0 做决策 |
| Tauri/WebKit 渲染与性能问题（OpenCode 曾因此迁 Electron） | 中 | 双内核 CI；协议隔离；Electron 回退 |
| 安全事故冲击品牌 | 高 | §12 全部默认值；红队清单；公开披露流程 |
| 适配器与浏览器 sidecar 需要 Node 运行时（claude-agent-acp、Playwright MCP 均为 npm 包），与“单二进制、≤60 MB”冲突 | 中高 | M0 验证“受管运行时”方案：首次使用时下载固定版本 Node + 适配器到应用数据目录并校验哈希，不依赖用户系统 npx；codex-acp 为 Rust 二进制可直接分发；安装包体积门槛口径明确为“不含按需下载件” |
| 自建内核 + 三外部 Driver + 网格 + UI 对小团队工作量过大（用户原始诉求 #2 是“基于成熟项目二次开发”） | 高 | MVP 不写原生编码 loop；内核按“薄内核 + 库级复用”控制规模；M0 闸门；Plan B = DSH 作 Router 内核（经 ACP/MCP 回调 Hub） |
| 范围蔓延（Goals/Feed/语音/硬件） | 高 | v1 范围收敛红线；每个新需求必须挤掉一项 |
| 许可污染（AGPL/GPL/source-available） | 中 | 许可审计清单；自写办公技能；子进程隔离 GPL 工具 |
| 形象 IP 与商标冲突 | 中 | 发布前商标检索；买断合同；避免模仿 Grok Bot |
| 竞品快速跟进（OpenClaw 新增特性、大厂） | 中 | 聚焦“指挥外部 agent + 安全可审计 + 状态化形象”，快速迭代，社区壁垒 |
| 多机同步一致性复杂 | 中 | v1 单写者 + 远程附着，不做多写复制 |

---

## 20. 待拍板问题

1. **项目名称**（工作代号已统一为 **Muster**，仅用于内部/crate 前缀；对外品牌尚未定。下列为对外品牌候选，主 Bot 默认名 Pip 另算）：
   - **Colony**（群落；强调多 Bot 协作；需商标检索）
   - **Roster**（花名册；直指核心 UI，名称偏中性）
   - **Warren**（兔子洞/据点；适合“多机网格”，吉祥物可做兔子）
   - **Tessera**（镶嵌片；多个 Bot 拼成整体，偏文艺）
   - **Pebble Crew / 石子帮**（可爱路线，吉祥物为小石子形状）
   - 所有候选均**未做商标检索**，不能视为可用。
2. 主吉祥物方向：简单几何体（风险最低）/ 小动物 / 机器人？是否与项目名绑定？
3. Agent 内核：基于 DSH（TS，开发者预览）vs Rust 自建薄内核（建议 M0 PoC 后定）。
4. 开源许可证：Apache-2.0 vs MPL-2.0 vs 其他（影响商业护城河）。
5. 是否首发即做国内渠道（飞书/微信）还是先国际开发者市场？
6. 是否提供托管 Hub（云 VM）及其合规与运营成本边界？
7. 外部 agent 的订阅合规：是否接受“仅用户自带本机登录/Key”这一限制，并为此在宣传中明确？
8. 安全默认值是否允许“信任模式”（降低审批频率）及其门槛？
9. 付费模式与价格带（§13.2 为占位）。
10. v1 是否包含微信渠道（微信接入合规与封号风险较高，调研未覆盖细节）。
11. 团队版（B 端）是否在 12 个月内进入规划。
12. 形象商店是否在 v1.x 提前，以放大社区传播。

---

## 附录 A：调研依据与“未证实”清单

- 依据：`docs/research/01`（竞品全景）、`02`（SuperAgent 与事件架构）、`03`（编程 agent 作子智能体）、`04`（框架选型）、`05`（办公 agent）、`06`（多机与远程浏览器）、`07`（跨平台栈与协议）、`08`（UI 与形象）。
- SuperAgent 出处：DeepSeek Harness 团队 2026-10-31 文章《Super-agent 设计探索：迈向更自主的 Agent 系统》；原型 `deepseek-ai/dsh-superagent-prototype`（MIT，v0.1.0）；底座 `deepseek-ai/deepseek-harness`。需要澄清的认知：“子 agent 有状态/可 fork/可插话”主要是底座 DSH Session 层的能力，而非文章主体内容。
- **未证实/需复核**：DSH 与“SuperAgent”是否同一物；Muse 免费额度（传闻约 1 亿 token）；Cowork 内部细节（第三方逆向）；各云浏览器价格与许可（二手信息）；Kortix/Suna 当前许可；iroh 移动端绑定成熟度；Bun/Node sidecar 打包可行性；goose-agent 的 wasm32 编译；子 agent 任意点 fork 在 DeerFlow 中的存在性（源码未发现）；第三方关于 DSH 安全绕过与 3.8 倍 token 的说法；petdex 精灵许可；本文 §13、§17 的价格与数字目标均为占位假设。
- 合规待办：Claude/Codex 订阅账号被第三方应用驱动的条款核实；vibe-editor2、Poracode 等参考仓库许可证核实（desktop-cc-gui 评审已核实为 MIT）（cc-pane 为 GPL-3.0，仅参考思路）。
