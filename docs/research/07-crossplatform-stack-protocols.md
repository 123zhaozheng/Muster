# 07 - 多端技术栈与协议生态调研

> 调研日期：2026-11-06。所有"最新"结论均基于 2026-11 前后可检索到的资料；每条关键结论附来源 URL 或克隆源码路径。无法确认的内容单独标注"未证实"，见文末第 11 节。
> 源码克隆目录：`D:\code\xuqiu\repos\`（只读，未运行任何构建/脚本）。本课题实际读过的仓库：`desktop-cc-gui`（Tauri 2 参考）、`codex`、`eigent`、`agent-client-protocol`、`rust-sdk`。`jan`、`goose`、`opencode` 三个目录在本次调研时是空壳（疑似其他调研任务克隆中），其结论仅来自网页资料，已在正文标注。

---

## 0. 结论先行（TL;DR）

1. **推荐架构：Rust 核心 daemon + 协议化的薄 UI 壳**。核心（事件总线、主/子 agent 运行时、适配器、MCP/ACP 协议栈、存储、网关）用 Rust 写成独立进程；桌面 UI 用 **Tauri 2 + React/TypeScript**，移动端第一阶段用同一套 Web UI 作为"远程控制器"（PWA/Tauri mobile），Agent 永远跑在桌面/服务器上。这条路线与 OpenAI Codex（Electron + Rust `app-server`）、Goose（Electron + Rust `goose serve` ACP 服务）、OpenCode（UI + `opencode serve`）的演进方向一致：**UI 壳变成可替换件，协议才是产品**。
2. **Tauri 2 vs Electron 不是信仰问题，是可逆决策**。OpenCode 在 2026-04/05 从 Tauri 迁到 Electron，原因是 macOS/Linux 上 WebKit 的渲染性能与样式不一致（来源见 3.2）。因此：UI 必须同时在 Chromium 与 WebKit 上做 CI；daemon/UI 之间的协议要保证"换壳只需换一个 `apps/desktop` 目录"。Tauri 3 的 CEF 运行时目前仍是 alpha（`tauri-runtime-cef 3.0.0-alpha.6`，2026-10-14），可作为后备而非起点。
3. **GPUI（Zed）、Dioxus、Slint、Flutter、React Native、Wails 都不建议作为主 UI 框架**（逐项理由见第 2 节）。原因集中在：agent 产品的 UI 重度依赖 Markdown 流式渲染、代码高亮、diff、xterm 终端、Mermaid/KaTeX、MCP Apps 的 iframe 沙箱等**Web 生态资产**，这些在 Web 技术栈上是现成的。
4. **协议结论（2026-11 现状）**：
   - **MCP**：当前稳定规范 `2026-07-28`（2026-07-28 发布，RC 于 2026-05-21）。核心变化是**无状态化**（去掉 `initialize` 握手和 `Mcp-Session-Id`）、MRTR、`server/discover`、`Mcp-Method/Mcp-Name` 头、缓存提示、OAuth 加固（RFC 9207 `iss`、CIMD 取代 DCR）。Rust SDK `rmcp` 已到 **3.9.0**，对 `2025-11-25` 与 `2026-07-28` 两套一致性测试 100% 通过（克隆源码 `repos/rust-sdk/ROADMAP.md`）。
   - **ACP（Agent Client Protocol）**：v1 稳定，**v2 于 2026-07-20 发布 Draft**；ACP Registry 于 2026-01-28 上线，Claude Code（`claude-agent-acp`）、Codex（`codex-acp`）、Gemini CLI、Copilot、OpenCode、Goose 等均可经 ACP 驱动。**它是"桌面端把 Claude Code/Codex 当子智能体"的首选南向协议**。注意不要与 IBM 的 "Agent Communication Protocol"（2025-08 并入 A2A）混淆。
   - **A2A**：v1.0.0 于 2026-03-12 发布，v1.0.1 于 2026-05-26，2026-08-17 加入 Linux Foundation 旗下 AAIF。面向"跨组织/远程黑盒 agent"，不是本地编码 agent 的主通道。
   - **AG-UI**：1.0 稳定版 2026-09-30 发布，含 `SUBAGENT_*` 事件与 `RUN_STARTED.parentRunId`（分支/时间旅行血缘），适合作为"面向 Web/嵌入式前端"的**北向适配输出**，不建议作为内部规范模型。
   - **MCP Apps**（扩展 `io.modelcontextprotocol/ui`，规范 2026-01-26 Stable）：工具返回 `ui://` HTML，在宿主沙箱 iframe 渲染。Claude、Goose、VS Code、ChatGPT 已支持。应在 P1 做宿主侧支持。
5. **本项目最重要的协议判断**：内部使用**自有的 Thread/Turn/Item/Event 事件模型**（借鉴 Codex App Server 的三原语 + ACP v2 的 `state_update/background` + AG-UI 的 `parentRunId`/`SUBAGENT_*`），对外做**无损适配器**：南向 ACP + Codex app-server 直连 + MCP；北向 ACP-server（让 Zed/JetBrains 也能用我们）+ AG-UI + 自有 WS。这样 DeepSeek SuperAgent 式的"一切皆事件、子 agent 有状态可 fork/steer"在内部是一等公民，而不被任何外部协议的表达力限制。

---

## 1. 约束与评判标准

按用户需求，选型需同时满足：Win/Mac/Linux 桌面、尽量覆盖移动与 Web、轻量高质、可连接多台电脑与远程浏览器、桌面端驱动 Claude Code/Codex 等外部编程 agent、自带子 agent、UI 参考 Muse 类产品。据此设评判维度：

| 维度 | 说明 |
|---|---|
| D1 桌面三端一致性 | 渲染/行为在 Win/Mac/Linux 是否一致 |
| D2 移动端复用 | 能否复用 UI/核心到 iOS/Android |
| D3 包体/内存 | 安装包大小、空闲内存 |
| D4 生态资产 | Markdown 流式、代码块、diff、终端、富文本、MCP Apps iframe 等现成件 |
| D5 Rust 核心适配 | 与 Rust daemon（tokio、rmcp、ACP crate）的集成成本 |
| D6 团队开发效率 | 招聘/AI 辅助编码友好度/热更新 |
| D7 成熟度与风险 | 版本稳定性、维护方 |

---

## 2. UI/应用框架逐项评估

### 2.1 对比表（信息截至 2026-11）

