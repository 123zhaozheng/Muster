# 多设备 / 远程设备上的 Agent 执行：调研与 Muster 集成方案

> 调研日期：2026-11-06。目标：让 Muster（Electron + musterd，Pip 派发任务给 Codex CLI / Claude Code CLI / pi-durable 原生 agent）能在**其他设备**（Windows PC、Linux 服务器、Mac）上干活。
> 结论先行：**第一阶段做"无代理 SSH"（方案 A），把现有 driver 的 stdio 子进程换成 `ssh host -- codex app-server` / `ssh host -- claude ...`，原生 agent 的工具走 ssh exec + sftp；第二阶段再做出站 WebSocket 的 `muster-node` 守护进程（方案 B），以 MCP 风格暴露能力。** 理由见第 4、5 节。

---

## 1. 现有 Muster 代码与这件事的关系（已核对仓库）

- `packages/daemon/src/drivers/codex/rpc.ts`：对子进程 `codex app-server` 走 **stdio 行分隔 JSON-RPC**（`spawn(opts.command, opts.args, { cwd, stdio: pipe })`）。
- `packages/daemon/src/drivers/claude/session.ts`：Claude 走 stream-json，已经有可注入的 `SpawnFn(command, args, { cwd, env })`。
- 原生 agent：`@earendil-works/pi-durable` / `pi-ai`，模型调用在 musterd 进程内，工具（bash/读写文件）在本机执行。

=> 两个 CLI driver 都是"本地起一个 stdio 子进程"。**只要把 spawn 换成 `ssh -T <host> -- <cmd>`，协议层零改动**。这正是 Codex 桌面版 SSH 远程、Zed、Claude Desktop SSH session 的做法（见下）。

需要额外处理的点：
1. `claude/session.ts` 里 `sessionFile()` 用本机 `existsSync(~/.claude/projects/...)` 判断能否 `--resume`，远程时要改成远程判断（或直接用 session id 走 `--resume <id>`）。
2. `cwd` 不能再传给本地 spawn，要变成远程命令里的 `cd <dir> &&`（或 Codex 的 `thread/start` 参数里的 cwd）。
3. `env` 不会被 ssh 透传（除非服务端 `AcceptEnv`），要拼到远程命令里。
4. 进程生命周期：ssh 断开时远端进程是否被杀、能否续接（见 5.4）。

---

## 2. 现有项目怎么做（逐个）

