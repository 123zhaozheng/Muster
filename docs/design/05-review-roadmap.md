# 05 - 总架构师评审报告 与 MVP / 路线图

> 日期：2026-11-06　评审人：总架构师兼产品负责人　状态：已执行修订，待用户拍板项见 `docs/06-待拍板问题.md`
> 评审输入：`docs/research/01~08`（8 份调研）、`docs/design/01~04`（PRD / 用户故事 / 架构 / UI-UX）。
> 评审方法：①逐份通读四份设计文档；②读各调研报告的结论段与关键章节，并对设计文档里引用的"硬事实"做抽查；③对设计文档中标"未证实"的若干点，直接读本机 `D:\code\xuqiu\repos` 克隆做了核实（见 §2.5）；④对照用户 9 条原始诉求检查覆盖与偏离。
> 没有做的事：没有联网复核所有调研数据（日期、star 数、价格等沿用调研报告的标注）；没有运行任何克隆仓库的代码；没有做法律意见（条款类一律标"待法务"）。

---

## 0. 评审结论（先看这个）

**总评：方向正确、内容扎实，但"设计"领先"可交付性"一个量级。** 四份设计文档之间的主干一致（Rust Hub + Node + 薄 UI 壳、自有 Thread/Turn/Item/Event、ACP 南向 + 原生逃生舱、默认安全、头像即状态），但存在 **19 处互相矛盾、15 处遗漏、10 处不现实、8 项法律/许可风险**。已就地修正 20 余处（§2.6 修改记录）；无法替用户决定的集中到 `06-待拍板问题.md`。

最重要的 5 个判断：

1. **原稿 P0 有 30 项、28 周，对小团队仍然过大；已切出 10 周 MVP**（§3）：核心闭环 = "一个主 Bot 把任务派给 Claude Code / Codex / OpenCode 三个外部子 Bot，在独立 worktree 里并行干活，可插话、可中断、可从某一步分支、审批卡把关，cron 与 GitHub PR 能触发，第二台电脑可配对，手机 PWA 能批准"。浏览器、原生办公 Worker、记忆 git 库、iroh、出站中继、MCP Apps 全部后置到 M4 及之后。
2. **用户原始诉求 #2 是"基于成熟开源项目二次开发，不要从零造轮子"，而 03 架构选了"自建 Rust 内核"，偏离了 04 调研的"阶段一用 DSH"。** 评审没有简单否决：因为 MVP 不写原生编码 agent loop（最大的"轮子"交给 Claude Code/Codex/OpenCode），自建的只是"事件日志 + 收件箱 + 调度 + Driver 监督"这层薄壳，其余全是库级复用。但这是**一个用户必须知情并拍板的偏离**（Q1），M0 保留切换到 DSH 的止损闸门。
3. **最大的非技术风险是订阅合规，不是技术。** Claude 经 `claude-agent-acp`（基于 Agent SDK）驱动用户已登录二进制是否合规"未证实"；已把 P1 的合规 Gate 提前为 P0-31，并要求 P0-08 必须在 API Key 模式下通过验收。
4. **原稿有几处"听上去对、做起来错"的技术点**：git worktree 被当作沙箱（它不是安全隔离）；"从此处分支"没有 turn 级文件快照就会出现会话与文件状态不一致；vendoring Codex 沙箱 crate 实际会拖入 `codex-protocol`/`codex-otel` 等一串内部 crate；PWA 在 `http://192.168.x.x` 下没有 Service Worker/推送/WebCrypto；`claude-agent-acp` 与 Playwright MCP 都需要 Node 运行时，与"单二进制 ≤60 MB"口径冲突。均已修订。
5. **命名四套并行**（Colony / Roster / Pip / Muster）已统一：工作代号 **Muster**，主 Bot 默认名与吉祥物 **Pip**；对外品牌待商标检索（Q13）。

---

## 1. 评审范围与文档地图

| 文档 | 角色 | 评审后状态 |
|---|---|---|
| `design/01-PRD.md` | 产品范围、P0/P1/P2、里程碑 | 已修订（代号、模式枚举、MVP 切线、P0-31、里程碑、风险） |
| `design/02-user-stories.md` | 场景、Epic、v1 范围 | 已修订（代号、办公范围、TTFV、中继、审批默认） |
| `design/03-architecture.md` | 技术蓝图 | 已修订（ACP crate 核实、沙箱依赖链、适配器分发、合规灰区、PWA 约束、presence 分工、风险分级映射） |
| `design/04-ui-ux-avatar.md` | UI/UX 与形象 | 已修订（代号、风险分级映射、presence 分工、技能页范围、阶段对照） |
| `research/01~08` | 调研 | **未改动**（调研是证据而非决策）；发现的两处调研内部问题记在 §2.5 |

---

## 2. 交叉审查

### 2.1 矛盾（C）