| 框架 | 当前版本/状态（来源） | 桌面三端 | 移动 | 包体/内存（实测或官方） | 对本项目的判断 |
|---|---|---|---|---|---|
| **Tauri 2** | 2.12.0（2026-09-26），MSRV 1.90（https://v2.tauri.app/blog/tauri-2.12/）；iOS/Android 官方支持，Android 模板 targetSdk 37 / Gradle 9 | 系统 WebView：WebView2 / WKWebView / WebKitGTK，**渲染不一致** | 有，但移动端无菜单/托盘/多窗口/updater（https://www.urhoba.net/en/post/tauri-mobile-android-ios，二手来源，与官方文档一致）；默认编 4 个 Android target，构建慢（tauri#15273） | 同一 macOS 屏幕录制应用：Tauri 57 MB vs Electron 323 MB；空闲内存 109 vs 128 MB；启动 311 vs 273 ms（https://betterstack.com/community/guides/scaling-nodejs/tauri-vs-electron-vs-deno-vs-electrobun/） | **主推桌面壳**，附带"可替换"保险 |
| **Tauri 3 (alpha)** | `tauri 3.0.0-alpha.x`；`tauri-runtime-cef 3.0.0-alpha.6`（2026-10-14，CEF 154）；CEF 仅桌面，包体增加数百 MB，首次构建下载约 1 GB（https://v3.tauri.app/develop/cef/） | 可选 Chromium 内核解决不一致 | 移动仍用 wry | CEF 体积≈Electron | 观察，不上生产 |
| **Electron** | Electron 44（2026-08-25，Chromium M152，二手来源 trendintech.com，未交叉验证） | 完全一致 | 无 | 实测：Claude Desktop 可执行文件 212 MB（https://gist.github.com/JacquesGariepy/a97bb29ab951ed5884ec7000dbc7bb14，第三方逆向）；OpenCode 的 Electron deb 内 206 MB vs 旧 Tauri 版 40 MB（opencode#26143） | 最稳的"保底壳"；若 Tauri 的 WebKit 问题无法接受则回退 |
| **Flutter** | 3.47（2026-08-12），Impeller 在 macOS/Windows/Linux 成为默认渲染器；GenUI/A2UI；Genkit Dart 1.0（2026-10-08）（https://flutter.dev/blog/whats-new-in-flutter-3-47） | 像素级一致 | 极强 | 自带渲染引擎，体积中等 | 移动体验最佳；但 Markdown/终端/代码 diff/MCP Apps iframe 都要自建或找替代；与 Rust 核心需 FFI/IPC。**不作为主壳**，可作为未来"原生移动客户端"备选 |
| **React Native** | RN 0.87（2026-08-11）；RN Windows 0.85（2026-10-22，仅新架构，需 VS2026/.NET 10）；RN macOS 0.81.8；Linux 无官方维护（https://platform.uno/articles/react-native-windows-macos-versions-vs-dotnet-lts/，竞品撰文，有立场） | Win/Mac 靠微软外部分支，版本落后；Linux 无 | 强 | 原生控件 | 桌面不合适；仅在"移动体验优先"时用于移动端（Happy 即是 RN/Expo） |
| **Dioxus** | 稳定 0.7.10（2026-07-30），0.8.0-alpha.3（2026-10-16）；Subsecond 热补丁；Dioxus Native（Blitz/wgpu）实验中（https://crates.io/crates/dioxus） | 默认走 wry，与 Tauri 同样的 WebView 不一致问题 | 有（Android/iOS，含 iPad） | 小 | 纯 Rust 全栈很吸引人，但 UI 组件生态远小于 React；不解决 WebKit 不一致；0.8 仍 alpha |
| **GPUI (Zed)** | 仍 pre-1.0，"会频繁破坏性更新"，README 称需最新 stable Rust（https://github.com/zed-industries/zed/tree/main/crates/gpui）；`gpui-component` 0.9.0，60+ 组件、Markdown/HTML 渲染、代码编辑器（200K 行）、Dock 布局、WebAssembly 支持声明（https://docs.rs/crate/gpui-component/latest） | macOS/Windows/Linux | **无** | GPU 渲染，120 FPS，极轻 | 纯 Rust、性能最好，Zed 本身证明可行；但无移动、pre-1.0、无法承载 MCP Apps 的 HTML iframe、无 Web 形态，不满足"多端"。仅可作为未来"超轻量原生桌面客户端"的备选实验 |
| **Slint** | 1.18.1（2026-09-21）；新增 FlexboxLayout、弹簧动画、实验 Vello 渲染器（https://www.slint.dev/blog/slint-1.18-released） | 三端 | 官方有嵌入式/移动方向（未深入核实） | 极小 | 适合嵌入式/小屏；聊天流式 Markdown 与富文本生态不足，不推荐 |
| **Wails v3** | v3.0.0 稳定发布于 2026-10-26，v3.1.0 于 2026-11-01，周更；iOS/Android **仍实验性**（https://wails.io/blog/wails-v3-released/） | 三端，系统 WebView | 实验 | 小 | 后端是 Go；与 Rust 生态（rmcp、ACP crate、Codex 同源）不匹配 |

### 2.2 为什么 Web 技术栈仍是 agent UI 的最优解

在 agent 产品里，UI 的主要工作量是：流式 Markdown（带代码高亮/KaTeX/Mermaid）、工具调用卡片、diff 视图、终端（xterm）、文件树/编辑器（CodeMirror）、权限审批卡片、**以及 MCP Apps 的沙箱 iframe**。参考 `desktop-cc-gui/package.json`：`@streamdown/*`（流式 Markdown）、`@xterm/xterm`、`@uiw/react-codemirror`、`@xyflow/react`、`katex`、`@tanstack/react-virtual`、`react-aria-components`、`motion`。这些在 React 生态都是现成件；在 GPUI/Slint/Dioxus-native 上需要自行实现。MCP Apps 规范（`io.modelcontextprotocol/ui`）要求宿主以沙箱 iframe 渲染 `text/html;profile=mcp-app`，且通过 `postMessage` 走 JSON-RPC——这天然是 WebView 能力（来源：https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx）。

---

## 3. 知名 Agent 桌面应用的真实选型

### 3.1 对照表

| 产品 | 桌面壳 | 后端/核心 | 本地存储 | 关键证据 |
|---|---|---|---|---|
| **Claude Desktop** | Electron 41.2（第三方逆向：`app.asar` 24 MB、`claude.exe` 212 MB） | Node 主进程内嵌 MCP host（`directMcpHost.js`）；MCPB 扩展；Cowork/Hyper-V VM；Chrome native host | SQLite（`node:sqlite` + Drizzle，WAL） | https://gist.github.com/JacquesGariepy/a97bb29ab951ed5884ec7000dbc7bb14（第三方逆向）；官方 MCPB：https://claude.com/docs/connectors/building/mcpb |
| **Codex app** | Electron（macOS 版 2026-02-02 发布；招聘 JD 明确 "TypeScript/Node/Electron"） | **Rust `codex app-server`**（JSON-RPC over stdio/WS/Unix socket），桌面端随包携带固定版本二进制 | Node 侧 `better-sqlite3`（UI/自动化状态）+ Rust 侧 `sqlx-sqlite`（线程数据） | https://openai.com/index/unlocking-the-codex-harness/ ；https://openai.com/careers/software-engineer-codex-app-san-francisco/ ；逆向：https://yuanjiwei.com/20250215-architecture-behind-codex/（该 URL 日期字段与内容版本不一致，仅作参考） |
| **Goose Desktop** | Electron Forge + Vite + React | **Rust `goose serve`（ACP 服务器）**，桌面经 HTTPS/WSS 直连；2026-07-02 合并 PR #10081，移除旧 `goosed` REST/OpenAPI | 后端管理 | https://github.com/aaif-goose/goose/pull/10081 ；`ui/desktop/README.md`；讨论 #9367：先前"ACP 后端 + 全新 UI"同时重写的 `ui/goose2` 被放弃，改为"先换后端协议、再换 UI" |
| **OpenCode Desktop** | **Tauri → Electron**（2026-04 宣布，PR #25822 于 2026-05-05 合并，删除 `src-tauri/`） | TypeScript 服务端（`opencode serve`），Bun→Node | SQLite | https://dev.to/brendonovich/moving-opencode-desktop-to-electron-4hip |
| **Cherry Studio** | Electron + electron-vite；Node ≥24.11 | 主进程 `Application` 单例 + IPC 路由；集成 Vercel AI SDK、Claude Agent SDK | LibSQL + Drizzle；`better-sqlite3` + `sqlite-vec` 向量检索 | https://deepwiki.com/CherryHQ/cherry-studio/3-application-architecture |
| **LobeHub Desktop** | Electron 37.1，IoC 容器 + 控制器/服务；`lobehub://`、`localfile://` 自定义协议 | 包装 Next.js Web 应用，可与远程 LobeHub 同步 | `electron-store` | https://github.com/lobehub/lobehub/blob/main/apps/desktop/README.md |
| **Jan** | **由 Electron 迁至 Tauri**（官方理由：包体变大、Chromium+Node 无法扩到移动） | Rust 壳 `src-tauri/src/core`（线程/agent loop/MCP/本地服务）；llama.cpp 以独立 `jan-llama-worker` 进程运行；Apple Silicon 另有 MLX(Swift) | 本地 | https://pyshine.com/jan/ 、https://dev.to/syke99/the-ui-frameworks-local-ai-desktop-apps-actually-ship-3pni（二手来源；本次克隆 `repos/jan` 为空，**未亲读源码**） |
| **Eigent** | Electron 33 + React 18 + zustand + @xyflow | **Python FastAPI 后端（"Brain"）**，`Hands` 接口抽象本地/沙箱/远程集群资源（`backend/app/hands/`），`run_journal/`、`run_sync/`、`remote_sub_agent/` | 本地+云同步 | 克隆源码 `repos/eigent/` |
| **Zed** | GPUI（Rust 原生） | 内置 Agent + ACP 外部 agent | — | https://zed.dev/docs/ai/external-agents |
| **Happy（移动）** | RN 0.81 + Expo 54（iOS/Android/Web） | CLI 包装 Claude Code/Codex + 中继服务器（E2EE，libsodium） | MMKV | https://github.com/slopus/happy ；https://happy.engineering/docs/how-it-works/ |