| 项目 | Agent/模型在哪跑 | 远端放什么 | 传输 / NAT | 认证·配对 | 远端能做什么 | 许可证 | 成熟度 |
|---|---|---|---|---|---|---|---|
| **OpenClaw**（原 Clawdbot）nodes | Gateway（单一长驻进程）跑模型与会话 | `openclaw node run` 节点主机（headless / 服务 / macOS 菜单栏 app），可选开启"会话托管"在节点上跑 worker | 节点**出站**连 Gateway WebSocket（默认 `ws://127.0.0.1:18789`）；跨机靠 Tailscale / SSH 隧道 / 公网 HTTPS（`publicOrigin`），远程 join URL 要求 TLS | 设备身份密钥，连接时签 `connect.challenge` nonce；`openclaw devices join-code` 生成一次性 join URL，`npx openclaw connect <url> --service --session-host` 一步入网；非本地连接需显式 approve；命令面 allowlist | `system.run`（带审批与 allowlist，审批绑定精确 argv/cwd）、文件传输、MCP/skills 发布、相机/屏幕/computer-use、**发现并续接节点上的 Codex/Claude/pi 会话目录**、Codex `remote-exec`（基于 `codex.exec-server.stdio.v1`） | **MIT** | 很活跃、功能最全，文档频繁重构 |
| **Hermes Agent**（Nous Research） | 本机 | 无（SSH 后端） | `terminal.backend: ssh`，`TERMINAL_SSH_HOST/USER` | SSH key | 远程 shell / 文件；还有 Docker、Modal、Daytona、Singularity 后端 | **MIT** | 已知问题：每条命令是一次性 `ssh host 'cmd'`，`cd`/环境变量不持久（issue #1855） |
| **Happy**（happy.engineering） | Claude Code / Codex 在每台机器本地跑 | 每台机器一个 `happy` CLI/daemon 包住 CLI | 各设备**出站**连 Happy Server（可自托管）做**端到端加密中继** | 公钥配对（扫码），服务器只见密文 | 会话同步、远程发消息、审批、语音、推送；多机并行会话；daemon 可远程 spawn 会话 | **MIT** | CLI 已进入维护模式，新功能转向 Happy Desktop；分叉 Happier 增加"SSH 一条命令添加远程机器" |
| **Claude Code Remote Control** | 本机 `claude` 进程 | 本机 | 出站连 Anthropic 中继 | claude.ai 订阅登录（不支持 API key / 自定义 BASE_URL） | 从手机/网页操控本机会话 | 闭源服务 | GA；只能"远程看本机"，不是"让 agent 去别的机器" |
| **Claude Desktop SSH sessions** | 引擎（Claude Code）跑在**远端** | 首次连接经 SFTP 自动部署"remote server + Claude Code"到 `~/.claude/remote/`（约 1GB） | 走本机 OpenSSH 客户端（读 `~/.ssh/config`）或内置 SSH 客户端 | SSH key/agent；**推理凭证由桌面端注入远端进程环境变量** | 远端读写文件、shell、git、MCP；断线/关 app 后引擎继续跑完当前 turn，重开可 rejoin | 闭源 | 稳定可用；要求远端有 SFTP、非 noexec 的 home；注意 `MaxSessions 1`、systemd `KillUserProcesses` |
| **Codex 桌面 app SSH 远程** | `codex app-server` 跑在**远端** | **需要用户自行在远端安装并登录 codex**，app 通过远端 login shell 启动 app-server | SSH（读 `~/.ssh/config` 具体 host 别名），另有官方安全中继给手机连桌面 | SSH key；远端 `~/.codex/auth.json` | 远端项目的完整 Codex 能力；跨主机 handoff（worktree + git 状态迁移） | CLI Apache-2.0；app 闭源 | alpha→逐步稳定；已知 bug：csh 登录 shell、共享主机固定端口 9234 串会话 |
| **Codex exec-server** | — | `codex exec-server`（stdio 或 ws） | stdio 可直接套 ssh | `initialize`/`initialized` 握手 | 远程启动/控制子进程，`command/exec/outputDelta`、`exited` 通知；连接断开即清理进程 | **Apache-2.0** | 新组件，协议版本 `exec-server.v0`，会变 |
| **VS Code Remote-SSH** | UI 本地 | 自动下载 `vscode-server` 到远端 | SSH + 端口转发 | SSH | 文件、终端、扩展宿主在远端 | 扩展闭源 | 业界标准范式 |
| **Zed 远程开发** | UI + **LLM 调用在本地** | SSH 上去自动下载 headless server | 经 `ssh` 二进制，协议走 SSH stdio（早期经 Zed 服务器中转的模式已废弃） | SSH | 语言服务器、终端、任务在远端；Agent 面板可用 | 主体 **GPL-3**（部分 Apache） | 成熟 |
| **OpenHands** runtime | 后端（agent）在控制面 | 容器/远端里跑 Action Execution Server（HTTP `/execute_action`）；V1 改为 FastAPI agent-server（REST + WS） | HTTP | API key | bash、文件、浏览器（Playwright）、Jupyter | **MIT** | 成熟，偏沙箱/云 |
| **Goose** | `goosed` 可跑在远端 | goosed / `goose serve`（ACP over HTTP/WS） | 远端 TLS（证书指纹 pinning）+ 共享密钥；**`goose roam`：基于 iroh 的 P2P QUIC，带中继穿 NAT** | roam：交换"连接卡片"（公钥，可 QR），双方 accept 才能连；无 bearer token | 完整 ACP（session/new/load/prompt），可 bridge 成本地 ACP 端点给 Zed 等 | **Apache-2.0** | roam 为实验性 feature flag |
| **Manus "My Computer"** | 模型/规划在云端 | 桌面 app 作为本地执行器 | 出站连云 | 账号；授权文件夹；每条命令"Allow once / Always allow" | 终端、文件、应用、本地 GPU | 闭源 | 2026-03 发布 |
| **MCP-over-HTTP 设备代理**（如本次调研用的 winmcp / AgentDock 式） | 调用方 | 每台设备一个 MCP server（exec_command / read_file / file_edit…） | Streamable HTTP，经隧道/反代 | OAuth / token | shell、文件、（可扩展）截图/GUI | 视实现 | 本项目作者已在用，证明可行 |
| **Coder** workspaces | — | workspace agent 出站连 coderd，基于 Tailscale 的 tailnet + DERP 中继 | WireGuard/DERP | OIDC | SSH、端口、IDE | **AGPL-3.0（不可抄代码）** | 成熟，架构可参考 |
| **Teleport** | — | 每台机器一个 agent，反向隧道连 Proxy | 反向隧道 | 证书 / SSO | SSH、DB、K8s、审计 | 源码 AGPL，社区版二进制商业许可（**不可抄**） | 企业级，偏重 |
| **Tailscale / tsnet / WireGuard** | — | 每台装 tailscaled（tsnet 是 Go 库） | WireGuard + DERP 中继，自动 NAT 穿透；Tailscale SSH 免管理 key | 身份提供商 + ACL | 只是网络层 | Tailscale 客户端 BSD-3；WireGuard GPL-2（内核）/MIT（wireguard-go） | 非常成熟 |
| **mosh / sshx / ttyd** | — | mosh-server / sshx / ttyd | mosh：UDP 漫游；sshx：经服务器的协作终端；ttyd：WebSocket 终端 | — | 人用终端 | mosh GPL-3；sshx MIT；ttyd MIT | 都是"给人看的终端"，不适合作为 agent 执行通道 |
| **ssh2**（npm，mscdex） | — | 无 | 纯 JS SSH 客户端，exec/shell/sftp/端口转发 | key/agent/密码 | — | **MIT** | 成熟 |

