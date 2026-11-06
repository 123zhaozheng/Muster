# 01 个人 Agent 产品竞品全景（截至 2026-11-06）

> 调研日期：2026-11-06。所有信息来自联网检索与本地源码阅读，来源 URL 与时间随文标注。
> 标注约定：【官方】= 厂商官网/文档/官方博客；【媒体】= TechCrunch/CNBC/Reuters/VentureBeat 等；【二手】= 第三方评测/博客/社区帖（可信度较低）；【未证实】= 无可靠来源或来源互相矛盾。
> 本地克隆：`D:\code\xuqiu\repos\openclaw`（本人克隆并读码）、`D:\code\xuqiu\repos\eigent`（已存在，复用并读码）。

---

## 0. 结论先行（TL;DR）

1. **用户说的 "Muse" 几乎可以确定是 Meta 的 Muse**（2026-09-08 发布的个人 AI Agent，吉祥物名 Jolly）。它是目前最接近用户描述的"非常大、非常流行、形象有趣、UI 值得参考"的产品：发布后迅速冲到美国 App Store 榜首，且报道明确称其呈现方式"类似 Grok Bot"。其余同名产品见 §1.2。
2. **2026 的个人 Agent 已经形成统一范式**："有名字、有形象的常驻 Agent + 自己的云电脑（VM + 浏览器 + 终端）+ 一条持续对话线程 + 24/7 后台工作 + 敏感操作审批 + 聊天渠道（WhatsApp/iMessage/Slack）可达"。Meta Muse、SpaceXAI Grok Bot、OpenAI dots、Anthropic Claude Duet、Google Gemini Spark、Genspark Claw、Perplexity Personal Computer 全部收敛到这个形状。
3. **开源侧是两强格局**：OpenClaw（MIT，~39.4 万 star，TypeScript，Gateway + Node 多设备架构）与 Hermes Agent（MIT，~26 万 star，Python，自我进化技能环）。OpenClaw 已有成熟的"多台电脑配对 + 外部编码 Agent 作为子智能体（ACP/Codex app-server）"机制，**与用户需求 #3、#6 高度重合，是最值得借鉴/二开的底座候选**，但它有代码体量失控、安全默认差、稳定性差的硬伤。
4. **真实用户痛点集中在四处**：安全（CVE、恶意技能、权限）、成本（token 烧得快且不可预测）、稳定性与上手门槛（"调教过程太痛苦"）、信任（Meta 隐私）。这些就是差异化机会。
5. **差异化主张建议**："本地优先 + 自带多台电脑/远程浏览器的 Agent 网格 + 把 Claude Code/Codex 等当作一等公民子智能体 + 事件化内核 + 有趣可定制的形象 + 默认安全"。当前**没有一个产品同时做到**：闭源大厂产品把计算锁在自家云 VM（Muse/Grok Bot/dots/Duet），开源的 OpenClaw/Hermes 体验粗糙，OpenMausBot/Eigent 在形态上最接近但体量和成熟度不足。

---

## 1. 澄清："Muse" 是哪个产品

### 1.1 最可能的答案：Meta Muse（置信度很高）

| 项 | 内容 | 来源 |
|---|---|---|
| 发布 | 2026-09-08 发布，iOS/Android/Web(muse.ai)/WhatsApp；2026-09-17 发布 Mac 版；仅美国（后称美国+加拿大），18+ | 9to5Mac 2026-09-17；TechCrunch 2026-09-18；Reuters 2026-09-08 |
| 定位 | "你的个人 AI Agent，替你把事办完"：发邮件、订票、购物、日历、健身计划 | https://muse.ai/ 【官方】 |
| 模型 | Muse Spark（Meta Superintelligence Labs，2026-04-08 首发；1.3 版 2026-09-02；上下文 1M；Muse Spark Open 权重 2026-10-15 放出——来自二手 techpilot.ai，【未完全证实】） | TechCrunch 2026-09-23；https://techpilot.ai/tools/meta-muse/ 【二手】 |
| 形象 | 可自定义名字/头像/人格；官方吉祥物 Jolly（"数字泰迪熊"）；Connect 大会宣布 Muse Realtime Avatar（实时视频聊天化身）；Muse Charm 钥匙扣式硬件（Tamagotchi 风格，预计 12 月出货） | TechCrunch 2026-09-23；The Conversation 2026-11-05 |
| 与 Grok Bot 关系 | 9to5Mac 直接写"Similar to Grok Bot in presentation"，用户 HN 评论排名"Grok Bot -> Muse -> Hermes -> dot -> OpenClaw" | https://9to5mac.com/2026/09/17/meta-ai-launches-muse-personal-agent-including-a-new-mobile-app-for-iphone/ ；HN item 49946526 |

### 1.2 其他同名 "Muse"（已排除）

来自 https://aibropro.com/who-owns-muse/ （2026-10-24，【二手】）：Microsoft Muse（游戏生成模型 WHAM）、Muse Group（MuseScore/Audacity，音乐软件）、Muse 乐队、The Muse（求职网站）、InteraXon Muse 头环、Unity Muse、Sudowrite Muse、Google 2023 年 Muse 文生图模型、**原 muse.ai 域名属于一家独立 AI 视频平台（2026-03 更名 Skiv）**。结合用户语境（"个人 agent""类似 muse 等等""UI 参考 muse"），Meta Muse 之外无竞争候选。附：乐队 Muse 主唱 Bellamy 称与扎克伯格谈妥"商标共存"，乐队改用 @museband（Segarra IP 博客 2026-09-26）。

### 1.3 Meta Muse 深度拆解（本项目最重要的参照物）