### 3.2 解读（与本项目直接相关）

1. **主流 agent 桌面应用大多仍是 Electron**（Claude、Codex、Goose、Cherry、LobeHub、Eigent、OpenCode）；Jan 是少数反向迁往 Tauri 的案例，但 OpenCode 又从 Tauri 迁出。**不存在"Tauri 一定更好"的共识**。OpenCode 的核心论点（Brendonovich）：Tauri 在 macOS/Linux 用 WebKit，渲染性能差且与 Chromium 样式有差异；若业务逻辑本身不是 Rust，则 Tauri 的 Rust 并不带来性能收益。**对本项目的启示**：我们的核心就是 Rust（daemon），Tauri 的"壳 + Rust 同语言"优势成立；但仍要把 WebKit 兼容性当作一等风险。
2. **"产品本体=协议服务器，桌面=客户端"是 2026 年的收敛方向**：Codex（App Server 同时服务 CLI/IDE/macOS app/网页/Xcode）、Goose（`goose serve` ACP）、OpenCode（server/client）、Eigent（Brain/Hands）。
3. **真实体积差距要看口径**：玩具应用 Tauri 3~10 MB vs Electron 85~120+ MB（rustify.rs、trendintech.com，方法不透明）；含重依赖的真实应用差距缩小但仍显著（Better Stack 57 vs 323 MB；OpenCode 40 vs 206 MB）。**空闲内存差距远小于体积差距**（Better Stack 109 vs 128 MB；Tauri 的 WebView 子进程不计入主进程）。因此"轻量"卖点主要落在**安装包与更新流量**，而不是内存。
4. **开发效率**：Electron 全 TS 团队效率最高、无 Rust 学习曲线；Tauri 需要 Rust，但本项目核心本身用 Rust，等于壳不增加语言数量。Tauri 的 Rust 编译时间和 Android 构建缓慢是已知痛点（tauri#15273）。

### 3.3 Tauri 系 agent 桌面应用（候选参考，GitHub 检索，星数为检索时快照）

| 项目 | 说明 | 备注 |
|---|---|---|
| **zhukunpenglinyutong/desktop-cc-gui**（本次深度阅读） | Tauri 2 + React 18 + Rust，统一 Claude Code / Codex / Kimi / Grok / Pi / OMP / DeepSeek Harness / Antigravity / OpenCode / Qoder / MiniMax 11 个引擎 | 见第 4 节 |
| wuxiran/cc-pane（568★，GPL-3.0） | 多实例分屏管理 Claude Code，内置 `ccpanes` MCP 让 leader 派发 worker | GPL，仅参考思路 |
| Porabuild/Poracode（Apache-2.0） | ACP Registry 任意 agent、内置 MCP 让 agent 互相编排（"Crossagents"） | 同方向竞品 |
| yusei531642/vibe-editor2（MIT） | Leader 动态招募 worker，经内嵌 MCP hub 向各 agent pty 注入消息 | 无限画布 |
| recailai/jockey（MIT） | Tauri + SolidJS，经 ACP 编排多 agent | 轻量 |
| autohandai/commander、ersinkoc/MultiPilot | Tauri 2 + git worktree 多 agent | 小型 |

---

## 4. 参考源码剖析：`desktop-cc-gui`（Tauri 2 agent 桌面）

仓库：`D:\code\xuqiu\repos\desktop-cc-gui`（上游 https://github.com/zhukunpenglinyutong/desktop-cc-gui，版本 1.2.2，后端 `src-tauri/src` 约 5.5 MB 源码）。

### 4.1 结构

- `src-tauri/Cargo.toml`：`tauri = "2"`（features `protocol-asset`, `unstable`, `macos-private-api`）、`rusqlite (bundled)`、`tokio`、`axum 0.8 (ws)`、`portable-pty`（内置终端）、`git2 (vendored-libgit2)`、`rmcp 3.4 (server, macros, transport-io)`、`tokio-tungstenite (rustls)`、`xcap` + `enigo`（computer use，隔离为单独 bin `src/bin/ccgui-computer-use`，主程序源码禁止引用，有测试守卫）。
- `src-tauri/src/engine/`：**引擎适配层**。每个外部 agent 一个适配器：`claude.rs`（2039 行）、`codex.rs`/`codex_app.rs`（3625 行，直连 `codex app-server`）、`grok_acp.rs`、`kimi_acp.rs`、`minimax_acp.rs`、`omp_acp.rs`（手写 ACP JSON-RPC 客户端：`initialize` → `session/new {cwd,mcpServers}`/`session/load` → `session/prompt` 流式 `session/update`）、`dsh_session.rs`（DeepSeek Harness）、`opencode_server.rs`、`pi_family.rs` 等。**统一事件枚举** `engine/events.rs::EngineEvent`（`Delta/Thinking/Message/SessionId/Usage/Error/Warn/AttemptEnd/Retry/…`）。
- `src-tauri/src/event_sink.rs`：事件批量下发到前端——`ENGINE_EVENT_NAME = "engine://event"`，`FLUSH_INTERVAL = 32ms`（聊天 16ms，对齐动画帧），`FLUSH_BYTES = 64KB`，事件先序列化缓存再拼 JSON 数组（避免二次序列化）。`trait Emit` 抽象使得同一事件既可发给 Tauri 窗口，也可发给 Web 桥。
- `src-tauri/src/web.rs` + `web/dispatch`：**局域网 Web 访问**。axum 服务前端静态资源，并把"整个 Tauri command/event 表面"桥接到 token 认证的 WebSocket，手机浏览器即可使用同一套 UI。每次启动随机 token，WS 握手和 `/file` 路由校验。
- `src-tauri/src/relay.rs` + `deploy/worker`（Cloudflare Worker + Durable Object，`local-relay.mjs` 本地调试）：**出站中继**。桌面主动 `wss://<worker>/agent?key=<secret>` 拨出，Worker 代理手机端的 HTTP/WS 请求（JSON 帧 + base64 payload：`open/body/end/data/head/close/error`），桌面不开入站端口；重连退避 1s→30s、15s 心跳、20s 拨号超时；中继流量带 `x-ccgui-via` 头，网桥对其强制校验配对密钥。**这是"手机连接桌面"最小可行方案的完整开源实现。**
- `src-tauri/src/dsh_host.rs`：以 `dsh web` 子进程方式托管 DeepSeek Harness，HTTP RPC（`POST /api/<ns>/<method>`，`{type:"client-request",rpcId,method,payload}`）+ `ws://…/api/remote.mux` 流；使用一次性 launch token 换签名 cookie；严格的"只管理自己启动的子进程"所有权规则（v1.2.0 曾因按端口 kill 进程误杀其他服务，已修复——值得吸取教训）。
- 其他：`mcp/`（lazy/probe）、`memory/`（含 MCP 记忆工具）、`plugins/` + `packages/plugin-sdk`/`plugin-ui`（插件系统）、`pets.rs` + `pet_overlay.rs`（置顶透明窗口"桌宠"：16ms 命中检测、光标靠近感知、气泡）——**对"有趣的智能体形象"需求有直接参考价值**（交由形象课题深入）、`git_worktree.rs`、`terminal.rs`、`usage_limits/`、`updater.rs`。