### 2.1 归纳出的四种架构

1. **无代理 SSH，CLI 在远端跑**（Codex app、Claude Desktop、Zed、VS Code）：本地 UI/编排，SSH 上去起远端进程，stdio 跑协议。区别只在"远端二进制谁装"：Codex 要求用户自己装 + 登录；Claude Desktop / Zed / VS Code 自动部署。
2. **无代理 SSH，大脑在本地，只把工具调用远程化**（Hermes ssh 后端、Zed 的 LLM 在本地）：远端什么都不用装。
3. **每设备一个出站守护进程 + 中心网关/中继**（OpenClaw nodes、Happy daemon、Coder agent、Teleport、Manus）：解决 NAT、Windows 无 sshd、GUI/浏览器/相机、断线续跑、设备在线状态。代价是要写/发布/升级一个常驻程序和配对流程。
4. **点对点 / VPN 打底**（Goose roam 用 iroh，Coder/Tailscale 用 WireGuard+DERP）：网络层与应用层解耦。对个人用户最省事的是**直接让用户装 Tailscale**，Muster 不自己做 NAT 穿透。

---

## 3. 两个 CLI 在远端的安装与认证

**是否必须装在远端？** 方案 A/B 中只要让 Codex/Claude Code 在远端干活，就**必须在远端有它们的二进制**（它们的工具执行在自身进程里）。可选做法：
- 让用户自己装（Codex 官方 SSH 方案就是这样）——最快。
- Muster 自动部署（学 Claude Desktop / Zed）：检测 `uname -sm` / Windows，`sftp` 上传或远端执行官方安装命令（`npm i -g @openai/codex`；Claude 原生安装脚本），装到 `~/.muster/bin`。第二步再做。
- **原生 pi-durable agent 不需要在远端装任何东西**：模型调用留在 musterd，只把 bash/read/write/edit 工具改走 SSH。

**认证：**
- Codex：远端 `~/.codex/auth.json`（或 OS 凭证库）。远端无浏览器时用 `codex login --device-auth`（需在 ChatGPT 安全设置里开启设备码登录）；或在本机登录后拷贝 `auth.json`（官方列为备选；注意同一 ChatGPT 刷新令牌在多台机器同时刷新可能互相失效，优先每台机器各自 device-auth）。API key 用户可每次在远端命令里注入 `CODEX_API_KEY`/`OPENAI_API_KEY`。
- Claude Code：本机执行一次 `claude setup-token` 得到一年期 OAuth token，Muster 加密保存，**每次启动远端进程时注入 `CLAUDE_CODE_OAUTH_TOKEN`**（不落盘到远端；Claude Desktop 3P 也是把推理凭证注入远端进程环境）。或 `ANTHROPIC_API_KEY`；或用户在远端自己 `/login`。
- 注入方式：ssh 默认不透传 env。POSIX 远端用 `env K=V cmd`，但会出现在远端 `ps` 里；更稳的是先通过 stdin 或 sftp 写一个 0600 临时 env 文件，命令里 `set -a; . file; rm file; exec cmd`。Windows 远端用 PowerShell `$env:K='...'; & cmd`。
- **模型/配置**：继续由 Muster 通过命令行参数下发（`codex -m` / `-c key=value` 覆盖、`claude --model` / `--settings`），不依赖远端 config。需要隔离时设 `CODEX_HOME=~/.muster/codex`、`CLAUDE_CONFIG_DIR=~/.muster/claude`，并用 sftp 推送 Muster 管理的 config.toml / settings.json / MCP 配置。