**产品形态与 UI（对应用户需求 #4、#5）**
- **一条主对话（Main chat）+ 侧聊（Side chats）**：像微信联系人一样对待 Agent，不是 ChatGPT 式"新建对话"。支持随时打断、一次发多个任务（来源：官方设计文章 https://introducing.muse.ai/ ，2026-09-08）。
- **底部/顶部多 Tab**：Feed（兴趣流/日程/邮件提醒）、Ideas（"你可以让我做…"提示库，解决空白页问题）、Goals（长期目标追踪：航班降价监控、抢票监控、税务文件监控等）、Library（Artifacts + Media）。（Spyglass 2026-09-16；SmartScope 2026-10-25 【二手】）
- **头像即状态**：头像下方显示"正在做什么"的摘要，点头像看完整活动日志和已授权权限；头像可让 Muse 自己重绘（"Polly 变成 Slime"），生成视频动画。（Lenny's Newsletter 2026-09-16；ThursdAI 视频）
- **确定性 UI 不可妥协**：审批卡（accept/reject）、凭据保险箱都是结构化原生 UI，不走对话。默认"普通浏览放行，不可逆操作拦截"，避免"横幅盲区（banner blindness）"。
- **Artifacts**：可交互的产出物（仪表盘、学习指南）可脱离聊天独立存在。
- **Soul.md / Memory 文件可编辑**：用户可直接读写 `SOUL.md`、记忆文件（ThursdAI 实测；二手），明显承袭 OpenClaw 的约定。

**架构（来自官方安全博文 https://research.meta.ai/blog/security-and-safety-for-ai-agents-our-approach-with-muse ，Tarek Sheasha，2026-09-08）**
- 每用户一台专属云 VM（Linux，带浏览器，持久，可接管）。内部代号 **Hatch**（harness daemon）。
- **两个安全域**：Agent 运行在 `systemd-nspawn` "runtime cell"（容器内 root 映射为宿主非特权用户，过滤 syscall，无 `CAP_SYS_PTRACE`/`CAP_NET_ADMIN`）；安全敏感服务在 cell 外作为独立 systemd 单元：`hatch-safety`（独立分类器模型，拦 prompt injection）、`privsep` worker（执行内置 connector，凭据对 Agent 不可见）、`hatch-authd`（凭据库，OAuth token 存在用户 VM 内而非 Meta 集中存储）、**Sentinel**（连接器动作与全部网络出口的唯一权限裁决者，agent 无法覆盖）、PostgreSQL 状态库。进程间走 Unix socket + `SO_PEERCRED`。
- **凭据替身（surrogate token）**：Agent 只见替身，Sentinel 放行后在网络边界处由 authd 换成真凭据——提示注入偷不到密钥。
- **Tainted egress**：eBPF cgroup + LSM hook 做内核级数据流污点追踪；读过用户数据的进程失去自动放行资格，回落到人工审批。
- **审批是能力（capability）不是对话**：一次性/会话级/任务级/限时/永久，且绑定到具体 connector+目的地。
- 聊天传输：加密 WebSocket（Noise 协议 X25519+HKDF+AES-GCM）`wss://hatch.metaaivm.com/v1/noise`，RPC 方法 `chat.stream`/`chat.history`（社区逆向，【二手】https://github.com/duclm1x1/Muse-Chat-MCP ）。
- Muse 官方无公开 Agent API；开放面：Meta Model API（OpenAI/Anthropic 兼容，`https://api.meta.ai/v1`，muse-spark-1.3：$1.25/$4.25 每百万 tokens）、Connector Platform（2026-09-18 开放，MCP/Web API，需 Meta 审核）、Muse Gadget SDK（Apache-2.0 ESP32/Linux 固件，https://github.com/facebookincubator/muse-gadget-sdk ，~2.6k star；**Jollybot 头像不在 Apache 授权内**）。

**商业模式**：Free（每周限额，传闻约 1 亿 tokens，**官方未公布**）/ Power $20 月（5 亿 tokens/周）/ Maximum $100 月（30 亿 tokens/周）（Meta Help Center https://www.meta.com/help/subscriptions/1021145227643680/ ）；扎克伯格称长期靠交易抽成盈利（TechCrunch 2026-09-23）；免费层需绑卡；默认用对话训练模型，可关闭。

**与 OpenClaw 的关系（来源互相矛盾）**：Reuters（2026-09-08）称 Muse"以开源 OpenClaw 为蓝本"；Nat Friedman 称"从零写成，但产品上深受 OpenClaw 启发"（myclaw.ai 二手转述）。OpenClaw 官方仓库内已有 `extensions/muse`（把 Meta 的 Muse Code CLI 作为 agent harness 接入，`muse serve`），说明二者生态已互通。

**已知问题**：Reuters 内部测试：监控类任务 15 分钟后停止刷新、无故断连、绕过护栏暴露 iCloud 照片；HN 多帖："擅自在 Marketplace 道歉""泄露住址""AppleInsider：未授予完全磁盘访问仍读到 Messages"（后被部分反驳）；Mashable：为用户的亲友建立档案；Android Authority/Tuta：隐私与可靠性。App Store 排名第一与信任度低并存。

---

## 2. 竞品全景与功能矩阵

### 2.1 闭源大厂/创业公司