| ID | 位置 | 问题 | 处理 |
|---|---|---|---|
| C1 | PRD / 02 / 03 / 04 | 项目代号四套：PRD=Colony，02=Roster，03=Muster，04=Pip（并把 Pip 同时当产品名和主 agent 名） | **已统一**：工作代号 Muster，Pip=主 Bot 默认名/吉祥物；各文档开头加了统一声明；对外品牌仍待拍板（Q13） |
| C2 | PRD §7.3 vs 03 §4.5/DDL | 事件源模式 PRD=`observe/assist/act`，03=`observe/ask/auto`（DDL 的 CHECK 约束也是后者） | **已修** PRD 对齐 03 |
| C3 | 03 §10.1 vs 04 §4.3 | 风险分级：03 为 R0–R5（R2=本地执行、R3=出网、R4=对外副作用），04 为 R0–R3（R2=范围外写/外网、R3=难撤销）。"只拦 R2/R3"在两边意思不同 | **已修**：以引擎 R0–R5 为准，04 的 4 级为展示折叠，两处都写了映射（UI-R2=引擎 R1(worktree 外)∪R2∪R3；UI-R3=R4∪R5） |
| C4 | PRD §16 / 03 §14.5 / 04 §9 / 02 附录 A | 头像状态词汇三套（03 的 7 态、PRD 的 10 态、04 的 12 态）；且投影函数一处说"daemon 里 Rust 单实现"，另两处说"UI 的 TS 纯函数" | **已修**：词汇以 04 §9.1 为准；**持久态由 Hub `derive_presence`（Rust）权威计算，UI 只叠加瞬态与防抖**，共用 golden JSONL 用例；`offline`→`asleep`，`error`→`blocked`+徽标 |
| C5 | PRD §6.2 vs 03 §4.5 | 子 Bot 深度默认值：PRD=1，03=maxDepth 2 | **已修**：PRD 对齐 03（Router→Worker→一层 helper；外部 agent 为叶子） |
| C6 | PRD §18 / 03 §16 / 04 §12 | 三套里程碑编号（M0–M5 共 28 周 / M0–M3 / P0–P4），范围互相不同 | **已统一**到 §4 的 M0–M4；三处都加了对照说明 |
| C7 | PRD P0-27 / 02 US-902、Q11 / 03 §16 / 04 §12 | 手机遥控能否在 v1 通过"出站中继"工作：PRD、02 说 v1 就有；03 排在 M2；04 排在 P2；中继又需要自有域名 HTTPS 与推送基础设施 | **已修**：MVP 仅 LAN/Tailscale（HTTPS 由 `tailscale serve` 提供）；出站 E2EE 中继在 M4 |
| C8 | 02 §7.1 / PRD P1-03 / 03 §16 | 办公：02 把 US-801–803 放进 v1；PRD 放 P1；03 放 M2；而原生 Worker（办公载体）在 MVP 里根本没有 | **已修**：办公整体移到 v1.x（Q12 让用户确认） |
| C9 | 02 §5.1/§8 vs PRD §14.2/§17 | TTFV：02=中位数 ≤5 分钟；PRD=<10 分钟。而首次使用还要下载受管运行时与适配器 | **已修**：中位数 ≤10 分钟，已装好编程 Agent 者 ≤5 分钟 |
| C10 | 02 Q5 vs 03 §10.1 vs 04 §4.3 | 审批默认值：02="谨慎=所有写操作都问"；03=R1（worktree 内）放行；04=Balanced 只拦 R2/R3 | **已标注、待拍板**（Q10）；工程默认暂按"均衡"，引导步骤提供"谨慎"档 |
| C11 | PRD §12.2(9) vs P1-14；03 §5.3 | PRD 一处说 v1 做容器/namespace 沙箱，一处说容器模式是 P1；03 允许"在沙箱/worktree 内 bypass/yolo"，把 worktree 当沙箱 | **已修**：v1.0 靠路径白名单+审批+外部 agent 自带沙箱；容器 P1；**worktree 不是安全隔离**，MVP 禁止 bypass |
| C12 | 04 §3.7 vs PRD §10 / P1-09 | 04 的技能页有 Featured 安装、Community 分级；PRD/03 明确"v1 不开放市场、签名生态后置"，且线框里的 Excel Pro/PPTX Maker 在 v1 并不存在 | **已修**：v1 技能页仅 Installed + 本地/Git 导入 + 本机外部技能发现 |
| C13 | 04 调研 vs 03 vs PRD vs 02 | Agent 内核：04 推荐阶段一用 DSH；03 推翻并自建；PRD 悬置；02 说"与架构解耦" | **升级为用户待拍板 Q1**，PRD §15 已改成"评审口径" |
| C14 | PRD §17.3、P0-26 vs 03 §15 | 体积/内存：PRD 安装包<100 MB、daemon 空闲<150 MB；03 ≤60 MB、≤80 MB | **口径统一**：PRD 为验收硬门槛，03 为工程目标；安装包口径"不含按需下载件"（已写进两处） |
| C15 | PRD P0-08 / 03 §5.2 / 04 §13 / 03 调研 | 外部引擎品牌口径：PRD="不出现 Claude Code 品牌"；03="UI 称 Claude Agent"；03 调研 §7 明确"可以用纯文本说运行 Claude Code，不得用 Logo/名称作产品名" | **已统一**：允许纯文本来源标注，不用 Logo/吉祥物，不进产品名 |
| C16 | PRD P0-14 vs 03 §4.10 | GitHub 触发：PRD 写"Webhook 或轮询"；03 说本地无公网入口默认轮询，Webhook 依赖出站中继 | **已修**：MVP 仅轮询 |
| C17 | PRD P0-13 | "cron 精度 ±5 s"没有前提；电脑休眠/关机时物理上不可能 | **已修**：加"Hub 在线时"，并与默认补跑 `once` 对齐 |
| C18 | 03 调研 vs 04/07 调研 | 03 调研把 `repos/rust-sdk` 标成"ACP 官方 Rust SDK"；04、07 与源码一致表明它是 **rmcp（MCP）** | 评审读码核实：`repos/rust-sdk` = rmcp 3.9.0；ACP Rust 运行时 crate 是 `agent-client-protocol`（Goose 依赖 2.2.0）。**研究文档不改，03 架构已写明** |
| C19 | PRD §2 vs 02 §2 | 画像命名不一致（阿凯/小米/老陈 vs Lin/Mia/Ken/Ava） | **已加对照**，故事 ID 以 02 为准 |

### 2.2 遗漏（G）