---

## 4. 给 Muster 的集成方案（按上线速度排序）

### 方案 A：无代理 SSH（推荐先做，约 1–2 周）

**做法**
- 设备模型：`Device { id, name, kind: local|ssh, sshHost(别名), os, shell, defaultCwd, capabilities }`。直接读用户 `~/.ssh/config`（与 Codex/Claude Desktop 一致），只列具体 Host 别名。
- 传输：**用系统 OpenSSH 客户端**（`ssh -T -o BatchMode=yes -o ServerAliveInterval=15 host -- ...`）跑 agent 进程，天然支持 ssh-agent、ProxyJump、`~/.ssh/config`、Tailscale SSH、Windows 自带 OpenSSH。开启 `ControlMaster/ControlPersist` 复用连接。文件浏览/上传与原生 agent 工具用 **ssh2（MIT）** 的 exec + sftp（或同样走 OpenSSH + `sftp -b`）。
- Codex driver：`command = ssh`，`args = [-T, host, '--', <login-shell 包装> 'cd <cwd> && exec codex app-server']`，其余 JSON-RPC 不变。
- Claude driver：`SpawnFn` 换成 ssh 版本；`--resume` 的本地文件探测改为远端探测或直接用 id。
- 原生 pi-durable agent：给工具层加一个 `Executor` 接口（`exec/readFile/writeFile/list/stat`），实现 `LocalExecutor` 与 `SshExecutor`。可选：远端若已装 codex，可用 `codex exec-server --listen stdio`（Apache-2.0）作为带进程管理的远程执行后端。
- 设备探测：`ssh host -- uname -sm || ver`，`command -v codex claude git`，版本号，写入设备卡片（UI 只展示真实探测结果）。
- 网络：文档建议用户用 Tailscale（或已有的公网 SSH/跳板）；Muster 不做 NAT 穿透。

**优点**：远端零常驻程序；复用两个 CLI 的全部能力与它们自己的远端会话存储；和 Codex/Claude 官方远程方案同构，坑已被趟过。
**缺点/限制**：
- Windows 远端需开 OpenSSH Server，默认 shell 是 cmd.exe，引号很脆，建议要求/引导把 `DefaultShell` 设为 PowerShell，或统一 `powershell -NoProfile -EncodedCommand <base64>`。
- 无 GUI / 浏览器 / 截图；无"设备在线"推送，只能轮询探测。
- 断线即断流：远端进程随 SSH 结束（stdin EOF / SIGHUP）。第一阶段接受"turn 中断 → 用会话 id 续接"（Codex `thread/resume`、Claude `--resume`，转写都存在远端）。需要断线续跑时，用 `setsid` + 命名管道/`tmux` 包一层，或进入方案 B。
- 每台设备的凭证需要分别准备（见第 3 节）。

### 方案 B：`muster-node` 出站守护进程 + 配对（第二阶段，约 3–6 周）

**做法**（参考 OpenClaw nodes + Happy daemon，二者均 MIT，可借鉴设计）
- 每台设备装一个小的 Node 单文件程序 `muster-node`（可用 Node SEA / bun 编译），作为系统服务。
- **出站** WebSocket 连 musterd（Tailscale 地址或 musterd 暴露的 `wss://`），因此 Windows 无需 sshd、在 NAT 后也能用。
- 配对：musterd UI 生成一次性 join code/URL（含 musterd 公钥指纹）→ 目标机执行 `npx muster-node connect <url>` → 节点生成 Ed25519 设备密钥，签挑战 nonce → 在 Muster UI 中 approve；之后用设备密钥重连，可吊销。不使用长期 bearer token（学 OpenClaw/Goose roam）。
- 能力面（声明式 caps + 主控端 allowlist + 审批）：`exec`（PTY/非 PTY，流式输出，带取消）、`fs.*`、`agent.spawn`（本地起 codex app-server / claude stream-json，**把 stdio 隧道回 musterd**，现有 driver 只需一个"远程 stdio"适配）、`sessions.list`（扫描 `~/.codex`、`~/.claude` 会话目录，类似 OpenClaw session catalogs）、后续 `screen.capture` / `browser` / `computer-use`。
- 断线续跑：agent 子进程归 muster-node 所有，musterd 断开后继续跑，重连时按 seq 补发事件（Happy / Claude Desktop rejoin 的思路）。
- 凭证：由 musterd 在每次 `agent.spawn` 时下发短期注入（Claude token），或节点本地自管（Codex auth.json）。