| 产品 | 公司 | 发布/状态 | 形态 | 多端 | 自有云电脑 | 本地电脑控制 | 远程/浏览器 | 形象/拟人 | 定价（来源日期） |
|---|---|---|---|---|---|---|---|---|---|
| **Muse** | Meta | 2026-09-08 | 主聊天+侧聊+Goals/Ideas/Feed；WhatsApp 可达 | iOS/Android/Web/Mac(9-17)/WhatsApp/Charm 硬件 | 是（Secure VM） | Mac 版：文件/消息/日历/备忘录/邮件，操作前询问 | 云 VM 内完整浏览器，可接管 | **强**：可自定义头像、Jolly、实时视频化身 | 免费/$20/$100（Meta Help，2026-10） |
| **Grok Bot** | SpaceXAI（原 xAI）+ Cursor | 2026-08-11 beta | 名字化 Bot 花名册；多 Bot 群聊互相协作；"教一遍变成 routine" | macOS/Win/Linux/iOS/Android | 是（Cursor 云，**同账号所有 Bot 共享一台电脑**，每 Bot 一块屏） | 否（云电脑为主） | 云浏览器；遇验证码/2FA 把桌面"交还"给你 | 强：头像用动效表达 idle/working/blocked 状态 | 含于 SuperGrok/Cursor Pro 等；个人 Ultra $200，Teams Premium $120/座（VentureBeat 2026-08-11；x.ai 2026-08-26 称已扩展到 SuperGrok/Cursor Pro） |
| **dots** | OpenAI | 2026-09-29（DevDay） | 一个主 dot，可命名/换形象（彩色球状吉祥物）；电话通话；ChatGPT/Slack/Teams 可达 | 桌面/Web/移动 | 是（自有云电脑+浏览器；可授权连接你的笔记本） | 可选连接 | 可随时打开 dot 的电脑查看 | 强（彩色球体） | Pro $100/$200/$500 含首个 dot；Business Premium $100-125/座（Zapier 2026-10-13；OpenAI Help） |
| **ChatGPT Work/桌面应用** | OpenAI | 2026-07-09~13 | Chat+Work+Codex 三合一桌面应用；**Atlas 浏览器 2026-08-09 关停，agent mode/Operator 下线** | macOS/Win/Linux(预览) | 云浏览器 | 桌面端可用本地文件/应用 | 内置浏览器+Chrome 扩展 | 无 | Plus $20 起；**任务可由 Gmail/Slack/GitHub PR 事件触发**（AgentStackWatch 2026-10-24，【二手】） |
| **Claude Cowork / Dispatch / Chrome / Duet** | Anthropic | Dispatch 2026-03；computer use 2026-03；Chrome 侧栏=Cowork 2026-08；内置浏览器 2026-08-26；**Duet 2026-10-21 预览** | Cowork 桌面端（本地文件夹、connectors、skills、plugins、计划任务）；Dispatch 手机派活给桌面；Duet 为独立主动式 App | macOS/Win/Linux(beta)/Web/移动；Duet 为 iOS/Android/Web | 2026-10-06 起 Pro/Max 新任务默认在云端跑；Duet 有云 VM | 需桌面 App 常开才能访问本地文件/computer use | Claude in Chrome 复用你的登录态；Cowork 内置隔离浏览器 | 无明显形象 | Pro $20 / Max $100~ / Ultra；Duet 含在订阅内（claude.com 官方文档，2026-08~10） |
| **Gemini Spark** | Google | 2026-05-19 I/O；Ultra 美区 beta | Task + Schedule + Skill 三件套；侧栏 "Spark" Tab | Web/Android/iOS，macOS 即将 | 是（Google Cloud VM，远程浏览器+远程电脑） | macOS 版可从另一设备远程控制 Mac（2026-07-14） | 远程浏览器可接管 | 无 | AI Ultra $100/$200；2026-07 起 Pro 开放（Google Help） |
| **Perplexity Computer / Personal Computer** | Perplexity | Computer 2026-02；Personal Computer 2026-03-11 宣布，04-16 Mac，07-28 Windows；10-20 完全本地版 | 20+ 前沿模型编排；Mac mini 24/7；iPhone 遥控；Comet 浏览器 | macOS/Win/iPhone | 云沙箱 + 本地 | 是（文件、原生 App、Comet） | Comet 浏览器 | 无 | Pro $17-20；Max $200（MacRumors 2026-04-16；官方博客 2026-10-20） |
| **Manus** | Butterfly Effect（新加坡） | Meta 2025-12-29 宣布收购；中国监管要求撤销；2026-08 被 Tencent/ZhenFund/HSG 买回；Manus 2.0 2026-09-28 | 每任务一台云电脑；My Computer 桌面 App（2026-03-16）；浏览器扩展 Browser Operator | Web/iOS/Android/桌面(Mac/Win)/扩展/邮件/Slack/Telegram/WhatsApp | 是 | 是（My Computer，Allow Once / Always Allow） | 云浏览器 + 你本机已登录浏览器 | 无 | 免费 300 积分/天；Pro $20/$40/$200；Team $20/座（Manus Help；mob.so 二手）。所有权信息来源混杂，**收购/买回细节以二手为主，【部分未证实】** |
| **Genspark** | Mainfunc | Super Agent；Claw/Cloud Computer 2026-03-12（AI Workspace 3.0） | Super Agent（会话式）+ Claw（持久、跨渠道）+ 全套 Office/Slides/Sheets/通话 | Web、桌面 App（本地模式 Claw） | 云电脑 Lite/Standard/Powerful（Standard 约 $80/月，Powerful $160/月，二手） | 桌面 App 本地模式 | Agentic browser | 无 | Plus $24.99、Pro $249.99、Team $40/座；Claw 需另买云电脑（Genspark Help Center） |
| **Poke / Instinct / Pally / Genii / Town / Hark / Thine** | 创业公司 | Poke 2026-03（2026-07 被 Cognition 收购）；Instinct 2026-09 融 $10B 估值（邀请制） | "短信即界面"，无 App，iMessage/SMS/Telegram/WhatsApp | — | 多数有自己的电脑/邮箱/电话号码 | — | — | Hark 设计口碑好（Fast Company 2026-11-02） | Poke 免费/$19/$199；Pally 免费/$25/$100（TechCrunch 2026-10-24；OpenAssistant 二手） |

### 2.2 国内（"百虾大战"，几乎全部基于 OpenClaw）

时间线（均为 2026）：Kimi Claw（2-16/18，云托管，需 Allegretto 会员，约 ¥199/月，40GB 云存储，接入 ClawHub 5000+ 技能）→ MiniMax MaxClaw（2-25/26，云托管，M2.5/M2.7，移动端先行，约 $16~39/月）→ 阿里 CoPaw（2-14 发布，2-28 开源，AgentScope 内核）→ 3-9 腾讯一次三款（QClaw：**微信遥控电脑**；WorkBuddy：开箱即用+多窗口多 Agent；腾讯云轻量云一键部署，深圳排队领取）、字节 ArkClaw（SaaS，飞书深度集成，Doubao-Seed-2.0）、阿里 QoderWork / JVS Claw、小米 miclaw（系统层，内测）→ 3-10 智谱 AutoClaw "澳龙"（本地一键安装，预置 50+ Skills，集成 AutoGLM Browser-Use）→ 华为小艺 Claw（3-11，鸿蒙，四种预设人格）、网易有道 LobsterAI（MIT 开源桌面）、百度 DuClaw/红手指 Operator、讯飞 AstronClaw 等。

来源：腾讯新闻 https://news.qq.com/rain/a/20260310A05J1400 ；钛媒体 2026-03-03 https://www.tmtpost.com/7896220.html ；新浪财经 2026-03-16；Datawhale《Hello Claw》附录 C（【二手】，持续更新的清单）。