### 4.2 可借鉴 / 不可照搬

- 可借鉴：统一引擎事件枚举 + 每引擎一个适配器的分层；事件批量合并；Emit trait 抽象让桌面/Web 复用；LAN 桥 + 出站中继；安全默认值（随机 token、CSP、`assetProtocol` 对 `~/.ssh` 等敏感目录 deny）。
- 不照搬：适配器间重复较多（各 `*_acp.rs` 各自手写 ACP 客户端，约 400~1300 行/个），应改为复用官方 `agent-client-protocol` crate；GPL/授权问题需逐仓核对（该仓库许可证未在本次核实）。

### 4.3 同类对照：Eigent 的"Brain / Hands"

`repos/eigent/backend/app/hands/`：`interface.py`（`IHands`：`can_execute_terminal()`、`can_access_filesystem()`…）、`full_hands.py`/`sandbox_hands.py`/`environment_hands.py`/`remote_hands.py`、`cluster_interface.py` + `http_hands_cluster.py` + `routed_hands_cluster.py`。思想：**"决策脑"与"执行手"解耦，手可以是本地、沙箱或远程集群**。这与"连接多台电脑/远程浏览器"的需求同构，值得在我们的 `Environment` 抽象中采用（对应 Codex `exec-server` 的 `--remote URL --environment-id ID`，见第 6 节）。此外 `run_journal/`（`recorder.py`、`semantic_events.py`、`otel_projection.py`）是"事件日志 + 投影"的实现，`remote_sub_agent/` 是子 agent 抽象。

---

## 5. 协议生态

### 5.1 分层定位

```
        [用户/UI: 桌面 Tauri · Web/PWA · 手机 · Zed/JetBrains(作为 ACP client)]
                 │ 自有 WS(事件流)   │ AG-UI(SSE/WS)   │ ACP(server 模式)
        ┌────────▼───────────────────▼────────────────▼───────────┐
        │   本项目 daemon：事件总线 + 主 agent(调度) + 子 agent 运行时    │
        └──┬──────────────┬───────────────┬──────────────┬─────────┘
           │ ACP(client)  │ Codex app-    │ MCP(client)  │ A2A(client/server)
           │ stdio        │ server JSONRPC│ 2026-07-28   │ v1.0
     Claude Code(claude-agent-acp) Codex   各种工具/数据/MCP Apps   远程/第三方 agent
     Gemini/Copilot/OpenCode/Goose…        MCPB 本地包
```

一句话分工：**MCP = agent↔工具/数据；ACP = 编辑器/宿主↔编码 agent（子进程）；A2A = agent↔agent（跨组织/远程黑盒）；AG-UI = agent 后端↔Web 前端；MCP Apps = 工具返回的交互式 UI**。MCP 与 A2A 同属 Linux Foundation 的 Agentic AI Foundation（AAIF）：MCP 于 2025-12 捐赠，A2A 于 2026-08-17 加入（https://aaif.io/blog/a2a-joins-aaif）。

### 5.2 MCP

- **最新规范 `2026-07-28`**（2026-07-28 发布；变更日志 https://modelcontextprotocol.io/specification/2026-07-28/changelog ；博客 https://blog.modelcontextprotocol.io/posts/2026-07-28/）。要点：
  1. 去掉 `initialize`/`initialized` 与 `Mcp-Session-Id`（SEP-2575、SEP-2567）；每个请求在 `_meta` 携带 `io.modelcontextprotocol/protocolVersion`、`clientCapabilities`（可含 `clientInfo`）；新增 `server/discover` RPC；版本不符返回 `UnsupportedProtocolVersionError`。
  2. 取消 HTTP GET 流与 `resources/subscribe`，改为 `subscriptions/listen`（单条长连接 POST 响应流）；移除 SSE 续传（`Last-Event-ID`）：流断则请求丢失，需重发新 ID。
  3. **MRTR（Multi Round-Trip Requests，SEP-2322）**取代服务端发起的 `elicitation/create`、`sampling/createMessage`、`roots/list`：服务端返回 `resultType:"input_required"` + `inputRequests`，客户端带 `inputResponses` 重试原请求。所有结果必带 `resultType`。
  4. Streamable HTTP 必须带 `Mcp-Method`/`Mcp-Name` 头（SEP-2243），便于网关路由。`tools/list` 等结果带 `ttlMs`/`cacheScope`（SEP-2549）并要求确定性排序（利于上游 prompt cache）。
  5. 授权：服务端 SHOULD 返回 `iss`（RFC 9207），客户端 MUST 校验（SEP-2468）；DCR 注册须带 `application_type`；凭据绑定签发者；**DCR 被正式废弃，改推 Client ID Metadata Documents（CIMD）**。
  6. **Roots/Sampling/Logging 被弃用**（≥12 个月过渡窗口）；旧 HTTP+SSE 传输被弃用。
  7. 扩展框架：**Tasks（`io.modelcontextprotocol/tasks`，SEP-2663，`tasks/get` 轮询 + `tasks/update`）、MCP Apps、Enterprise Managed Authorization（EMA）**。
  8. `_meta` 中约定 OpenTelemetry trace 上下文（`traceparent` 等，SEP-414）。
- **治理与路线图**：2026-08-22 的路线图提到 Agents / Transports / **Triggers & Events** 工作组联合评估"服务端主动事件（webhook、channels）"与 Tasks 晋升核心（https://blog.modelcontextprotocol.io/posts/mcp-roadmap/）。这与"一切触发皆事件"哲学同向，值得跟踪。
- **SDK**：Tier 1 为 TypeScript / Python / Go / C#；**Rust `rmcp` 3.9.0**（2026-11-05 发布）在本次克隆的 `repos/rust-sdk/ROADMAP.md` 声明满足 SEP-1730 Tier 1 全部要求、`2025-11-25` 与 `2026-07-28` 服务器/客户端一致性均 100%；`tasks-*`（9 项）与 EMA 仍是预期失败，SEP-2567/2260 的部分客户端功能待办。
- **远程 MCP + OAuth 的桌面端实践**：Claude 的做法是 401 → `WWW-Authenticate` 指向受保护资源元数据 → 取授权服务器元数据 → CIMD（要求授权服务器同时声明 `client_id_metadata_document_supported:true` 与 `none` 认证方式）否则回落 DCR；Claude Code 作为原生客户端使用 RFC 8252 回环重定向，需要端口无关匹配（https://claude.com/docs/connectors/building/authentication）。对我们的含义：**需要一个自有域名托管 CIMD 文档**（`client_id` 为 HTTPS URL，含 `client_name`、`redirect_uris`，如 `http://127.0.0.1/callback`），并实现 DCR 回落、`iss` 校验、按签发者缓存凭据；同时桌面 OAuth 回调必须绑定回环地址。
- **MCP Bundles（`.mcpb`）**：zip 包含 `manifest.json` + 本地 MCP 服务器，Claude Desktop 一键安装，密钥进系统钥匙串；Claude 官方目录已不再收 MCPB 提交，改为通过 plugin 分发（https://claude.com/docs/connectors/building/mcpb ；https://github.com/modelcontextprotocol/mcpb）。我们可兼容安装 `.mcpb`（解包 + 按 `manifest.json` 启动 stdio）。
- **向后兼容**：大量已有 MCP 服务器仍停留在 `2025-11-25` 及更早。客户端需"双栈"：先发 `server/discover`（规范称其亦可作为 STDIO 上的向后兼容探测），失败则回落 `initialize` 握手。具体探测细节以 rmcp 3.x 实现为准（未逐行核对，**未证实**）。