**优点**：NAT/Windows 友好；在线状态、长任务、GUI 能力都有；为将来手机端/多主控打基础。
**缺点**：要写并维护一个常驻程序、发布与自动升级、安全审计面大。

### 方案 C：每设备一个 MCP server（可与 A/B 组合）

- 每台设备跑一个 MCP server（Streamable HTTP），暴露 `exec_command / read_file / write_file / list_dir / screenshot…`。Pip 与原生 agent 直接把它当工具；Codex/Claude 也能通过 MCP 配置"跨机操作"。本次调研里访问用户 Windows 仓库用的 winmcp 就是这种形态，已证明可行。
- 优点：标准协议，任何 agent 都能用；实现快（官方 TS SDK）。
- 缺点：MCP 是"工具调用"粒度，**不适合承载 Codex/Claude 整个会话的流式事件、审批、续接**；鉴权/穿透仍需自己做（反代 + token 或 Tailscale）；工具输出要截断，长任务不友好。
- 建议定位：不是独立路线，而是**方案 B 的 `muster-node` 同时以 MCP 形式暴露工具面**，给 Pip/原生 agent/外部 agent 用；agent 会话本身仍走 B 的 `agent.spawn` 通道。

### 对比

| | A 无代理 SSH | B muster-node | C 每设备 MCP |
|---|---|---|---|
| 上线速度 | 最快（改 spawn + Executor） | 慢 | 中 |
| 远端需安装 | 仅 CLI（原生 agent 什么都不用装） | muster-node + CLI | MCP server（+ CLI） |
| NAT / Windows | 依赖 sshd + Tailscale/公网 | 出站连接，最好 | 需反代/隧道 |
| 长任务 / 断线续跑 | 弱（需 setsid/tmux 包装） | 强 | 弱 |
| GUI/浏览器/截图 | 无 | 可扩展 | 可扩展 |
| 复用 Codex/Claude 全部能力 | 是 | 是 | 否（只是工具） |
| 安全面 | 继承 SSH | 自建配对与审批 | 自建鉴权 |

---

## 5. 推荐路线与实施要点

1. **现在：方案 A**。理由：Muster 的两个 CLI driver 已是 stdio 子进程（Codex 走 `codex app-server` JSON-RPC，Claude 已有注入式 `SpawnFn`），套一层 ssh 改动最小；这与 Codex 桌面版、Claude Desktop、Zed 的官方远程实现完全同构；原生 agent 抽一个 `Executor` 即可远程化且远端零安装。
2. **紧接着**：设备探测 + "缺少 codex/claude"的诚实空态 + 一键安装（sftp/官方安装命令）+ 凭证注入（Claude `setup-token`、Codex `--device-auth` 引导）。
3. **之后：方案 B**，并让 muster-node 同时提供 MCP 工具面（方案 C）。设计参考 OpenClaw（设备密钥签挑战 + join code + approve + 命令 allowlist + 会话目录发现）和 Happy（端到端加密中继，可选自托管）。网络层优先依赖 Tailscale，而不是自己做穿透；若一定要内建 P2P，可评估 iroh（Goose roam 所用，MIT/Apache 双许可）。
4. **许可证红线**：Coder、Teleport 源码为 AGPL，claudecodeui 为 AGPL，Zed 主体 GPL-3，mosh GPL-3 —— 只参考设计不复制代码。可放心借鉴/依赖：OpenClaw、Happy、Hermes、OpenHands、sshx、ttyd（MIT），Codex、Goose（Apache-2.0），ssh2（MIT），Tailscale 客户端（BSD-3）。