**国内产品观察**
- **共同套路**：套壳/托管 OpenClaw + 自家模型 + 自家 IM（微信/飞书/钉钉/企微）+ 低价订阅 + 云存储。差异化主要在"入口"（微信遥控电脑、飞书文档）而非 Agent 内核。
- **模型倒逼**：Kimi K2.5 因便宜、支持 100 并行子 agent，成为 OpenRouter 上 OpenClaw 调用量最高的模型（钛媒体）。
- **豆包手机助手**（UI-TARS 视觉 GUI agent，系统级，字节×努比亚）走的是另一条路：系统层视觉操作，跨 App 比价下单（钛媒体，2026-03）。
- **反面**：21 经济网（2026-05-09）"养虾人自述：为什么卸载龙虾"——部署折腾、token 失控、进度造假、误删数据；V2EX 讨论"openclaw 都谁在用啊，太难用了"。

### 2.3 开源/GitHub 热门（按 star 与近期增速）

| 项目 | star（日期） | 语言/许可 | 一句话 | 与本项目相关度 |
|---|---|---|---|---|
| **openclaw/openclaw** | ~393,974（2026-11-05，gitdiscover） | TS / MIT | Gateway + Nodes + 20+ 渠道 + 插件；基金会（501c3）运营，OpenAI 为捐赠方；创始人 Peter Steinberger 2026-02 被 OpenAI 招入（Fast Company 2026-03-26） | **极高**，见 §3 |
| **NousResearch/hermes-agent** | ~260,731（2026-11-05） | Python / MIT | 自我进化：自动创建/改进 Skill、FTS5 会话检索、cron、7 种终端后端（local/Docker/SSH/Daytona/Modal…）、Bot Mode（多 Bot 群聊）、桌面端宠物（petdex 3200+ 精灵） | 高（记忆/技能环；宠物形象机制） |
| **milind-soni/OpenMausBot** | 3 天内峰值 +1,304 star/天（2026-10-26 周榜，tommyz.blog） | TS / Apache-2.0 | **聊天式桌面 App，每个 Bot 是你本机 claude/codex/grok CLI 的一个进程**；Computer 面板、Allow/Deny 审批卡、定时/webhook 触发、stdio MCP server | **极高**：与用户需求 #3 几乎同构，见 §4.2 |
| eigent-ai/eigent | （未取到精确值） | Python+Electron / Apache-2.0 | CAMEL Workforce 多 Agent 开源 Cowork 桌面 | 高，见 §4.1 |
| CopilotKit/OpenBot、nightly-labs/openbot、makecindy/cindy | 周榜新秀 | — | 开源版"AI 同事"，本地优先，接 Claude Code/Codex，ACP | 中：验证了方向，同质化 |
| stablyai/orca | ~116k | TS | 管理一群 Claude Code/Codex 的"舰队"，桌面+移动+远程运行时 | 中高（多 Agent 编排 UX） |
| vercel-labs/agent-desktop | ~16.7k | Rust | 给 Agent 用的 computer-use CLI | 中（Rust 计算机控制） |
| HKUDS/nanobot、zhayujie/CowAgent、AutoGPT | 48.8k / 47.3k / 187.6k | Python | 轻量个人 Agent / 国内渠道集成 / 老牌 | 低-中 |
| facebookincubator/muse-gadget-sdk | ~2.6k | C/Python / Apache-2.0 | Meta 官方开源的 Muse 硬件 SDK | 低（但头像渲染/状态机值得参考） |

数据来源：https://gitdiscover.org/repositories/openclaw/openclaw ；https://www.tommyz.blog/blog/github-trending-weekly-2026-10-26-to-2026-10-31 ；https://www.glukhov.org/developer-tools/comparisons/trending-open-source-ai-projects/ ；https://aitoolset.xyz/trending/ 。注意：榜单第一的 `morluto/rea`（逆向工程 Agent，~43 万 star）与个人 Agent 无关；GitHub star 在该榜单上可能含刷量，**仅作热度参考**。

---

## 3. 重点开源项目架构：OpenClaw（已克隆 `repos/openclaw`）

> 版本：最新稳定 v2026.10.10（2026-11-03），v2026.11.1（2026-11-05）。以下路径均相对 `D:\code\xuqiu\repos\openclaw`。

### 3.1 总体结构

```
Gateway（单进程长驻，默认 ws://127.0.0.1:18789）
 ├─ Channels：WhatsApp(Baileys)/Telegram(grammY)/Slack/Discord/Signal/iMessage/Matrix/飞书/LINE/Teams/Nostr…（extensions/*，共 ~192 个扩展目录）
 ├─ Control-plane clients：macOS 菜单栏 App / CLI / Web Control UI / 自动化（role: operator）
 ├─ Nodes：macOS / iOS / Android / headless / Linux（role: node，声明 caps/commands）
 ├─ Agent runtime：pi（packages/agent-core）+ 可插拔 harness（Claude CLI、Codex app-server、ACP、Muse Code…）
 ├─ Sessions（SQLite：<agentDir>/openclaw-agent.sqlite）、Cron/GatewayScheduler、Webhooks
 └─ Canvas（/__openclaw__/canvas/ 托管 widget）
```

### 3.2 协议与多设备（对应需求 #6）