| ID | 遗漏 | 为什么重要 | 处理 |
|---|---|---|---|
| G1 | **适配器运行时分发**：`claude-agent-acp`（npm，需 Node）、Playwright MCP（需 Node）；与"单二进制 ≤60 MB"矛盾；03 调研提了问题但 03 架构没回答 | 直接决定首次体验与安装包体积 | **已补**（03 §5.2）：首次使用下载固定版本 Node+适配器到 `runtimes/`、校验哈希；M0 验证 |
| G2 | **MausBot 未进竞品表**：Apache-2.0、多 bot 桌面聊天、每个联系人驱动本机 claude/codex/grok CLI（来源是其自家博客，二手）——与本产品形态最接近 | 既是竞品，也可能是可借鉴/可复用的底座 | **已补**入 PRD §4.1；M0 读码评估 |
| G3 | **PWA 的 secure-context 约束**（HTTPS 才有 SW/推送/WebCrypto；iOS 推送要添加到主屏幕） | 否则"手机审批"在纯 LAN 下根本做不出推送 | **已补**（03 §7.5） |
| G4 | **团队规模、预算与时间假设缺失**，所有文档只给了美术预算 | 没有人力假设就谈不上 6–10 周 | 本文 §3.1 明示假设（3 全职+兼职设计/法务）；Q19 让用户确认 |
| G5 | **外部 Agent 的测试策略**：契约测试需要真实账号与费用，CI 不可能每次跑真机 | 否则 Driver 回归全靠手测 | M1 加"录制回放夹具 + 每夜真机 smoke"（§4） |
| G6 | **Windows 专项**：用户本机即 Windows 11；claude-agent-acp、worktree 长路径/符号链接、Job Object、ConPTY 都有坑 | 平台一等公民却无专项验收 | M0 增加 Windows 冒烟项（§4.1） |
| G7 | **代码签名与自动更新**：Windows 签名证书/SmartScreen、macOS 公证（Apple Developer）、Tauri updater 密钥；Linux 打包 | 不签名几乎无人敢装，是"流行"的前置条件 | M3 加入；预算见 §7 |
| G8 | **turn 级 git 快照（checkpoint）不在 MVP 清单**：外部引擎的 fork 只分会话历史不分文件；没有快照，"从此处分支"的文件状态是当前 HEAD，不是切点 | 会话与文件不一致，分支结果不可信 | **已补**入 PRD MVP 切线（P0-05） |
| G9 | **官方 Codex `clientInfo.name` 登记**、Anthropic/OpenAI/Google 条款核实仅作"待办"，没有负责人与时点 | 法务周期长，必须 M0 就启动 | §7 并行线 |
| G10 | **MCP 反向通道的 token/作用域**在 MVP 前置依赖大（P0-12），但没有说明 Windows 命名管道 | 子 Bot 回调主 Bot 是核心价值 | M2 明确交付，Windows 用 loopback+随机 token |
| G11 | **测试数据/演示数据**：Demo 脚本、回放式演示模式（02 Q1 建议用演示模式代替试用额度）没有任何排期 | "可录屏传播"是增长钩子，也是内测门槛 | M3 交付 3 条官方 demo 脚本与回放模式 |
| G12 | **GitHub 凭据**：轮询与评论发布需要 token（PAT/GitHub App/`gh` 登录），谁保存、什么 scope 未定义 | S1/S2 的前置 | M2：优先复用用户本机 `gh` 登录，最小 scope，评论一律走审批卡 |
| G13 | **微信接入的合规与封号风险**调研未覆盖（PRD 自己也承认） | 国内渠道别的都能谈，微信不行 | 不进 v1；Q3 |
| G14 | **数据保留/删除/导出**（GDPR/个人信息）：事件日志含用户代码与对话，缺保留策略 | 自托管降低风险但仍需 | M4 加入"导出/清除"命令；不阻塞 MVP |
| G15 | **增长指标缺乏依据**（PRD §17.2：star 5 万、周活 10 万是占位） | 容易被当成承诺 | 本文不采用；§6 改用可验证的 MVP 度量 |

### 2.3 不现实（U）

| ID | 问题 | 评审意见 / 处理 |
|---|---|---|
| U1 | PRD 30 项 P0 + 3 外部 Driver + Hub/Node + 浏览器 + PWA/中继 + 凭据保险箱 + 哈希链 + L0 形象 + 安装包，28 周 | 切成 MVP（10 周）+ v1.0（再 10 周）；见 §3 |
| U2 | 03 §3.2"vendor Codex 沙箱 crate" | 核实依赖：`codex-linux-sandbox` 依赖 `codex-protocol`/`codex-network-proxy`/`codex-process-hardening`/`codex-uds`/`codex-install-context`…；`codex-sandboxing` 再依赖 `codex-windows-sandbox`/`codex-mxc-sandbox`…；workspace 版本 `0.0.0` 未发布。**不是"拷几个 crate"**，已下调；MVP 不依赖 OS 级沙箱 |
| U3 | 一个 Rust daemon 同时承担 journal、策略引擎、凭据代理、Egress Proxy、MCP 宿主、记忆 git 库、梦境整理、浏览器路由、relay 客户端、ACP-server、AG-UI… | 对小团队是过度设计；MVP 只做 journal + kernel + router(rules) + drivers + policy(approval) + gateway + node + sources(cron/gh) |
| U4 | 原生 Session 前缀共享树形 fork + 合成 tool result + 副作用账本 + checkpoint | 属于"原生 Worker"这条线；MVP 不做原生 Worker，fork 全靠外部引擎原生 fork + worktree + turn 快照。账本在 MVP 只记录不拦截（"只记账"） |
| U5 | 浏览器 A 档 + Computer 面板（<2 s 实时画面）+ 人工接管放在 M3（网格阶段）一起交付 | Node 依赖、CDP screencast、接管租约三件事叠加；移到 M4 |
| U6 | "分支树 React Flow 视图"在 UI P2 | MVP 用分支选择器 + 列表（02 §7.2 S7 已允许简化） |
| U7 | `_session/steering` 是 ACP 扩展，架构把 steer 的 Claude/Codex-acp 路径建立在它上面，但没有实测 | M0 第一周内必须实测；不通则走 Codex app-server 原生 + Claude SDK `priority` |
| U8 | 50 个头像同屏 60 fps、Rive 并发上限、WebGL 上下文上限均未验证 | MVP 只做 L0 SVG；Rive 随 M4 的 L1 主 IP |
| U9 | 增长目标 star/周活（G15） | 不进计划 |
| U10 | 国产模型、飞书、微信、画师渠道、桌面托管云同时推进 | 非同一优先级；见 Q2/Q3/Q4 |

### 2.4 法律 / 许可证风险（L）