### 5.1 方案 A 的具体改动清单（建议）

- `packages/daemon`：新增 `devices/`（设备注册、ssh config 解析、探测、连接复用）、`exec/`（`Executor` 接口：Local / Ssh）。
- `drivers/codex/rpc.ts`：`command/args` 由 Device 决定；远端时 cwd 写进远程命令；`windowsHide` 等本地选项保留给本地 ssh 进程。
- `drivers/claude/session.ts`：`SpawnFn` 远端实现；`sessionFile/existsSync` 改走 Executor。
- `drivers/native`：工具层经 Executor 调用。
- `packages/protocol`：任务/成员增加 `deviceId`（协议冻结，需走变更流程）。
- UI：设备页显示真实探测结果（在线/离线、OS、已装 CLI 及版本、认证状态），未支持的能力给空态。

### 5.2 风险提示

- 远端 login shell 非 POSIX（csh/fish）会让包装命令失败（Codex issue #19302）——统一 `sh -lc '<cmd>'`（POSIX）或 PowerShell（Windows）。
- Linux `KillUserProcesses=yes` 会在断开时杀掉进程。
- 共享主机上不要监听固定端口（Codex issue #19590）；方案 A 全走 stdio 可避免。
- 凭证进入远端进程环境 = 信任该主机（Claude Desktop 3P 也因此默认关闭并要求 host allowlist）。Muster 应提供"受信设备"开关。

---

## 6. 参考来源

- OpenClaw：[Network](https://docs.openclaw.ai/network)、[Nodes](https://docs.openclaw.ai/nodes)、[Node host](https://docs.openclaw.ai/nodes/node-host)、[Session hosting](https://docs.openclaw.ai/nodes/session-hosting)、[Session catalogs](https://docs.openclaw.ai/nodes/session-catalogs)、[Node exec](https://docs.openclaw.ai/nodes/node-exec)、[Remote access](https://docs.openclaw.ai/gateway/remote)；LICENSE（MIT）
- Hermes Agent：[GitHub](https://github.com/NousResearch/hermes-agent)、[issue #1855](https://github.com/NousResearch/hermes-agent/issues/1855)
- Happy：[Features](https://happy.engineering/docs/features)、[CLI 组件](https://www.mintlify.com/slopus/happy/components/cli)、[Happier](https://ai-tldr.dev/tools/happier/)
- Codex：[Remote connections](https://developers.openai.com/codex/remote-connections)、[Auth / headless](https://developers.openai.com/codex/auth)、[exec-server stdio PR #20664](https://github.com/openai/codex/pull/20664)、[issue #19590](https://github.com/openai/codex/issues/19590)、[issue #19302](https://github.com/openai/codex/issues/19302)
- Claude Code：[Remote Control](https://code.claude.com/docs/en/remote-control)、[Desktop SSH sessions](https://code.claude.com/docs/en/desktop)、[SSH remote sessions on 3P](https://claude.com/docs/third-party/claude-desktop/ssh-remote-sessions)、[Authentication / setup-token](https://code.claude.com/docs/en/authentication)、[Agent SDK hosting](https://code.claude.com/docs/en/agent-sdk/hosting)、[Freestyle: SDK + spawnClaudeCodeProcess 远程 VM](https://www.freestyle.sh/docs/guides/run-claude-code-in-a-sandbox)
- Zed：[Remote Development](https://zed.dev/docs/remote-development)
- OpenHands：[Runtime architecture](https://docs.openhands.dev/openhands/usage/architecture/runtime)
- Goose：[Remote goose server](https://goose-docs.ai/docs/guides/remote-goose-server)、[Roaming agents](https://goose-docs.ai/docs/guides/roaming-agents)
- Manus My Computer：[The Next Web](https://thenextweb.com/news/meta-manus-my-computer-desktop-ai-agent)、[AlternativeTo](https://alternativeto.net/news/2026/3/manus-introduces-my-computer-for-local-ai-tast-execution-and-automation-on-macos-and-windows)
- 许可证核对（raw LICENSE 文件）：openclaw MIT、hermes-agent MIT、happy MIT、codex Apache-2.0、goose Apache-2.0、OpenHands MIT、sshx MIT、ttyd MIT、ssh2 MIT、tailscale BSD-3、coder AGPL-3.0、teleport AGPL-3.0、claudecodeui AGPL-3.0、zed GPL-3/Apache 混合