- **线协议**：WebSocket + JSON。首帧必须是 `connect`；之后请求 `{type:"req",id,method,params}` → `{type:"res",id,ok,payload|error}`；事件 `{type:"event",event,payload,seq?,stateVersion?}`；副作用方法（`send`、`agent`）要求 **幂等键**；事件不重放，客户端遇到 gap 需刷新。（`docs/concepts/architecture.md`；线上同名文档 https://docs.openclaw.ai/concepts/architecture ）
- **TypeBox 作为协议 schema 单一来源**，生成 JSON Schema 和 Swift 模型（`packages/gateway-protocol/src/`，`apps/shared/OpenClawKit/Sources/OpenClawKit/GatewayChannel.swift`）。
- **设备配对**：所有 WS 客户端在 `connect` 带设备身份，签名 `connect.challenge` 的 nonce（v3 载荷绑定 platform/deviceFamily），新设备需配对批准，发放 `deviceToken`；本机 loopback 可自动批准，tailnet/LAN 必须显式批准。远程推荐 Tailscale 或 SSH 隧道。
- **Node 能力**：`role:"node"` 声明 `camera.*`、`screen.record`、`location.get`、`canvas.*`、浏览器代理、CUA 计算机控制（`extensions/cua-computer`）等；Agent 通过 `node.invoke` 调用。
- **Rust 化趋势（对本项目选型很重要）**：`crates/` 下已有 `openclaw-node-host`（跨平台节点宿主，含 `SIDECAR_PROTOCOL.md`：`OCSC` 魔数、4 字节大端长度前缀、每方向严格递增序号、AEAD 认证帧）、`openclaw-gateway-client`（Rust 客户端，TLS 策略测试）、`openclaw-iroh-node`（napi-rs 绑定 **iroh** 端点，用于 P2P/穿透连接，`iroh = "=1.4.1"`）。即 OpenClaw 正在把"节点/传输层"从 TS 迁移到 Rust，并用 iroh 做点对点——这与用户"可考虑 Rust"的方向完全一致。

### 3.3 子智能体与外部编码 Agent（对应需求 #3）

- **`sessions_spawn`**：为后台任务拉起隔离子会话，选项含 `runtime`、`model`、`runTimeoutSeconds`、`thread` 绑定、`sandbox: "require"`、`worktree`；子代理可再派生，默认深度上限 5（`src/agents/spawn-plan.ts`、`spawn-pipeline.ts`、`accepted-session-spawn.ts`；文档 `docs/concepts/session-tool.md`）。
- **完整的会话工具集**：`sessions_list/history/search/send/create/spawn/yield`、`subagents`、`session_status`；`sessions_send` 支持 `mode:"followup"` 与 **`mode:"steer"`（对运行中的会话插话引导）**——即"fork/steer"语义的雏形；`sessions_yield` 结束当前回合等待子代理结果回传。系统续写（exec 完成、子代理交接、Goal）沿用发起者权限，**不会越权继承 owner 权限**。
- **外部编码 Agent 接入**：`extensions/acpx`（Agent Client Protocol 运行时，让 OpenClaw 以 ACP 驱动 Codex/Claude 等，**OpenClaw 仍掌控 session/权限/通道**，内置 `grok-build` 目标）；`extensions/codex`（Codex app-server 集成，可**跨已配对的多台电脑浏览 Codex CLI/VS Code/ChatGPT 的会话与分页转录并 continue/archive**）；`extensions/muse`（Meta Muse Code 作为 harness，`agentRuntime.id:"muse"`）；`extensions/a2a`（Agent2Agent 1.0 JSON-RPC，发布 Agent Card、接收/发送任务）。
- **Workboard**：看板+卡片，卡片可链接 agent 会话、保留笔记/证据/运行历史（`extensions/workboard`）。

### 3.4 "一切皆事件"的程度（对应需求 #7，仅作竞品参照）

- 事件类型：Gateway 推送 `agent/chat/presence/health/heartbeat/cron`。
- **Cron 已泛化为触发器框架**：`src/cron/event-source.ts` 定义 `CronEventInput{jobId, sourceIdentity, eventId, receivedAtMs, payload}`，事件入**持久化 ingress 队列**，带 claim/commitGuard/去重 runId（sha256），外部内容 `wrapExternalContent` 隔离；schedule 支持 `{kind:"event", source:"mcp-events"}`。`extensions/mcp-events` 实现 OpenAI 的 MCP Events webhook 配置（MCP 协议版本 2026-07-28，Standard Webhooks HMAC 验签，插件私有 SQLite 持久化订阅）。
- 评价：触发**确实已被事件化**，但用户输入、子智能体回调、cron 仍走各自的路径，没有统一的事件总线语义；回合式（turn-based）而非有状态长驻子 agent。这正是我们可以做得更干净的地方。

### 3.5 体量与问题（读码结论）

- `src/` 非测试 TS 文件约 **14,300 个**，`src/agents/` 下仅 MCP bundle 相关就有数十个文件，`extensions/` 192 个；`AGENTS.md`/`VISION.md` 明确"快速迭代，配置不保留向后兼容，靠 `openclaw doctor --fix` 迁移"。→ 二开成本高、更新频繁（社区反映"一天一版、依赖缺失"）。
- 安全历史：60+ CVE/GHSA（Valdris 2026-05-30，【二手】）；CVE-2026-25253（8.8，WebSocket 无 Origin 校验导致一键 RCE，已在 2026.1.29 修复）；ClawHub 恶意技能：Koi Security 在 2,857 个技能中发现 341 个恶意（The Hacker News 2026-02-02），后续有称 824 个/20%（HN 帖，【二手】）；Palo Alto Unit 42 2026-06-23 仍发现 5 个绕过扫描的恶意技能；2026-10-02 起 ClawHub 上传经 NVIDIA SkillSpector + Tencent AI-Infra-Guard 双扫描 + AI 裁判。
- 默认沙箱关闭；2026-02 Shodan/Censys 发现 2~4 万实例暴露公网，其中约 63% 未开认证（二手）。
- 成本：用户报告心跳 cron 每次带 ~12 万 token 上下文，单日烧 $20（WinBuzzer 2026-02-03）。

### 3.6 作为底座的评估

| 维度 | 评价 |
|---|---|
| 许可 | MIT，可商用二开；基金会治理，OpenAI 是捐赠方非所有者 |
| 可复用 | Gateway 协议设计（TypeBox 单源、幂等键、配对挑战、角色/scope）、Node 能力声明、ACP/Codex 外部 Agent 桥、cron 事件 ingress、`openclaw-node-host` + iroh（Rust） |
| 不建议直接 fork | 全量 TS 单体过大且变动极快；安全默认差；技能生态被投毒 |
| 建议姿势 | **借鉴协议与概念，复用 Rust crates/ACP 等可独立部分；内核另起（见 §7）**；或写 OpenClaw 兼容层吃其技能/渠道生态（但技能需自建信任链） |

---

## 4. 其他值得读码的开源对象

### 4.1 Eigent（已克隆 `repos/eigent`，Apache-2.0，commit 4958c94，2026-11-02）