### 5.3 MCP Apps / MCP-UI

- 扩展标识 `io.modelcontextprotocol/ui`，规范版本 `2026-01-26` Stable（https://github.com/modelcontextprotocol/ext-apps）。机制：工具定义 `_meta.ui.resourceUri = "ui://…"`；宿主 `resources/read` 取 MIME `text/html;profile=mcp-app` 的 HTML，放入**沙箱 iframe**，通过 `postMessage` 上的 MCP JSON-RPC 双向通信；资源 `_meta.ui.csp`（`connectDomains/resourceDomains/frameDomains/baseUriDomains`）与 `permissions`（camera/microphone/geolocation/clipboardWrite）由宿主审核。宿主不支持则退化为纯文本工具。
- 宿主支持：Claude（Web/桌面）、Goose、VS Code Insiders、ChatGPT（2026-01-26 公告，https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/）。
- 与 Google **A2UI**（Flutter GenUI 0.10.0 采用）的区别：MCP Apps 传输的是"预声明的 HTML 模板"；A2UI 传输的是"从可信组件目录里选组件"的声明式 UI。两者可并存，本项目先做 MCP Apps（Web 技术栈天然支持）。

### 5.4 ACP（Agent Client Protocol）

- 基本模型：JSON-RPC 2.0，stdio（子进程）为当前唯一正式传输；双向调用。`initialize`、`auth/login`、`session/new|resume|list|close`、`session/prompt`、`session/cancel`(通知)、`session/update`(通知)、客户端侧 `session/request_permission`、可选 `fs/read_text_file`/`fs/write_text_file`、`terminal/create|output|wait_for_exit|kill|release`、`elicitation/create`（2026-07-22 稳定）、`$/cancel_request`（2026-06-29 稳定）。内容块基线为 `text` 与 `resource_link`。扩展靠 `_meta`、`_` 前缀方法、能力声明。（克隆源码：`repos/agent-client-protocol/docs/protocol/v2/overview.mdx`、`docs/protocol/v1/schema`；TS SDK `CLIENT_METHODS` 常量亦可对照。）
- **v2（2026-07-20 Draft）**主题"超越单轮"：`state_update`（`running`/`requires_action`/`idle`）、后台工作列表（`docs/rfds/v2/background-work.mdx`：终端、tool call、**子 agent 会话**可在前台结束后继续运行，客户端可单独取消）、`message_id` 变必填、`session/resume` 可回放、`plan_update` 条目化、diff 文件状态。迁移指南：`docs/protocol/v2/migration.mdx`。
- **与本项目最相关的 RFD**（`repos/agent-client-protocol/docs/rfds/`，状态取自 `docs.json`）：
  - `session-fork.mdx`（**Draft**）：`session/fork`，用于总结/PR 描述而不污染主历史，未来可按消息 ID 分叉。
  - `subagents.mdx`（**Active**）：Agent 将自己创建的子 agent 暴露为受限 ACP 会话，`subagent_update` upsert 建立父子关系，`session_message(_chunk)` 传递会话间消息，客户端默认只可取消。
  - `streamable-http-websocket-transport.mdx`（**Active**）：标准远程传输——单一 `/acp` 端点，长连接 GET(SSE) 流（连接级 + 每会话一条）+ POST 上行（返回 202）+ 可选 WebSocket 升级，要求 HTTP/2，头 `Acp-Connection-Id`。
  - `mcp-over-acp.mdx`（**Active**）：以 `"type":"acp"` 声明 MCP 服务器，用 `mcp/message` 在 ACP 连接上承载 **MCP 2026-07-28** 的无状态请求——客户端可在自己的进程/沙箱内为 agent 提供工具而无需再开端口。
  - `proxy-chains.mdx`（**Draft**）：ACP 代理链，可在 client 与 agent 之间注入上下文/改写消息——可用来实现我们的"主 agent 轻量调度层"。
  - `acp-agent-registry`（已完成）：`https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json`，agent 以 `agent.json` 提交，仅收录支持认证的 agent（https://agentclientprotocol.com/get-started/registry）。
- **生态**：Registry 2026-01-28 上线，Zed 与 JetBrains（2025.3.2+）内置（https://zed.dev/blog/acp-registry ；https://blog.jetbrains.com/ai/2026/01/acp-agent-registry/）。官方适配器：`agentclientprotocol/claude-agent-acp`、`agentclientprotocol/codex-acp`。官方"agents"页列出 Goose、OpenClaw、OpenHands、Pi、Gemini CLI、GitHub Copilot、Kimi CLI、Qwen Code、Cursor 等 40+；其中还出现 "Muse Spark Code (unofficial agent for Meta's Muse Spark)"——与用户所说"Muse"的候选判断相关，**留给专门调研 Muse 的课题核实**。
- **Rust SDK**：`repos/agent-client-protocol/` 为 Cargo workspace（`agent-client-protocol-schema`、`schema-generator`、`v1/`、`v2/`），另有 RFD `rust-sdk-v1.mdx`。

### 5.5 A2A

- v1.0.0（2026-03-12）→ v1.0.1（2026-05-26）；三种协议绑定（JSON-RPC / gRPC / HTTP+JSON）、`a2a.proto` 为规范来源、Agent Card 的 `supportedInterfaces[]`（含 per-interface `protocolVersion`）、**签名 Agent Card（JWS + RFC 8785）**、多租户、`tasks/list` 游标分页、OAuth 现代化（设备码、PKCE，移除隐式/密码流）、头 `A2A-Version`、`A2A-Extensions`（https://a2a-protocol.org/latest/whats-new-v1/ ；https://github.com/a2aproject/A2A/releases）。TSC 由 AWS、Cisco、Google、IBM Research、Microsoft、Salesforce、SAP、ServiceNow 组成；150+ 组织；Huawei Celia/HarmonyOS 将其作为系统助理与应用 agent 间协议（https://aaif.io/blog/a2a-joins-aaif）。
- **对本项目的定位**：A2A 的黑盒不透明语义（不共享内部记忆/工具）与"本地可观测、可 fork/steer 的有状态子 agent"哲学不同。结论：**A2A 用于"调用远程第三方 agent 服务 / 被他人调用"，不用于驱动 Claude Code/Codex 等本地编码 agent**（后者走 ACP 或原生 app-server，保留更细粒度的事件）。

### 5.6 AG-UI

- 1.0（2026-09-30，CopilotKit 博客）：基于 JSON Schema 生成 TS/Python/.NET SDK；采用方含 Google、Microsoft、Amazon、Oracle，以及 LangChain、Mastra、Claude Managed Agents（https://www.copilotkit.ai/blog/ag-ui-1.0）。事件类型（https://docs.ag-ui.com/spec/1.0/schema）：`RUN_STARTED/FINISHED/ERROR`、`STEP_*`、`TEXT_MESSAGE_START/CONTENT/END/CHUNK`、`TOOL_CALL_START/ARGS/END/RESULT/CHUNK`、`STATE_SNAPSHOT/STATE_DELTA`、`MESSAGES_SNAPSHOT`、`ACTIVITY_SNAPSHOT/DELTA`、`REASONING_*`（含 `REASONING_ENCRYPTED_VALUE`）、**`SUBAGENT_STARTED/FINISHED/ERROR`**、`RAW`、`CUSTOM`。`RUN_STARTED` 带 `parentRunId`（"分支/时间旅行的血缘指针"）与 `input`。传输默认 SSE。
- 定位：它只覆盖 "agent → 前端" 的流与前端工具/状态同步，**缺少 steer、fork 作为一等控制面、权限审批协议与多会话管理**；因此作为**北向适配输出**（便于嵌入第三方 Web 前端、复用 CopilotKit 生态），而非内部规范。

### 5.7 Codex App Server 协议（事实标准之一）