| ID | 风险 | 级别 | 处理 |
|---|---|---|---|
| L1 | **Anthropic 订阅模式驱动**：条款要求第三方产品（含使用 Agent SDK 者）用 API Key，不得提供 claude.ai 登录或路由订阅额度；"终端用户登录未修改 Claude Code 二进制"不被限制——但"第三方应用经 SDK 适配器驱动该二进制"是否落在豁免内**未证实**；2026-01～02 有封禁第三方抓取订阅 token 的先例（二手报道） | 高 | P0-31 合规 Gate；验收只在 API Key/Bedrock/Vertex 下；订阅模式默认关闭；不碰 token；不宣传；法务确认（Q5） |
| L2 | **OpenAI Codex**：app-server 是官方集成面，`clientInfo.name` 需登记，第三方分发条款未读 | 中 | 同 L1 的 Gate；M0 提交登记；法务 |
| L3 | **Google（Gemini CLI/agy）**条款未核 | 低（非 MVP） | 不进 MVP |
| L4 | **品牌/商标**：产品名与 Pip 吉祥物未做检索；Pip 形象（天线芽+圆珠眼）与 Grok Bot 要有明显差异；不用 Claude/Codex/Grok 的 Logo；DSH 品牌条款禁止产品名直接用 "DeepSeek Harness" | 中高 | Q13；画师 brief 写禁区；NOTICE 如实标注 |
| L5 | **AGPL/GPL 污染**：RustDesk（AGPL）、Skyvern（AGPL）、Open Interpreter 01（AGPL）、nanoMuse（GPL-3.0）、cc-pane（GPL-3.0）、Pandoc（GPL） | 中 | 只借鉴设计、不拷代码、不链接；Pandoc 仅子进程；CI 加 `cargo deny` 与前端许可扫描 |
| L6 | **Anthropic 官方 docx/xlsx/pptx/pdf 技能**为 source-available，禁止复制/派生 | 高（若误用） | 自写；DeerFlow 的 `ppt-generation` 等随仓库 MIT，但 `frontend-design`、`skill-creator` 带独立 Apache-2.0 `LICENSE.txt`——**逐技能核对来源与许可再复用** |
| L7 | **限制性/商业许可**：Restate（BSL）、Browserless（SSPL）、NetBird 服务端（AGPL） | 低 | 不进桌面；仅云端可选或不用 |
| L8 | **第三方素材/字体/AI 生成物**：AI 平台免费版多不可商用；VRoid 条款；Live2D 发行授权；国产字体（MiSans/HarmonyOS Sans）商用条款未核；OpenMoji CC BY-SA | 中 | 只用 OFL 字体；主 IP 由人类画师重绘买断；L0 自研；VRM/Live2D 后置 |

**许可核实（评审读 `repos/*/LICENSE` 的结果）**：openclaw MIT；deepseek-harness MIT；dsh-superagent-prototype MIT；opencode MIT；pi-mono MIT；deer-flow MIT；rig MIT；assistant-ui MIT；airi MIT；three-vrm MIT；OpenHands / software-agent-sdk MIT；goose、eigent、iroh Apache-2.0；ai-elements Apache-2.0；codex workspace Apache-2.0；rmcp Apache-2.0；**desktop-cc-gui MIT**（03 原写"未核许可"，已更新）。均为"根 LICENSE 文件"级核实，复用具体文件前仍需逐文件/逐依赖核对。

**核心 daemon 自身许可**：建议 Apache-2.0（与全部依赖兼容，无 copyleft 传染），护城河靠商标 + 托管服务 + 社区，而不是许可（Q6）。

### 2.5 评审中直接读码核实的点

| 核实项 | 结果 |
|---|---|
| ACP Rust SDK 包名（03 原标"未证实"） | `agent-client-protocol`（运行时，crates.io）+ `agent-client-protocol-schema`（本地 1.15.1）+ `-http`；`repos/goose/Cargo.toml` 依赖 `agent-client-protocol = 2.2.0`、`-http = 2.2.0`、`-schema = =1.9.1`。注意与 ACP 协议 v1/v2 的版本号不是一回事 |
| `repos/rust-sdk` 是什么 | rmcp 3.9.0（Apache-2.0），**不是** ACP SDK（03 调研报告标注有误） |
| Codex 沙箱 crate 能否独立 vendor | 不能轻易：见 U2 |
| desktop-cc-gui 许可 | MIT |
| DeerFlow 技能许可 | 见 L6 |

### 2.6 修改记录（就地编辑，保留原结构）

**`design/01-PRD.md`**
1. 标题与头部：代号 Colony→Muster，加"代号统一"说明与指向本文；§5 模块树根、P1-08、§17.1、§20 Q1 同步。
2. §2：加画像对照注释（C19）。
3. §4.1 竞品表：补 MausBot 行（G2）。
4. §6.2：子 Bot 深度对齐 03（C5）。
5. §7.3：模式枚举 `observe/ask/auto`（C2）。
6. §9.1：P0-08 重写（API Key 模式必过验收；订阅模式为灰区默认关闭；品牌口径，L1/C15）；P0-13（Hub 在线前提 + 默认补跑 `once`，C17）；P0-14（MVP 仅轮询，C16）；P0-22（presence 分工，C4）；P0-26（体积口径，C14）；P0-27（LAN/Tailscale + HTTPS，C7/G3）；**新增 P0-31 订阅合规 Gate**（由 P1-15 提前）；新增"MVP 切线"说明块（U1，含 turn 级快照 G8）。
7. §12.2(9)：沙箱路线与 worktree 非隔离（C11）。
8. §15：Agent 内核行改为评审口径（C13）。
9. §16：头像状态词汇（C4）。
10. §18：里程碑整体替换为 M0–M4（C6）。
11. §19：新增两条风险（Node 运行时分发；工作量与诉求 #2）。
12. 附录 A：desktop-cc-gui 许可已核实。