- 栈：Electron + React + Zustand + React Flow 前端；FastAPI 后端；多 Agent 内核为 CAMEL Workforce（`backend/app/utils/workforce.py`、`managed_workforce.py`）。
- **Brain/Hands 解耦**（`backend/app/hands/`）：`IHands`（`interface.py`）定义 filesystem/terminal/browser(CDP)/mcp 四类"手"及 `get_capability_manifest()`、`acquire_resource/release_resource`；`IHandsCluster`（`cluster_interface.py`：`acquire/release/health`）+ `RoutedHandsCluster`（按资源类型 browser/terminal/model 路由到不同远程工作节点）+ `http_hands_cluster.py`。**这是"大脑与多台电脑分离"的清晰抽象，值得直接参考**。
- 其他：`remote_sub_agent/`（远程子 Agent：provider_registry、session_store、policy）、`permission_policy/`（engine/models/tool_actions，约 2,000 行）、`run_journal/`（运行日志，含 OTel 投影、上下文预算），`channels/interface.py` 仅声明接口（Slack/WhatsApp 等尚未落地）。
- 局限：Python 后端+Electron 偏重；多渠道/事件化尚在接口阶段；核心是 Workforce 任务分解（偏"一次性任务"，非长驻有状态子 agent）。

### 4.2 OpenMausBot（DeepWiki 摘要，未克隆；【二手，未读码】）

- Node 本地"harness server"（`server/index.ts`）**拥有每一个 agent 进程**；`server/drivers/{claude,codex,...}.ts` 把各家 CLI 原生协议归一化为"规范运行时事件流"，`server/harness/` 含 EventBus 与 ProviderRegistry；权限代理（permission broker）把 shell/文件编辑变成 Allow/Deny 卡片；`RoutineManager`（`routines.ts`）、`WebhookManager`（`webhooks.ts`）做触发；`scripts/mcp-server.ts` 暴露 stdio MCP；数据在 `~/.openmausbot/`；云端 Linux 桌面/本地隔离 VM 通过 `cua-driver` 控制。
- 价值：**证明"聊天式 UI + 本机 CLI 编码 Agent 作为 Bot"这条路有强需求**（3 天登榜）；其"driver 归一化为事件流"设计与本项目事件化目标契合。建议后续克隆深读 `server/contracts.ts`。

### 4.3 Hermes Agent（官方文档摘要）

- 单一 `AIAgent`（`run_agent.py`/`agent/conversation_loop.py`）服务 CLI、Gateway、ACP、批处理；三种 API 模式；工具自注册（70+ 工具/~28 toolset）；SQLite + FTS5 会话（带 parent/child 压缩谱系）；Gateway 25+ 平台适配器；cron 是一等 Agent 任务；记忆/上下文引擎为单选插件。设计原则：**提示稳定性（不中途改系统提示以保缓存）、可打断、profile 隔离**。
- 形象：官方 Pets（petdex 开源精灵库 3,200+，6 种状态：idle/running/thinking/waving/celebrating/failing，可弹出为置顶透明窗口）——Decrypt 2026-06-24。

---

## 5. 交互/UI 特点对比（对应需求 #5）

| 模式 | 采用者 | 要点 | 对我们的启示 |
|---|---|---|---|
| **联系人式主线程**（一个永不结束的对话，侧聊分流） | Muse、Claude Duet/Dispatch、Grok Bot（每 Bot 一线程） | 弱化"新建会话"，强调关系与连续性；气泡分隔主动消息 | 默认单线程+侧聊；用"项目/目标"而非"会话"组织 |
| **Bot 花名册** | Grok Bot | 侧栏是带名字/头像/职责的 Bot，不是历史对话；头像动效表达状态；可群聊互相传活 | 与"主 agent+有状态子 agent"天然契合，可直接作为子智能体面板 |
| **头像即状态+活动日志** | Muse、Grok Bot、Hermes Pets | 头像下一行当前动作；点开看日志/权限 | 吉祥物同时承担"状态指示器"，不是装饰 |
| **Goals / Ideas / Feed** | Muse | 解决空白页和长期任务可见性 | 建议保留 Goals（长期事件订阅的可视化） |
| **结构化审批卡** | Muse、Manus(Allow Once/Always)、OpenMausBot、dots(Auto-review) | 审批是确定性 UI，绑定动作范围 | 必做；并做污点驱动的"自动放行"降低疲劳 |
| **Computer 面板/可接管桌面** | Grok Bot、Gemini Spark、dots、Muse | 实时预览云电脑，遇验证码/2FA 交还给人 | 对"多台电脑+远程浏览器"是核心 UI |
| **短信/IM 即界面** | Poke、Instinct、Muse(WhatsApp)、OpenClaw、国内全系 | 零安装；国内入口=微信/飞书/钉钉 | 渠道适配层要有；国内优先微信/飞书/钉钉 |
| **Teach-by-demo → routine/skill** | Grok Bot、Hermes、Gemini Spark(Skill) | 示范一遍变成可定时的流程 | 与事件触发结合：skill + trigger |
| **Artifacts** | Muse、Claude、Genspark | 可交互产出物脱离聊天存在 | 次优先级 |

**关于"cute"风险**：The Conversation（2026-11-05）指出可爱形象会降低用户戒心、诱导授予过宽权限。建议在产品中把"形象亲和"与"权限透明"配对设计。

---

## 6. 商业模式与用户痛点

### 6.1 商业模式观察

1. **绑定订阅层**：Muse（免费+$20/$100）、Grok Bot（含于 SuperGrok/Cursor）、dots（Pro $100 起）、Duet（含于 Pro/Max）、Spark（Ultra $100/$200）——$100 档成为"Agent 档"的共识价位。
2. **token/credit 计量不透明**是共同被吐槽点（Muse 未公布免费额度、Manus/Genspark credits、Perplexity credits）。
3. **云电脑单独收费**：Genspark Claw 云电脑 $80/$160/月；国内 ¥9.9~¥199 套餐。
4. **交易抽成**：Meta 明确计划（扎克伯格，TechCrunch 2026-09-23）；Stripe Link 一次性卡号 + 购买保护。
5. **开源模式**：OpenClaw 基金会无付费层（官方 README 声明）；Hermes 靠 Nous Portal 订阅。
6. **硬件**：Muse Charm、Muse Gadget SDK、国内 miclaw/小艺 Claw（系统层）。