`repos/codex/codex-rs/app-server/README.md`、`app-server-protocol/src/protocol/common.rs`：JSON-RPC 2.0（线上省略 `jsonrpc` 头），**stdio(JSONL)/WebSocket/Unix socket**；原语 **Thread / Turn / Item**；方法含 `thread/start|resume|fork`、`turn/start`、`turn/steer`（`common.rs:1099`）、`turn/interrupt`（`common.rs:1105`）；通知 `item/started` → `item/*/delta` → `item/completed`、`turn/diff/updated`、`turn/plan/updated`；Item 种类含 `commandExecution`、`fileChange`、`mcpToolCall`、**`collabToolCall`（`spawn_agent`/`send_input`/`resume_agent`/`wait`/`close_agent`，含 `senderThreadId`/`receiverThreadId`/`newThreadId`）**。服务端可反向发请求（审批）并暂停 turn。OpenAI 称客户端可用 Go/Python/TS/Swift/Kotlin 实现（https://openai.com/index/unlocking-the-codex-harness/）。远程控制：`remoteControl/enable|disable|status/read|pairing/start|pairing/status`（`app-server-daemon/src/remote_control_client.rs`；https://codex.danielvaughan.com/2026/06/06/codex-cli-remote-control-mobile-pairing-app-server-v2-remodex/，二手来源）。

> 对本项目的价值：**这是"桌面端驱动 Codex"最佳通道**（比 ACP 暴露更多：fork/steer/diff/plan/子 agent）；同时也是我们内部事件模型的最好范本。

### 5.8 与 SuperAgent 设计哲学的原语映射

> SuperAgent 原始出处与核心设计由其他课题调研；此处仅做"协议原语能否承载该哲学"的映射。本地已有 `repos/deepseek-harness`、`repos/dsh-superagent-prototype` 供对照；`desktop-cc-gui` 已把 DeepSeek Harness 作为第 7 个引擎接入（`dsh_host.rs`、`engine/dsh_session.rs`），证明 DSH 可通过 HTTP RPC + WebSocket mux 被第三方 GUI 托管。

| 哲学要点 | Codex app-server | ACP | AG-UI 1.0 | MCP |
|---|---|---|---|---|
| 子 agent 有状态 | thread 持久化，`resume_agent` | `subagents` RFD(Active)：子会话独立 sessionId | `SUBAGENT_*` 事件 | Tasks 扩展（句柄+轮询） |
| 随时分支 fork | `thread/fork`（可 `ephemeral`） | `session/fork`(Draft) | `RUN_STARTED.parentRunId` | 无 |
| 插话 steer | `turn/steer` | v2 "超越单轮"+后台工作；steer 无专门方法（**未证实**） | 无 | MRTR 的 `input_required` 属"服务端向用户问" |
| 中断 | `turn/interrupt` | `session/cancel`、`$/cancel_request` | 无（靠连接中断） | `notifications/cancelled` |
| 回调通知 | 服务器通知流 + 反向请求 | `session/update` + `state_update` | 事件流 | `subscriptions/listen`；Triggers&Events WG |
| 一切皆事件 | Item 生命周期 started/delta/completed | `session/update` 判别联合 | 事件枚举 | 通知；`traceparent` 传播 |
| 主 agent 只分发 | collab tool + 多 thread | proxy-chains 可作调度层 | — | — |

结论：**没有任何单一外部协议完整表达"fork + steer + 子 agent 回调 + 外部触发（cron/GitHub PR）"**，因此内部自建事件模型是必要的；外部协议均作为适配面。

---

## 6. 多机、远程与移动连接模式（基于已核实的实现）

| 方案 | 做法 | 证据 |
|---|---|---|
| 出站中继（推荐默认） | 桌面 daemon 主动 `wss` 连中继；手机/浏览器也连中继；中继转发（可 E2EE） | Claude Remote Control（仅出站 HTTPS，会话转录在 Anthropic 服务器暂存，https://code.claude.com/docs/en/remote-control）；Codex 手机端经 OpenAI 安全中继（https://openai.com/index/work-with-codex-from-anywhere/，2026-05-14）；Happy（QR 配对 + libsodium E2EE，中继只见密文）；desktop-cc-gui `relay.rs` |
| LAN 直连 | daemon 内置 axum 服务 UI + WS，token 认证 | `desktop-cc-gui/src-tauri/src/web.rs` |
| 远程执行环境 | 控制端把"执行环境"抽象为 URL+ID，远程机器运行 exec-server 并出站注册 | `repos/codex/codex-rs/exec-server/README.md`：`--remote URL --environment-id ID [--name]`、`forward --connect ws://HOST:PORT --remote URL`；`--ws-auth capability-token --ws-token-sha256`；令牌要求 `wss://` 或回环 |
| Brain/Hands | 决策与执行分离，Hands 有本地/沙箱/远程集群实现 | `repos/eigent/backend/app/hands/` |
| 用户自管内网 | Tailscale + SSH/tmux | https://intentic.dev/guides/control-coding-agents-from-your-phone/（二手来源） |

P2P（iroh/QUIC 打洞）已有其他课题克隆 `repos/iroh`，此处不展开。**"远程浏览器"**：未对 Chrome DevTools MCP / Playwright MCP / Browserbase 做专项核实（**未证实**）；仅观察到 Claude Desktop 带 `chrome-native-host`（原生消息宿主，第三方逆向）与 Tauri 3 CEF 运行时暴露 `on_dev_tools_protocol`（alpha）。建议该能力交给浏览器课题。

---

## 7. 推荐技术栈

| 层 | 选型 | 理由 / 备注 |
|---|---|---|
| **核心语言** | **Rust**（tokio、serde、schemars→TS 类型） | 与 Codex、Goose、`rmcp`、ACP crate 同栈；单二进制 daemon，可 sidecar 打包；便于 Win/Mac/Linux 沙箱（可参考 `repos/codex/codex-rs` 的 `linux-sandbox/`、`bwrap/` crate） |
| **进程形态** | `<proj>d` daemon（本机常驻）+ UI 客户端（桌面/Web/手机）通过协议连接 | 与 Codex App Server、`goose serve` 一致；可在远程机器无头运行 |
| **桌面壳** | **Tauri 2.12+**，`src-tauri` 极薄：拉起 daemon sidecar、托盘、全局快捷键、deep-link、updater、桌宠置顶窗口 | 体积小（Better Stack 57 MB vs 323 MB）；风险：WebKit。**缓解**：UI 双内核 CI；daemon 协议隔离；备选 Electron 或 Tauri 3 CEF |
| **UI 层** | React 18/19 + TypeScript + Vite + Tailwind/shadcn(Radix)；`streamdown` 流式 Markdown、`xterm`、CodeMirror、`@tanstack/react-virtual`、`@xyflow/react`（子 agent 拓扑）、Rive/Lottie 渲染形象（形象课题决定） | `desktop-cc-gui` 已验证这套组合可用；MCP Apps iframe 宿主天然支持 |
| **移动端策略** | 阶段 1：同一 Web UI 以 PWA/移动布局经中继访问桌面 daemon（`desktop-cc-gui` 已验证）。阶段 2：**Tauri mobile** 壳（复用 UI，加原生插件：QR 扫码、生物识别、推送、分享目标）。备选：RN/Expo（Happy 路线）若追求原生手感 | Agent 不在手机上运行；Tauri 移动端无托盘/多窗口/updater，但"遥控器"场景不需要 |
| **本地存储** | **SQLite（WAL）**：`events` 仅追加日志 + 投影表（threads/turns/items/agents）；FTS5 + `sqlite-vec` 做记忆/检索；配置 TOML；密钥走系统钥匙串 | Codex 用 `sqlx-sqlite`+`keyring-store` crate；Cherry Studio 用 `sqlite-vec`；Claude Desktop 用 SQLite；Eigent `run_journal` 也是事件日志+投影 |
| **同步** | 阶段 1：**不做多写数据复制**——每台机器的 daemon 是其线程的唯一写者，跨设备通过"远程附着"（UI 连到那台机器的 daemon）。阶段 2：E2EE 加密 blob 日志中继（Happy 模式）做离线/多端回放。阶段 3：仅对协作编辑文档用 CRDT（Loro/Yjs） | 2026 年多篇对比文章共识：CRDT 适合协同编辑，一般结构化数据用服务端权威同步（二手来源：davidhfabian.com、mechcrate.dev）；PowerSync/Electric 以 Postgres 为中心，不适合"本地 daemon 为权威"的架构 |
| **MCP** | `rmcp 3.x`（客户端宿主 + 内置服务器） | 对 `2026-07-28` 一致性 100% |
| **ACP** | 官方 `agent-client-protocol` crate（客户端侧），避免像 `desktop-cc-gui` 那样每引擎手写 | v1 稳定，跟踪 v2 Draft |
| **外部 agent 接入** | Claude Code → `claude-agent-acp`；Codex → 直连 `codex app-server`（首选）或 `codex-acp`；其余 → ACP Registry | Codex 直连能拿到 fork/steer/diff/plan |
| **包与更新** | Tauri updater（签名）；daemon 作为随包固定版本的 sidecar（Codex 做法：客户端锁定经验证的 server 版本） | |