**`design/02-user-stories.md`**
1. 头部与全文 Roster→Muster（保留"花名册/Roster"作 UI 名词与品牌候选）；加"以 05 为准"说明（C1/C6）。
2. §5.1、§8、US-101：TTFV 口径（C9）。
3. §7.1 Epic 8、§7.2 S4：办公移出 v1.0（C8）。
4. US-901/US-902：PWA 的 HTTPS/iOS 限制与中继降级（C7/G3）。
5. Q5：标注与 03/04 的冲突并指向用户拍板（C10）。Q11：中继排期（C7）。Q12：升级为 Q1。§10.1：代号已统一说明。

**`design/03-architecture.md`**
1. 头部说明、标题：代号与评审标注。
2. §3.2：ACP crate 已核实（C18）；Codex 沙箱 crate 行重写（U2）。
3. §3.3：加"与用户诉求 #2 的张力"提示（C13）。
4. §5.2 末：新增适配器运行时分发（G1）。
5. §5.3："bypass/yolo"改为 MVP 禁止，worktree≠隔离（C11）。
6. §5.4：新增第 5 条合规灰区说明（L1）。
7. §7.5：PWA secure-context 约束（G3）。
8. §10.1：与 UI 展示分级映射（C3）。
9. §10.5：Linux 沙箱依赖链提示（U2）。
10. §14.5：presence 分工、`AvatarState` 词汇（C4）。
11. §15：安装包口径（C14）。
12. §16：加里程碑对照并裁剪说明（C6）；原 M1/M2 标签加对照。
13. §19/§20：代号统一说明；ACP 与沙箱"未证实"项更新；desktop-cc-gui 许可更新。

**`design/04-ui-ux-avatar.md`**
1. 头部：评审说明；§0 第 7 条、导航树根、技能详情的 Publisher：产品名 Pip→Muster。
2. §3.7：技能页 v1 范围（C12）。
3. §4.3：风险分级映射（C3）。
4. §9.2：presence 分工（C4）。
5. §12：UI 阶段与里程碑对照（C6）。
6. §14.1：代号口径。

---

## 3. MVP 定义

### 3.1 假设

- **团队**：3 名全职（Rust 内核/驱动 ×2，前端/设计工程 ×1）+ 兼职产品/设计 + 兼职法务咨询。**人手减半则周期约翻倍**；若是 1 个人，MVP 应只保留"单机 + 2 个外部 Bot + 审批 + 插话/分支"（见 §3.4 的 6 周极限版再砍一半）。
- **平台**：Windows 11 与 macOS 一等公民，Linux 尽力而为（WebKitGTK 依赖）。
- **模型**：用户自带（API Key）；MVP 的 Router 用 OpenAI 兼容端点（DeepSeek/Kimi/GLM/Anthropic 均可），不内置共享 Key，不提供试用额度。
- **起算**：以 2026-11-09（周一）为 W1。不含春节（2027-02 初）与法定假期，实际日历时间需加 1–2 周缓冲。

### 3.2 MVP 的"闭环"一句话

> 用户装好 Muster，向主 Bot Pip 说"shop-api 里两件事，一个交给 Codex、一个交给 Claude"，两个外部子 Bot 在各自的 worktree 里并行工作；用户可随时**插话**、**中断**、**从某一步分支**；任何写操作之外的动作弹出**审批卡**（电脑或手机 PWA）；一条 **cron** 或一个 **GitHub PR** 事件也能自动唤起子 Bot（默认 observe/ask，不自作主张）；第二台电脑配对后可远程跑测试；成本与审计可查。

### 3.3 范围表

| 能力 | MVP（M0–M3，约 10 周） | v1.0 公开 Beta（M4） | 之后 |
|---|---|---|---|
| 内核 | journal(SQLite WAL, 单写者)、幂等、inbox、effect outbox、崩溃恢复、哈希链（最小） | 原生 Session 前缀共享 fork、副作用账本拦截 | Restate 之类不做 |
| 主 Bot | 规则路由 + 最小 LLM 工具循环（`dispatch/reply/ask_user/note`），无 Bash | 小模型慢路径批处理、NotifyGate 打分 | 记忆梦境 |
| 外部 Bot | Codex（app-server 原生）、Claude Code（claude-agent-acp，API Key 验收）、OpenCode 或 Goose（ACP，二选一） | 更多 ACP Registry agent | Antigravity/agy、Cline… |
| 子 Bot 原语 | steer/followup/interrupt；外部引擎原生 fork + worktree + turn 级 git 快照 + 降级提示 | 原生 Worker 的树形 fork | 跨引擎摘要交接完善 |
| 触发 | 用户、cron、GitHub 轮询（opt-in 仓库、observe/ask）、子 Bot 回调（内置 MCP）、设备上下线 | 通用 Webhook（经中继）、Watchdog、渠道（飞书） | fs-watch、邮件 |
| 多机 | Node：WS + 配对码 + Ed25519 + 短指纹核对、`node.invoke`（exec/fs/agent.spawn）、断线 resume | iroh + 自托管 relay | 手机作 Node |
| 浏览器 | —（外部 agent 可自挂 Playwright MCP，不由我们托管） | A 档隔离 profile + Computer 面板 + 接管；C 档填 CDP URL | B 档真实 Chrome |
| 手机 | PWA（LAN/Tailscale，HTTPS）：时间线、审批、插话 | 出站 E2EE 中继 + Web Push | Tauri mobile |
| 安全 | 原生审批卡、R0–R5 策略引擎、无人值守自动拒、Untrusted 标记（GitHub 来源只允许 observe/ask）、API Key 入 OS 钥匙串、合规 Gate | 凭据代理/Egress Proxy、记忆待审队列、容器沙箱（P1） | 技能签名 |
| 成本 | token 计量、任务预算硬上限、循环检测 | 金额估算与价格表 | 建议类优化 |
| UI | 联系人式花名册、异构时间线、审批卡、收件箱(精简)、右侧 Diff/终端/日志面板、L0 头像 7 个持久态、设备页、触发器页(精简)、引导 | 分支树视图、Computer 面板、Rive 主 IP | 悬浮宠物、语音 |
| 办公/原生 Worker | — | 原生 Worker（研究/办公最小闭环） | 完整办公技能 |
| 记忆 | 偏好小表（可查看/删除） | `mind/` git 记忆库、FTS5 | 向量、梦境 |
| 分发 | Win 安装包（签名）、macOS dmg（公证）、Linux AppImage（尽力） | 自动更新、文档站 | — |