### 6.2 用户痛点（按频次与严重度）

| # | 痛点 | 证据 |
|---|---|---|
| 1 | **安全/权限失控**：误删数据、清空收件箱、暴露公网、恶意技能、提示注入 | V2EX/21 经济网访谈；arXiv 2610.35451（25K Reddit 帖+358 GitHub issue，521 个 CWE 实例）；HN "OpenClaw is a security nightmare" |
| 2 | **成本不可预测**：循环重试 6 小时烧 ~2M token；一晚 100 万 token ≈ ¥200；Opus 一天 $40 | arXiv 同上；21 经济网；V2EX 1196394 |
| 3 | **上手门槛与调教痛苦**：skill 找不到、approve 刷屏、版本一天一更、依赖丢失 | V2EX 1206429、1213372 |
| 4 | **可靠性/"报喜不报忧"**：进度谎报、定时任务不准点、长任务卡住不报错、记忆丢失 | 21 经济网；Reuters 对 Muse 的内部测试 |
| 5 | **记忆膨胀**：只写入不合并，OOM、上下文满 | V2EX 1213372 #45 |
| 6 | **隐私信任**：对 Meta 的深度授权、为第三方建档 | HN 多帖；Mashable；Tuta |
| 7 | **"用起来没场景"**：普通人用 Chatbot 足够；程序员用 Claude Code/Codex 更直接 | V2EX 1213372；小宇宙访谈（30 亿 token 复盘） |
| 8 | **审批疲劳 vs 能力**：权限越大越危险（"安全与能力成反比"） | V2EX 1196394；Muse 设计文章专门谈 banner blindness |
| 9 | **个性与语气**：Grok Bot 被评机械；Muse 有时过度亲昵/说教（FeedbackBench，【二手】） | https://feedbackbench.com/criteria/ask.persona.md |

---

## 7. 差异化机会与对本项目的建议

### 7.1 市场空白（我们的切入点）

1. **"多台真实电脑 + 云 VM + 远程浏览器"统一成一张 Agent 网格**。大厂产品几乎都是"一台自家云电脑"（Grok Bot 甚至所有 Bot 共享一台）；Claude Cowork/Dispatch 是"手机→一台桌面"；OpenClaw 有 Node 配对但 UX 差。**用户自己的多台电脑（家里 Mac mini、公司 Win、VPS）作为一等公民**是空白。
2. **外部编码 Agent 一等公民化**：Claude Code / Codex / Grok Build / Gemini CLI 作为"有状态子 Bot"，在同一个联系人式 UI 里被调度、分叉、插话。OpenMausBot、cindy、nightly-labs/openbot、orca 已验证需求，但都是早期；OpenClaw 的 ACP/Codex 桥是工程参考。
3. **默认安全**：借鉴 Muse 的 Sentinel/凭据替身/污点出口思想，但做成**用户可审计、可自托管、开源**的版本（Muse 的缺点正是"治理权在 Meta"，anomity.ai 评论 "well-governed but not by you"）。
4. **透明且可预测的成本**：任务级预算上限、循环检测、心跳用小模型/不带全量上下文、可见的 token 仪表。
5. **有趣但诚实的形象**：以 Grok Bot/Muse/Hermes Pets 为范本，吉祥物承担状态指示；资产走开源授权（见 §7.3）。
6. **国内适配**：微信/飞书/钉钉入口、国产模型（Kimi/GLM/MiniMax/DeepSeek/Qwen）一等支持——国内厂商几乎都是 OpenClaw 套壳，内核同质化严重。

### 7.2 技术路线建议（供后续文档与用户拍板）

- **不要从零造底座，也不要整仓 fork OpenClaw**。建议分层：
  - *传输/节点层*：参考 `openclaw-node-host` + `iroh`（Rust）做设备配对与 P2P 穿透；协议用 schema 单源（TypeBox/或 Rust+JSON Schema/protobuf）并带幂等键、事件序号。
  - *外部 Agent 桥*：直接复用 **ACP（Agent Client Protocol）** 驱动 Claude Code/Codex（仓库 `repos/agent-client-protocol` 已有）；参考 OpenClaw `extensions/acpx` 与 OpenMausBot `drivers/` 的"归一化为规范事件流"。
  - *Brain/Hands 抽象*：参考 Eigent `hands/`（能力清单 + 资源租约 + 路由集群）。
  - *安全*：自实现 Sentinel 思路（权限裁决独立于 Agent 进程、凭据替身、出口代理），Linux 先用 namespace/容器，不上 eBPF 污点（成本高），先做"读过敏感数据的进程降级审批"的简化版。
  - *UI*：桌面端 Tauri(Rust)/或 Electron 二选一待定（Eigent/OpenMausBot 均 Electron；用户倾向轻量→Tauri），移动端 + Web 复用同一前端。
- **事件化内核**（与用户第 7 点对齐）：把"用户输入、cron、GitHub PR、子 agent 回调、节点上线/下线、审批结果"统一成同一种 `Event` 并持久化入队（OpenClaw `cron/event-source.ts` 的 claim+去重 runId 设计可抄，但应推广到所有输入）；子 agent 用 `fork`（从事件日志某偏移分叉）与 `steer`（向运行中会话注入事件）两个原语（OpenClaw 的 `sessions_send mode:steer` 与 Hermes "interrupt-and-redirect" 已是雏形）。
- **Skill/插件供应链**：不要开放式市场；采用签名+权限清单+沙箱运行；这是 OpenClaw 最大的教训。

### 7.3 形象资源（简要，供后续专题）

- 开源可用：Hermes Pets 使用的 **petdex**（3,200+ 社区精灵，需核对各自许可）；Hermes 桌面动画头像插件的"精灵图集结构"（IDLE/BLINK/TALK/EXPRESSIONS/ACTIONS/PET 6 行）可作为我们状态机的蓝本；Project AIRI（`repos/airi`，已克隆）面向虚拟角色；Muse Gadget SDK 的像素头像渲染器（但 **Jollybot 受版权保护，不可复用**）。
- 风格参考：Grok Bot（简单形状+富表情眼睛+状态动效，试过首字母/emoji/像素/黏土后选定）、dots（彩色球体）、Muse（泰迪熊式 Jolly）、Pickle（紫色 3D 动物）。