---

## 8. 工程结构草图

```
repo/
├─ crates/                       # Rust workspace
│  ├─ proto/                     # 内部 Event/Thread/Turn/Item/Run 类型（serde+schemars），生成 TS 类型 → packages/protocol
│  ├─ journal/                   # SQLite WAL 追加日志 + 投影；重放/快照/fork（按 event 前缀复制）
│  ├─ bus/                       # 进程内事件总线；统一入口：user_input / cron / webhook(GitHub PR) / 子agent回调 / fs-watch / MCP通知
│  ├─ agent-core/                # 主 agent(轻量调度，仅产出 dispatch/steer/fork 指令) + 子 agent 运行时(有状态，可 fork/steer/interrupt)
│  ├─ adapters/
│  │   ├─ acp-client/            # 驱动 Claude Code/Gemini/Copilot/OpenCode… (stdio 子进程管理、registry 拉取)
│  │   ├─ codex-appserver/       # 直连 codex app-server（thread/fork、turn/steer…）
│  │   ├─ a2a/                   # P2：远程 agent
│  │   └─ dsh/                   # DeepSeek Harness（参考 desktop-cc-gui/dsh_host.rs）
│  ├─ mcp-host/                  # rmcp：连接/授权(CIMD+DCR 回落)/缓存/MCP Apps 资源预取/MCPB 安装
│  ├─ mcp-builtin/               # 内置 MCP 服务器：spawn_subagent、emit_event、notify、memory…（mcp-over-acp 落地后经 ACP 承载）
│  ├─ gateway/                   # axum：自有 WS 事件流、AG-UI 输出、ACP-server(stdio+HTTP/WS 草案)、token/配对、relay 客户端
│  ├─ env/                       # Environment 抽象：local / sandbox / remote(exec-server 风格 URL+ID) / browser(CDP)
│  ├─ sandbox/                   # Win/Mac/Linux 沙箱与审批策略
│  └─ daemon/                    # bin
├─ apps/
│  ├─ desktop/                   # Tauri 2：src-tauri 仅 sidecar 管理/托盘/updater/桌宠窗口
│  ├─ web/                       # React UI（桌面 WebView / PWA / 手机 共用）
│  ├─ mobile/                    # Tauri mobile 壳（阶段 2）
│  └─ relay/                     # Cloudflare Worker + Durable Object（参考 desktop-cc-gui/deploy/worker），亦可自托管
├─ packages/
│  ├─ protocol/                  # 由 crates/proto 生成的 TS 类型与 zod
│  ├─ ui/                        # 组件库（流式 Markdown、tool 卡片、diff、终端、子agent 拓扑、MCP Apps iframe 宿主）
│  └─ mascot/                    # 形象运行时（其他课题）
└─ tests/ conformance/           # ACP TCK、MCP conformance、WebKit+Chromium 双内核 E2E
```

关键约束：① UI 只依赖 `packages/protocol`，**不直接调用 Tauri command**（`desktop-cc-gui` 的"Tauri command 表面 = Web 桥表面"能做到同源复用，但我们应从一开始就以 WS 事件流为唯一通道，避免将来换壳返工）；② 事件批量合并（16~32 ms）沿用 `event_sink.rs` 经验；③ daemon 只管理自己启动的子进程（吸取 `dsh_host.rs` 误杀端口进程的教训）。

---

## 9. 协议支持优先级

| 优先级 | 协议/能力 | 方向 | 内容 | 依据 |
|---|---|---|---|---|
| **P0** | MCP 客户端（`2026-07-28` + 旧版双栈） | 南向 | stdio + Streamable HTTP；`server/discover` / `initialize` 回落；OAuth（受保护资源元数据 → CIMD → DCR 回落，`iss` 校验）；`ttlMs` 缓存；MRTR 的 `input_required` 处理 | 规范 + rmcp 3.9 |
| **P0** | ACP 客户端（v1，跟踪 v2） | 南向 | 驱动 Claude Code/Gemini/OpenCode 等；`session/request_permission`、fs/terminal 能力；Registry 拉取 | 子智能体需求的核心 |
| **P0** | Codex app-server 客户端 | 南向 | thread/fork、turn/steer、interrupt、diff、plan、collab 子 agent | 最丰富的编码 agent 控制面 |
| **P0** | 自有事件 WS 协议 | 北向 | UI/移动/远程附着的唯一通道 | 第 5.8 节结论 |
| **P1** | MCP Apps 宿主 | 北向 | `ui://` 预取、沙箱 iframe、CSP/permissions 审核、`postMessage` JSON-RPC 桥 | Claude/Goose/ChatGPT 已支持 |
| **P1** | 内置 MCP 服务器 | 内部 | 让外部子 agent 回调主 agent（`spawn_subagent`、`notify`、`emit_event`）——cc-pane/vibe-editor2/Poracode 均用同样思路 | 同类产品验证 |
| **P1** | ACP 服务器模式 | 北向 | 让 Zed/JetBrains 以 ACP 使用我们；也使本产品可成为他人的子 agent | Registry 分发渠道 |
| **P1** | MCPB 安装 | 南向 | 解包 `.mcpb`、manifest 校验、钥匙串存密钥 | Claude Desktop 生态 |
| **P1** | AG-UI 输出适配 | 北向 | 嵌入第三方 Web 前端 | 1.0 稳定 |
| **P2** | A2A（客户端+服务端） | 双向 | 调用/暴露远程 agent，签名 Agent Card | v1.0；AAIF |
| **P2** | MCP Tasks 扩展 | 南向 | 长任务轮询句柄；映射到子 agent 后台任务 | SEP-2663（rmcp 尚有预期失败项） |
| **P2** | ACP 远程传输 / mcp-over-acp / subagents / session-fork | 双向 | RFD 状态为 Active/Draft，落地后切换 | 避免提前押注 |
| **P3** | A2UI、EMA、Roots/Sampling | — | Sampling/Roots 已弃用，**不实现** | 规范弃用 |

---

## 10. 风险清单