### 3.4 6 周极限版（若要更早出 Demo）

M0 压缩为 1 周（只验 Codex app-server + 一个 ACP agent）+ M1 3 周 + 2 周收口。**砍掉**：Claude Driver、Node/多机、PWA、GitHub、MCP 回调。保留 cron、审批、插话/中断/分支、worktree+快照、L0 头像、桌面壳。可录出 S1/S7/S8 三条 demo，但"多机""事件驱动"两个卖点缺位，不建议对外公开发布，只做内部/天使用户演示。

### 3.5 MVP 的用户故事覆盖

| 场景 | MVP | 说明 |
|---|---|---|
| S1 并行派发 | 完整 | 3 个外部 Bot 中任意 2 个 |
| S2 PR 审查 | 完整（仅生成评论草稿 + 审批后发布） | 轮询，观察/询问模式 |
| S3 定时 | 3a 完整；3b（Goals）后置 | |
| S4 办公 | 无 | 移至 v1.x |
| S5 跨机 | 完整 | WS + 配对码，LAN/Tailscale |
| S6 远程浏览器 | 无 | M4 |
| S7 分支重试 | 完整（列表式分支树） | 依赖 turn 快照 |
| S8 插话 | 完整 | |
| S9 回调通知 | 规则版 | |
| S10 移动审批 | LAN/Tailscale 下的 PWA | 无中继推送 |
| S11 注入拦截 | 简化版 | GitHub 来源=Untrusted，只允许 observe/ask，无人值守审批自动拒 |
| S12 成本 | 仪表 + 硬上限 | |

---

## 4. 路线图 M0–M4

> 周次为人月比例假设下的工作周；每个里程碑末做"门评审"：交付物齐全 + 验收标准全绿 + 风险清单更新，未过不进入下一里程碑。

### M0（W1–W2）Spike 与止损闸门

**目标**：用最小成本证明三件事：①Rust 能稳定驱动 3 个外部 Agent 并拿到 steer/fork/interrupt；②薄内核（journal + 恢复）能成立；③Windows 上 sidecar/进程树/运行时分发无阻断。同时启动三条非工程并行线（§7）。

**交付物**
1. `spikes/acp-client`：用 `agent-client-protocol` crate 驱动 `codex-acp`、`opencode acp`、`claude-agent-acp`（API Key），跑通 `initialize→session/new→prompt→request_permission→cancel→session/load`，事件落 JSONL；实测 `_session/steering`。
2. `spikes/codex-appserver`：`generate-json-schema` 生成绑定；`thread/start→turn/start→turn/steer→thread/fork→turn/interrupt`。
3. 内核骨架：journal 写线程 + `event/session/session_event/session_inbox/effect` 表 + 幂等 + 哈希链 + 崩溃恢复；Router 最小循环（OpenAI 兼容流式 tool-call）；`rig-core` vs `openai_compat` 取舍结论。
4. Tauri 2 + React 骨架：`musterd` sidecar，loopback + 一次性 token WS，托盘，关窗口后 daemon 继续运行（Windows 优先，WebKit/Chromium 双内核冒烟）。
5. 受管运行时 PoC：干净 Windows 虚拟机首次使用下载 Node + `claude-agent-acp` 并校验哈希。
6. 评估记录：DSH 作 Router 内核（经 ACP/MCP 回调）的可行性；MausBot / desktop-cc-gui 读码结论；Codex 沙箱 crate 三选一（限时 1 天）。
7. 三条并行线启动工单（法务 ToS 清单、商标/域名检索、主 IP 画师 brief）。

**验收标准（门评审）**
- G1：三个 Agent 各完成 ≥1 次带权限请求的 prompt 往返，JSONL 可回放；steer 在 Codex 上有效、在 Claude/OpenCode 上有效或有明确降级路径。
- G2：`kill -9` 压测：连续追加 1000 事件中途强杀，重启后 0 丢失、0 重复（含幂等键）。
- G3：Windows 上 daemon 脱离 UI 生命周期存活；杀进程树（Job Object）后无孤儿进程。
- G4：Router 最小循环在 DeepSeek/Kimi/Anthropic 三类端点上流式 tool-call 正确；`rig-core` 采纳与否有结论。
- G5：受管运行时在干净 Win11 上 60 秒内（典型网络）就绪。

**止损规则**：G1–G5 中失败 ≥2 项，或原生 Router 循环 + journal + 恢复 + steer 无法在 W2 末演示 → 启用 **Plan B：DSH 作 Router 内核（TS sidecar，经 ACP/MCP 与 Rust Hub 对接），Hub 仍用 Rust**；对外 WS 协议不变，UI 不返工。

### M1（W3–W5）单机指挥台

**目标**：单机上，主 Bot 能把任务派给外部 Bot 并行工作，用户能完整控制。

**交付物**：`AgentDriver` trait + 能力矩阵 + 降级逻辑；CodexAppServerDriver、AcpDriver（Claude/OpenCode）；canonical 事件与 `mirror` 摘要镜像；worktree 管理 + turn 级 git 快照；插话/排队/中断/分支（外部原生 fork）；策略引擎 v0（R0–R5 → Allow/Ask/Deny）+ 原生审批卡 + 超时自动拒；Router 规则路由 + `dispatch` 工具；花名册 + 异构时间线 + 审批卡 + 右侧 Diff/终端/日志面板；L0 头像（SVG，7 持久态 + 瞬态叠加）；Win/Mac 开发版安装包；录制回放夹具与每夜真机 smoke。