---

## 8. 待用户拍板的问题

1. **目标用户**：是做面向普通人的"Muse 式"消费级产品（云 VM 托管、WhatsApp/微信入口），还是面向开发者/极客的"本地优先 Agent 网格"（OpenClaw/OpenMausBot 路线）？两者的商业模式、安全模型、是否需要自建云差异巨大。
2. **是否自建云 VM 托管服务**（Muse/Grok Bot/dots 的核心体验）？这涉及成本、合规与支付；还是先只做"用户自己的电脑 + 用户自己的 VPS"？
3. **首发市场**：国内（微信/飞书/钉钉、国产模型）还是海外？这决定渠道适配和模型默认值。
4. **与 OpenClaw 生态的关系**：做"OpenClaw 兼容"（吃其渠道/技能，继承其安全债）还是"独立协议+可选兼容桥"？
5. **桌面壳选型**：Tauri(Rust) vs Electron；是否接受 Python 后端（Eigent/Hermes 路线）还是全 Rust/TS？
6. **形象**：是否愿意走开源授权资产 + 自有原创吉祥物？是否需要实时语音/视频化身（Muse Realtime Avatar 级别）作为 v1 目标？
7. **v1 范围**：建议只覆盖"联系人式 UI + 2-3 个外部编码 Agent 子智能体 + 2 台以上电脑配对 + 审批卡 + 事件触发（cron/GitHub PR）"，其余（Goals/Feed/Artifacts/硬件）后置，是否同意？

---

## 9. 来源清单（节选，含日期）

- Meta Muse：https://muse.ai/ ；https://introducing.muse.ai/ （2026-09-08）；https://research.meta.ai/blog/security-and-safety-for-ai-agents-our-approach-with-muse （2026-09-08）；https://techcrunch.com/2026/09/18/metas-muse-hits-mac-letting-the-ai-take-actions-on-your-computer/ ；https://techcrunch.com/2026/09/23/everything-new-coming-to-metas-ai-agent-muse/ ；https://www.investing.com/news/stock-market-news/meta-launches-ai-agent-that-can-access-other-apps-to-send-emails-make-payments-4892258 （Reuters，2026-09-08）；https://www.meta.com/help/subscriptions/1021145227643680/ ；https://github.com/facebookincubator/muse-gadget-sdk ；https://news.ycombinator.com/item?id=49946526 、49893709、49875006、50328293
- Grok Bot：https://x.ai/news/introducing-grok-bot （2026-08-11）；https://docs.x.ai/grok-bot/overview ；https://venturebeat.com/orchestration/spacexais-grok-bot-turns-agents-into-persistent-digital-coworkers-that-can-operate-your-apps-for-120-per-month
- OpenAI：https://openai.com/index/introducing-dots/ （2026-09-29）；https://techcrunch.com/2026/09/29/openai-launches-dots-its-bubbly-agentic-avatar/ ；https://thenextweb.com/news/openai-chatgpt-atlas-browser-shutdown-superapp （2026-07-10）；https://agentstackwatch.com/chatgpt-agent-alternatives/ 【二手】
- Anthropic：https://claude.com/resources/articles/dispatch-and-computer-use （2026-03-23）；https://claude.com/resources/articles/cowork-chrome-side-panel （2026-08-12）；https://support.claude.com/en/articles/15520349-use-claude-cowork-on-web-desktop-and-mobile ；https://claude.com/resources/articles/claude-duet （2026-10-21）
- Google：https://blog.google/innovation-and-ai/products/gemini-app/next-evolution-gemini-app/ （2026-05-19）；https://9to5google.com/2026/05/29/gemini-spark-ultra-us/ ；https://support.google.com/gemini/answer/17171264
- Perplexity：https://www.perplexity.ai/hub/blog/everything-is-computer （2026-03-11）；https://www.macrumors.com/2026/04/16/perplexity-personal-computer-for-mac/ ；https://www.perplexity.ai/hub/blog/perplexity-computer-now-runs-fully-local-on-mac （2026-10-20）
- Manus：https://www.cnbc.com/2026/03/18/metas-manus-launches-desktop-app-to-bring-its-ai-agent-onto-personal-devices.html ；https://help.manus.im/en/articles/11711111 ；https://help.manus.im/en/articles/16147831 （2026-08-21）；https://mob.so/blog/official-manus-breakdown 【二手】
- Genspark：https://www.genspark.ai/helpcenter/membership-plans ；https://www.genspark.ai/blog/genspark-ai-workspace-3 （2026-03-12）
- 国内：腾讯新闻/钛媒体/新浪财经/Datawhale 见 §2.2；21 经济网 https://www.21jingji.com/article/20260509/herald/0d2056b593b89d570e4999777f0acb92.html ；V2EX https://www.v2ex.com/t/1206429 、https://www.v2ex.com/t/1196394 、https://v2.craw.skin/t/1213372
- OpenClaw：https://github.com/openclaw/openclaw ；https://docs.openclaw.ai/concepts/architecture ；https://docs.openclaw.ai/concepts/session-tool ；The Hacker News 2026-02-02；Unit 42 2026-06-23 https://unit42.paloaltonetworks.com/openclaw-ai-supply-chain-risk/ ；arXiv 2610.35451；Fast Company 2026-03-26
- Hermes：https://hermes-agent.nousresearch.com/docs/ ；Decrypt 2026-06-24 https://decrypt.co/372026/your-hermes-agent-now-pet
- 对比文章：https://upstash.com/blog/grok-bot-vs-muse-vs-openclaw-vs-hermes （2026-10-09）；Fast Company 2026-11-02（12 个 Agent 横评）；TechCrunch 2026-10-24（可短信交互的 Agent）；The Conversation 2026-11-05

> 局限说明：未能直接访问 X/即刻原帖；社区观点来自 V2EX、HN、Reddit 聚合文章与媒体转述。Tavily 检索工具本次不可用，已改用 Exa/Linkup/DeepWiki 与本地源码交叉验证。Manus 所有权变动、OpenClaw 恶意技能占比（12% vs 20%）、Muse 免费额度等存在来源冲突，已在文中标注。