1. **WebKit/WebKitGTK 一致性与性能**（OpenCode 的出走原因）；Linux 依赖 `libwebkit2gtk-4.1` 部署较痛；Windows 需 WebView2 运行时（企业镜像可能缺失）。→ 双内核 CI；必要时回退 Electron/CEF。
2. **Tauri 3 与 GTK4/MSRV 变动**：Tauri 2.12 已把 MSRV 提到 1.90，策略为 stable-3；v3 alpha 要求 1.95；升级节奏需预留。
3. **协议高速演进**：MCP 2026-07-28 是破坏性大版本；ACP v2 仍 Draft；A2A v1.0 有破坏性变更。→ 适配器隔离 + 一致性测试（rmcp 的 conformance 套件、ACP TCK）。
4. **第三方订阅账号条款**：以 Claude/Codex 订阅登录驱动第三方 UI 的合规性（Remote Control 文档强调订阅登录而非 API Key；Zed 文档强调 External Agent 自带认证与计费）。**条款层面是否允许第三方应用批量/自动化驱动未核实**，需法务确认。
5. **移动端**：Tauri mobile 构建慢、插件缺口（推送需自建，如 Happy 用独立 Cloudflare Worker 推送 APNs/FCM）；iOS 上架审核对"远程执行代码"类应用的限制**未核实**。
6. **中继的信任与成本**：自建 vs 官方中继；若做 E2EE，需设备配对与密钥轮换设计（Happy 的 QR + libsodium 可借鉴）。
7. **许可证**：`cc-pane` 为 GPL-3.0；`desktop-cc-gui`、`vibe-editor2`、`Poracode` 等许可证需逐仓核对后再决定能否复用代码，目前仅作架构参考。
8. **来源质量**：部分数据来自博客/第三方逆向（Claude Desktop 的 Electron 版本、Codex 的内部库表），随版本变化，仅作参考。

---

## 11. 待用户拍板的问题 & 未证实事项

### 需要用户决策
1. **桌面壳底线**：愿意接受 Tauri 的 WebKit 风险（体积小）还是优先渲染一致性（直接 Electron，体积 ~200 MB）？我的建议是 Tauri 2 起步 + 双内核 CI + 协议隔离，保留回退权。
2. **移动端形态**：阶段 1 的"PWA 遥控器"是否够用？是否要求 iOS/Android 原生上架（决定是否立刻投入 Tauri mobile 或 RN/Expo）。
3. **中继**：自建 Cloudflare Worker 中继、依赖官方中继、还是仅支持 LAN/Tailscale/自托管？是否要求 E2EE？
4. **商业模式相关的账号**：是否允许用户用 Claude/Codex 订阅登录（见风险 4）；是否提供自有模型网关。
5. **开源与许可**：核心 daemon 的许可证（Apache-2.0 / AGPL / 源码可用）将影响可复用的参考仓库范围。
6. **内部协议是否自研**：我建议自研 Thread/Turn/Item/Event 并做适配；若希望降低成本，可直接以 Codex app-server 协议为蓝本裁剪（需评估其许可证与兼容性）。
7. **域名**：CIMD 文档与中继需要自有 HTTPS 域名，请确认品牌域名。

### 未证实 / 需后续核实
- `jan`、`goose`、`opencode` 本地目录为空，其源码结构（Jan 的 `src-tauri/src/core`、Goose `ui/desktop` 等）仅来自网页资料，未亲读源码。
- rmcp 3.x 对 `server/discover` 与旧版 `initialize` 的具体回落逻辑未逐行核对。
- ACP 中是否存在专门的 steer（运行中插话）方法：v2 文档里未检到，未证实。
- AG-UI 是否有 Rust SDK：未检索确认。
- 远程浏览器方案（Chrome DevTools MCP、Playwright MCP、Browserbase 等）未专项核实。
- Electron 44 / Chromium M152、Tauri/Electron 小应用体积（3.2 MB vs 85 MB）等数据来自博客类二手来源，方法不透明；Better Stack 的数字为同一屏幕录制应用的实测，可信度较高但应用类型特殊（含 ffmpeg）。
- iOS 审核政策、Tauri 移动端推送插件现状未核实。
- "Muse"具体指代（候选之一出现在 ACP 官方 agents 列表："Muse Spark Code，Meta Muse Spark 的非官方 agent"）需由对应课题确认。

---

## 12. 主要来源（节选，均于 2026-11-06 前访问）

- MCP 规范与博客：https://modelcontextprotocol.io/specification/2026-07-28/changelog ；https://blog.modelcontextprotocol.io/posts/2026-07-28/ ；https://blog.modelcontextprotocol.io/posts/mcp-roadmap/ （2026-08-22）；https://mcp-news.com/spec
- MCP Apps：https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/ ；https://github.com/modelcontextprotocol/ext-apps
- MCPB：https://github.com/modelcontextprotocol/mcpb ；https://claude.com/docs/connectors/building/mcpb ；授权：https://claude.com/docs/connectors/building/authentication ；https://workos.com/blog/mcp-client-identity-dcr-cimd-auth-md
- ACP：https://agentclientprotocol.com/protocol/v2/overview ；https://agentclientprotocol.com/get-started/registry ；https://zed.dev/blog/acp-registry ；https://blog.jetbrains.com/ai/2026/01/acp-agent-registry/ ；https://zed.dev/docs/ai/external-agents ；克隆源码 `repos/agent-client-protocol/docs/`
- A2A：https://a2a-protocol.org/latest/whats-new-v1/ ；https://github.com/a2aproject/A2A/releases ；https://www.linuxfoundation.org/press/a2a-protocol-surpasses-150-organizations-lands-in-major-cloud-platforms-and-sees-enterprise-production-use-in-first-year ；https://aaif.io/blog/a2a-joins-aaif
- AG-UI：https://www.copilotkit.ai/blog/ag-ui-1.0 ；https://docs.ag-ui.com/spec/1.0/schema ；https://docs.ag-ui.com/concepts/events
- Codex：https://openai.com/index/unlocking-the-codex-harness/ ；https://openai.com/index/introducing-the-codex-app/ ；https://openai.com/index/work-with-codex-from-anywhere/ ；克隆源码 `repos/codex/codex-rs/{app-server,app-server-protocol,app-server-transport,app-server-daemon,exec-server}`
- Goose：https://github.com/aaif-goose/goose/pull/10081 ；https://github.com/aaif-goose/goose/discussions/9367
- OpenCode：https://dev.to/brendonovich/moving-opencode-desktop-to-electron-4hip ；https://github.com/anomalyco/opencode/pull/25822 ；issue #26143
- Tauri：https://v2.tauri.app/blog/tauri-2.12/ ；https://v3.tauri.app/develop/cef/ ；https://crates.io/crates/tauri-runtime-cef
- 其它框架：Flutter 3.47 https://flutter.dev/blog/whats-new-in-flutter-3-47 ；Slint 1.18 https://www.slint.dev/blog/slint-1.18-released ；Wails v3 https://wails.io/blog/wails-v3-released/ ；Dioxus https://crates.io/crates/dioxus ；GPUI https://github.com/zed-industries/zed/tree/main/crates/gpui 与 https://docs.rs/crate/gpui-component/latest ；RN Windows https://devblogs.microsoft.com/react-native/react-native-windows-v0-85-is-here/
- 基准：https://betterstack.com/community/guides/scaling-nodejs/tauri-vs-electron-vs-deno-vs-electrobun/ ；https://trendintech.com/tauri-vs-electron-benchmark-tutorial-2026/ ；https://rustify.rs/articles/rust-tauri-vs-electron-2026
- 移动/远程：https://code.claude.com/docs/en/remote-control ；https://happy.engineering/docs/how-it-works/ ；https://github.com/slopus/happy
- 其他桌面应用：Cherry Studio https://deepwiki.com/CherryHQ/cherry-studio/3-application-architecture ；LobeHub https://github.com/lobehub/lobehub/blob/main/apps/desktop/README.md ；Jan https://pyshine.com/jan/
- 本地克隆参考路径：`D:\code\xuqiu\repos\desktop-cc-gui\src-tauri\src\{engine,event_sink.rs,web.rs,relay.rs,dsh_host.rs,pet_overlay.rs}` 与 `…\deploy\worker`；`D:\code\xuqiu\repos\eigent\backend\app\{hands,run_journal,run_sync,remote_sub_agent}`；`D:\code\xuqiu\repos\rust-sdk\ROADMAP.md`