**验收标准**
- A1：S1 demo（并行派发 2 个任务到 Codex 与 Claude，各自 worktree）在 Windows 与 macOS 上**连续 10 次**成功。
- A2：对运行中任务插话，Codex 为"下一步生效"，降级引擎在气泡上显式标注；`expected_turn_id` 失配时自动转 followup 且不丢消息。
- A3：从任一 turn 快照分支，新 worktree 文件内容与切点一致（以自动化用例断言）。
- A4：审批卡由结构化数据渲染，模型无法影响其文本；超时 10 分钟自动拒；无人值守触发的审批自动拒。
- A5：Driver 契约测试 ≥15 条，3 个 Driver 全部通过（回放夹具）。
- A6：5 秒测试——旁观者能指出"谁在干活、谁在等我"。

### M2（W6–W8）事件与网格

**目标**：事件驱动与多机——产品相对其他"桌面聊天壳"的核心差异化落地。

**交付物**：schedule（cron/一次性/间隔，`catch_up` 默认 `once`）；GitHub 轮询 Source（ETag、opt-in 仓库、`source_binding`、observe/ask）；`muster-mcp-bridge`（`notify_parent/ask_user/emit_event/task.report`，session 级 token）；Router→Task→Thread 订阅直通；NotifyGate 规则版；`muster-node` + 配对（一次性码 10 分钟、Ed25519、SAS 短指纹、扩权再审批）+ `node.invoke`（exec/fs/agent.spawn）+ stdio 隧道 + 帧环形缓冲 + `task.resume`；成本计量、任务预算熔断、循环检测；审计导出/校验命令；PWA（LAN/Tailscale HTTPS）：时间线/审批/插话；设备页与触发器页(精简)。

**验收标准**
- B1：同一 GitHub 事件重复投递 10 次只触发 1 个任务（轮询去重）；`kill -9` Hub 后重启，不丢事件、**不重复发评论**。
- B2：S2：PR 打开 → observe 记录 → 用户切 ask → 生成评论草稿 → 审批卡批准 → 评论发布；PR 内容中的"指令"不被执行（Untrusted）。
- B3：S5：两台电脑配对，在远端台式机上跑测试并流式回传；断网 30 秒后自动 resume，不丢帧。
- B4：S10：手机 PWA（Tailscale）批准一次需审批的操作，延迟 <3 s。
- B5：配对码重放失败；撤销后立即断连；公钥变化不自动批准。
- B6：预算触顶后任务自动暂停并发事件；`muster audit verify` 能发现人为篡改。

### M3（W9–W10）MVP 收口与内测

**目标**：把 M1–M2 的功能变成"别人也能装、能用、不丢数据"的东西。

**交付物**：P0-31 合规 Gate + 登录方式检测；API Key 入 OS 钥匙串；日志/快照明文密钥扫描测试；混沌测试集（崩溃、断线、fork 悬空、重复事件）；红队清单 v1（提示注入、路径穿越、配对重放、越权升级）；安装包与签名（Windows 代码签名、macOS 公证、Linux AppImage）+ 自动更新密钥；6 步引导（命名→形象→探测并加入本机 claude/codex/opencode→可选配对→官方 demo）；3 条官方 demo 脚本 + 回放式演示模式（替代试用额度）；种子用户招募与反馈通道。

**验收标准（= MVP 发布门）**
- D1：20–30 位种子用户（目标：≥60% 为多机开发者）中，**中位数 TTFV ≤10 分钟**，已装好编程 Agent 者 ≤5 分钟。
- D2：Win11 / macOS 14+ / Ubuntu 24.04 干净机安装成功率 ≥90%；崩溃率 <0.5%/会话。
- D3：红队清单 0 个高危未修复；明文凭据扫描 0 命中。
- D4：2 周内 ≥60% 内测用户至少使用过一次 steer 或 fork（验证差异化被感知）。
- D5：≥50% 的内测用户配置了至少 1 个 cron/GitHub 触发。
- D6：法务对 Claude/Codex 使用方式出具书面意见，或确定"仅 API Key"的对外口径。

### M4（W11–W20）v1.0 公开 Beta

**目标**：补齐用户原始诉求中 MVP 未覆盖的部分（远程浏览器、自带子智能体办公/研究、互联网可达的手机端）并公开发布。

**交付物（可按 Q 的结论裁剪顺序）**：浏览器 A 档（Playwright MCP 受管 sidecar）+ Computer 面板三级可见性 + 人工接管；C 档填 CDP URL；原生 Worker（研究/办公最小闭环：读取转换、Word/Excel/PPTX/PDF 自写技能、渲染校验回路）+ 原生 Session 树形 fork；`mind/` 记忆 git 库 + FTS5 + 待审队列；出站 E2EE 中继（Cloudflare Worker，可自托管）+ Web Push；SKILL.md 兼容；凭据代理 + Egress Proxy；L1 主 IP（Rive）；分支树视图；Watchdog；飞书渠道（若 Q3 为国内优先）；文档站、安全白皮书、公开 Beta 发布。

**验收标准**：对应 PRD P0-04/18/19/20/24/28/29 及 §7.4/§12.3 验收摘要；公开 Beta 前通过外部安全评审或至少一轮第三方渗透；星标/周活等数字不作为验收项。

**M4 之后（P1）**：iroh + 自托管 relay、MCP Apps、ACP-server 北向、容器沙箱、技能签名、通用 Webhook、Tauri mobile、形象商店。

---

## 5. 第一周（W1）具体开发任务清单

> 角色：**R1** Rust 内核；**R2** Rust 驱动/网络；**FE** 前端/设计工程；**PM** 产品/负责人。每个任务的"完成"要有可检查的产物。

### 周一（Day 1）：脚手架与对齐
- **R1+R2**：建仓库 `muster/`：Cargo workspace（`crates/proto`、`journal`、`kernel`、`drivers/{driver-api,acp,codex}`、`musterd`、`muster-cli`）+ pnpm workspace（`apps/web`、`apps/desktop`、`packages/protocol`、`packages/mascot`）；`LICENSE`(Apache-2.0)、`NOTICE`、`docs/adr/`；CI 矩阵（Windows/macOS/Linux：`cargo fmt/clippy/test`、`cargo-deny`、`pnpm lint/test`）。产物：CI 三平台绿。
- **R2**：准备测试环境：一个 Anthropic API Key（Claude 验收用）、Codex 登录/Key、OpenCode 配好一个国产模型 Key；两台机器（Win + Mac/Linux）装好 Tailscale 与 `gh`。
- **PM**：发出三张并行工单——①法务 ToS 清单（Claude/Codex/Google，含 `clientInfo.name` 登记）；②商标/域名检索（Muster、Pip、候选品牌，国内+美国）；③主 IP 画师 brief（含 Grok Bot/Clawd/Codex 云/Cursor 方块的禁区）。产物：三张工单有负责人与截止日。

### 周二（Day 2）：协议与 journal
- **R1**：`proto` crate：`Event` 信封 + 最小 `EventKind`（`user.message/steer/interrupt`、`session.*`、`approval.*`、`schedule.fired`）；`schemars`→JSON Schema→TS 类型生成管线（`packages/protocol`）。`journal`：SQLite WAL 建表（`event/session/session_event/session_inbox/effect`）、单写者线程、`(source,idem_key)` 幂等、blake3 哈希链。
- **R2**：ACP 客户端 spike A：`codex-acp` → `initialize/session/new/prompt/permission/cancel`，事件写 JSONL。
- **FE**：Tauri 2 + React + Vite 骨架；WS 客户端对接"假 musterd"（回放 JSONL 脚本发事件）；design token（方案 A）。

### 周三（Day 3）：Driver 与恢复
- **R1**：崩溃恢复：启动时扫描 `effect` outbox、对 `running` 会话写 `turn/end{crashed}`；`kill -9` 压测脚本（1000 事件）。
- **R2**：spike A 扩展到 `opencode acp`；然后 `claude-agent-acp`（API Key）；记录各自对 `_session/steering`、`session/fork` 的支持矩阵。
- **FE**：L0 头像：3 种形状 × 眼睛 SVG；`deriveAvatarState` UI 薄层（瞬态+防抖）+ golden 用例；花名册组件展示 5 个模拟 Bot 的 7 种持久态。

### 周四（Day 4）：Codex 原生与运行时
- **R2**：Codex app-server spike B：`generate-json-schema` 生成绑定，`thread/start→turn/start→turn/steer→thread/fork→turn/interrupt`；记录协议版本与握手校验字段。
- **R1**：Router 最小循环：OpenAI 兼容流式 tool-call（DeepSeek/Kimi/Anthropic 各一次）；`rig-core` 对比结论草稿。
- **FE**：`musterd` 假 sidecar 由 Tauri 拉起，loopback + 一次性 token WS；关窗口后进程仍在（Windows 先）。
- **R2（下午）**：受管运行时 PoC：脚本下载固定版本 Node + `claude-agent-acp`，校验哈希，落到应用数据目录。

### 周五（Day 5）：联调与门评审预演
- **全员**：每个 spike 出一页"结果单"：能做什么/不能做什么/LOC/耗时/遗留问题；更新风险清单与决策日志（ADR-02 内核、受管运行时、Codex 沙箱 crate 三选一）。
- **R1+FE**：把 spike A/B 的 JSONL 灌进 `journal`，UI 假数据切换成真数据，演示"3 个 Agent 的事件出现在花名册与时间线里"。
- **PM**：核对周验收项；确定 W2 的取舍（若 steer 在 ACP 上不通，W2 优先走 Codex 原生 + Claude SDK 路径）。

**W1 退出标准**：①三个 ACP Agent 各完成一次带权限请求的往返并落 JSONL；②Codex fork/steer/interrupt 在命令行 demo 中走通；③journal 通过 `kill -9` 压测；④UI 能显示 5 个模拟 Bot 的状态切换；⑤法务/商标/美术三张工单已开。

---

## 6. 关键风险与止损

| 风险 | 触发信号 | 动作 |
|---|---|---|
| 自建内核拖期（R1） | M0 G1–G5 失败 ≥2 项 | Plan B：DSH 作 Router 内核 |
| 外部协议变动 / 适配器不稳 | 契约测试夹具连续失败 | 锁版本；握手校验；回退到 ACP 通用路径 |
| 条款风险落地 | 法务回复否定订阅模式 | 对外口径"仅 API Key/Bedrock/Vertex"；订阅模式从产品移除，仅保留"本机已装 CLI 的探测提示" |
| WebKit 渲染问题 | 双内核截图回归差异超阈值 | 改 Electron（UI 只依赖 WS 协议，换壳成本低） |
| 范围蔓延 | 任何新需求 | 必须挤掉一项同量级需求；评审留痕 |
| 人手不足 | M1 末仍缺 A1–A6 任意项 | 砍 Claude Driver 或 PWA；不砍审批与审计 |

**MVP 度量（取代原稿占位增长数字）**：TTFV 中位数；周事件触发任务数/用户；使用过 steer/fork 的用户占比；审批批准后被回滚比例（≤2%）；断线重连事件丢失率（=0）；头像状态延迟 P95 ≤500 ms。

---

## 7. 并行的非工程线（从 W1 起）

| 线 | 负责人 | 里程碑 | 备注 |
|---|---|---|---|
| 法务 | PM + 外部律师 | W2 出问题清单；M3 前书面意见 | Claude/Codex/Google 条款；OpenAI `clientInfo.name` 登记；DSH 品牌条款；开源许可策略 |
| 品牌与商标 | PM | W3 出检索结果 | Muster、Pip、候选品牌；吉祥物与名称分开检索；域名（HTTPS 域名也是中继/CIMD 的前置） |
| 主 IP 与形象 | 设计 | W2 发 brief，M4 前交付 | 先 AI 出概念稿，终稿人类画师重绘买断；Rive 或 SVG 取舍见 Q14 |
| 用户招募 | PM | M2 起 | 目标 20–30 位多机开发者；内测通道与反馈表 |
| 成本预算 | PM | W2 | 代码签名（Windows 证书 + Apple Developer）、域名、中继/推送费用、法务、画师；原稿只有美术预算 |
