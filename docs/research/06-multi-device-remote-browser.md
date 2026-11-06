# 06 多设备连接与远程浏览器调研

> 调研日期：2026-11-06。课题：一个个人 Agent 如何控制多台电脑 + 远程浏览器。
> 源码阅读仓库（`git clone --depth 1`，只读，位于 `D:\code\xuqiu\repos\`）：`iroh`（v1.4.1）、`browser-use`（0.13.14）、`rustdesk`（`libs/hbb_common` 是 git submodule，未拉取，信令 proto 以其 GitHub 原文为准）。
> OpenClaw 仓库在本次调研时由其他任务克隆中（目录为空），其源码位置来自 DeepWiki 问答，未亲自核对源码，已标注“经 DeepWiki”。
> 标注约定：【已证实】= 官方文档或亲读源码；【二手】= 第三方博客/评测，仅供参考；【未证实】= 未能验证。

---

## 0. 结论速览（TL;DR）

1. **多设备拓扑：采用“Hub + Node（外设）”模型，直接照抄 OpenClaw 的 gateway/node 配对设计**，再把传输层换成可插拔：
   - 默认 **iroh（Rust，按公钥拨号 + 打洞 + 无状态 relay）**。
   - 用户已有 Tailscale 或 Headscale 时，当作“普通地址”接入。
   - 浏览器端和移动 Web 走 WebSocket relay。
2. **配对用“两层审批”**：设备入网（device pairing）和能力面审批（capability surface approval）分开。首次入网用一次性、10 分钟过期的配对码。扩权必须再审批。
3. **远程浏览器分三档，对 Agent 暴露同一个 `browser.*` 工具面**：
   - A. 隔离的托管 Chromium profile，通过 CDP 驱动，**默认**。
   - B. 接管用户已登录的真实 Chrome。走扩展桥接（Claude in Chrome 模式）或 Chrome DevTools MCP 的 `--autoConnect`。**须逐次授权**。
   - C. 云浏览器（Browserbase、Steel、Kernel、Hyperbrowser、Browser Use Cloud）。只要提供 CDP URL 即可接入。自托管选 **steel-browser（Apache-2.0）**。
4. **页面感知默认用“可访问性树快照 + ref”**（Playwright MCP 路线，省 token 且稳）。视觉/坐标式（Anthropic computer use）作为兜底，用于 canvas、原生桌面应用。
5. **远程桌面/屏幕流不自研**。借鉴 RustDesk 的 rendezvous/relay 分层和“每项能力独立开关”的权限模型。注意 RustDesk 是 **AGPL-3.0**，不能直接链接进闭源产品，只借鉴设计。
6. **安全模型的核心**：
   - 每设备一把 Ed25519 密钥。
   - 能力 token 带范围，例如 `system.run`、`browser.proxy`、`screen.*` 各自独立审批。
   - **执行审批在 Node 本机强制**，不能只在 Hub 端。
   - 追加式审计账本，凭据不进模型上下文，默认 SSRF/域名策略。
7. 事件化契合点：`node.pair.requested`、`node.pair.resolved`、node 上下线、`node.invoke` 结果、浏览器下载/弹窗/崩溃，本身就是事件，直接并入本项目统一事件总线。browser-use 内部就是 bubus EventBus + watchdog，可作为参考。

---

## 1. OpenClaw 的 Gateway / Node 配对模型（最直接的参考）

### 1.1 角色与拓扑【已证实，官方文档】

来源：<https://docs.openclaw.ai/gateway/remote>、<https://docs.openclaw.ai/nodes/>、<https://docs.openclaw.ai/gateway/protocol>

- **一个 Gateway 是 master**，拥有会话、认证 profile、渠道和全部状态。其他都是客户端。
- 客户端有两种 **role**：`operator`（CLI、Web UI、macOS app）和 `node`（外设）。
  - Node 包括 macOS/iOS/watchOS/Android 和 headless 主机。
  - 通过 WS 握手时声明 role 与 scope。
- **Node 是外设，不是 Gateway**：不跑 gateway 服务，也看不到入站渠道消息，只接收 `node.invoke` RPC。
- 命令流：渠道消息 → Gateway → Agent → `node.invoke` → Node → 结果回 Gateway → 回复。
- Gateway WS 默认绑定 loopback，端口 `18789`。远程访问方式：Tailscale Serve、LAN/Tailnet 绑定，或 SSH 隧道（通用兜底）。
- **Node 主动向外连接 Gateway**，无需入站 SSH。官方 FAQ 将此列为相对 SSH 的优势。
- 协议由 TypeBox schema 定义：`packages/gateway-protocol/src/schema.ts`。
- 帧结构：connect 帧（含 role、scope、设备身份、签名）、hello-ok、presence 快照、各族 RPC（`node.*`、`devices.*`、approvals、audit ledger）、事件广播。

### 1.2 配对流程（两层）【已证实】

来源：<https://docs.openclaw.ai/gateway/pairing>、<https://docs.openclaw.ai/nodes/pairing-and-status>、<https://docs.openclaw.ai/cli/devices>

**第一层：设备配对（`role: node`）**，控制 `connect` 握手能否通过。

- Node 在握手时出示**签名的设备身份**（device id + 公钥）。
- Gateway 下发 challenge（nonce + 时间戳），客户端用私钥签名后随 `ConnectParams` 回传（经 DeepWiki）。
- Gateway 生成 pending request，由 operator 批准：`openclaw devices list` / `openclaw devices approve <requestId>`。
- 若设备重试且 role、scope 或公钥变化，**旧 pending 被替换为新 requestId**，防止批准过期请求。
- 已配对设备申请更高权限时，保留旧批准，另建“升级请求”，CLI 并排展示 Requested 与 Approved。

**第二层：节点能力面审批（`node.pair.*`）**，控制已连接的 Node 可以暴露哪些 capability/command。

- 声明的命令面比已批准的更宽时，写入 pending 并发出 `node.pair.requested` 事件。
- 批准前，该 Node 的命令全部被过滤。
- pending 不会因时间过期，Gateway 重启、Node 掉线后仍保留。
- 方法：`node.pair.list/approve/reject/remove`、`node.rename`。
- 事件：`node.pair.requested`、`node.pair.resolved`。

**一键配对（one-paste）**：

```
openclaw node run --pair "oc-pair://<setup-code>"
```

- setup-link 含 Gateway 端点、**短期单次使用的 bootstrap token（10 分钟过期）**，以及 TLS 证书 pin（Gateway 直接提供可 pin 叶证书时）。
- 文档类比：bootstrap token 像 Tailscale auth key，设备长期身份是另一层，两者分离。
- 管理员铸造的 bootstrap 会同时批准设备及其首次声明的命令面（含 `system.run`）。后续扩权仍需审批。

**自动批准的两条受限通道**：

- `gateway.nodes.pairing.autoApproveCidrs`：默认关闭。仅限首次、无 scope 的 `role: node`。绝不适用于 operator 和升级请求。
- `gateway.nodes.pairing.sshVerify`：默认开。Gateway 通过 SSH 读回设备公钥，与 pending 请求精确匹配才批准。证明“该密钥已在操作者控制的主机账户下”。

**撤销**：`node.pair.remove` 撤销设备 `node` 角色、丢弃已批准命令面、断开该设备 node 会话。混合角色设备只失去 node 角色。

**重连**：Headless node 在待批准期间以指数退避重连，**上限 30 秒**。

### 1.3 权限与 scope 【已证实 + 经 DeepWiki】

- `operator.pairing` 可批准 operator 设备。批准 `node` 或其他非 operator 角色需 `operator.admin`。
- `node.invoke` 是“动态 scope”：普通命令需 `operator.write`，`system.run`、`browser.proxy`、`fs.listDir` 需 `operator.admin`（见 `docs/gateway/operator-scopes.md`，经 DeepWiki）。
- **两道独立闸门**：Gateway 全局 node command policy，加 Node 本机的 exec approvals。官方明确说 node pairing 元数据不是第二层逐命令审批。
- Node 本机 exec approvals 默认是 `full` + `ask: off`（文档警告：用 setup link 之前先收紧）。**这是个宽松默认，本项目不要照抄，应默认 ask。**
- 审批相关源码位置（经 DeepWiki，未亲核）：
  - `src/gateway/server-methods/nodes.pairing.ts`（`nodePairingHandlers`，含 `approveNodePairing`、`enforcePendingNodePairingOwnership`）
  - `src/gateway/server/ws-connection/connect-session.ts`（`attachAuthenticatedGatewayConnect`、`captureAuthenticatedNodePairingState`）
  - `src/gateway/node-pairing-auto-approve.ts`
  - `src/gateway/methods/core-descriptors.ts`
- 存储：配对状态存 Gateway 的 SQLite 状态库中的设备记录。2026-01 起旧的 `nodes/paired.json` 已退出连接路径，`openclaw doctor --fix` 迁移。

### 1.4 OpenClaw 的远程浏览器【已证实】

来源：<https://docs.openclaw.ai/tools/browser>、<https://docs.openclaw.ai/tools/browser/remote>、<https://docs.openclaw.ai/gateway/security/browser-control>

- 默认：Gateway 内一个只绑 loopback 的小型 control service，管理名为 `openclaw` 的**独立** Chromium profile，与个人浏览器隔离。
- 内置 `user` profile：通过 **Chrome DevTools MCP** 附着到用户真实已登录 Chrome（existing-session）。
- **Node browser proxy（零配置）**：
  - 在有浏览器的机器上跑 `openclaw node run`，Node 自动广告 `browser.proxy` 命令。
  - Gateway 本机无浏览器能力时，自动把 browser 工具调用路由给该 Node。
  - 一旦某 Node 处理了请求，后续 snapshot 都留在该 Node，不会换机器。
  - `nodeHost.browserProxy.allowProfiles` 是最小权限边界。
  - 经 proxy **不允许** create/delete/reset-profile。
- 也支持远程 CDP（`browser.profiles.<name>.cdpUrl`）和 Browserless、Browserbase、Notte 等托管 CDP。
- 安全要点：
  - 远程 Gateway 上“browser control”等价于对该 profile 可达资源的 operator 访问。
  - 快照将 password、一次性码、卡号字段值替换为 `[redacted]`。
  - 默认严格的浏览器 SSRF 策略。
  - 控制 API 只认共享密钥，不认 Tailscale 身份头。
  - 官方建议：Gateway 和 Node 仅 tailnet，不要对 LAN、公网或 Tailscale Funnel 暴露 relay/control 端口。
- 信任边界：**一个 Gateway 一个信任边界**，不支持互不信任的多租户。

### 1.5 对本项目的启发

- 直接复用概念：Hub、Node、role/scope、设备身份签名、两层审批、一次性 bootstrap token、`node.invoke`、`browser.proxy` 路由。
- OpenClaw 用 WebSocket + 明文/TLS pin，依赖 Tailscale 或 SSH 解决 NAT。**本项目想做到“开箱即用”，需要自带穿透**，见第 2 节。
- 它的 node 命令面（`camera.*`、`screen.*`、`system.*`、`notifications.*`、`device.*`）是很好的 capability 命名参考。
- 注意：OpenClaw 近期有 Codex `remote-exec`、`codex.exec-server.stdio.v1`，说明“Node 上跑 Codex 子 agent”已有先例。本项目“连接 Claude Code/Codex 当子智能体”的需求，可以放在 Node 侧，作为 Node 的一个 capability（见第 5 节）。

---

## 2. 传输层选型：Tailscale / Headscale / NetBird / iroh / libp2p / WebRTC / 自建 relay

### 2.1 对比表

| 方案 | 本质 | NAT 穿透 | 嵌入应用 | 许可 | 对本项目的适配 |
|---|---|---|---|---|---|
| **iroh 1.x**（Rust） | 按公钥拨号的 QUIC 库，打洞 + 无状态 relay 兜底 | 约 9/10 直连（官方数据）；失败走 relay | 原生 Rust 库；有 Swift/Kotlin/JS/Python/Go/C 绑定（官方站声称）；可编译到 WASM 但**浏览器内不支持打洞** | Apache-2.0/MIT | **首选**：身份即公钥，天然契合设备配对 |
| Tailscale（含 tsnet） | WireGuard mesh，专有控制面 | DERP 兜底 | tsnet 是 Go 库，userspace 网络栈 | 客户端 BSD，控制面闭源 | 用户自带时作为地址接入；不适合作为产品强依赖 |
| Headscale | 开源 Tailscale 控制面（BSD-3），可用官方客户端 | 同上，可自托管 DERP | 只是服务端 | BSD-3 | 给进阶用户的“自托管 tailnet”选项；定位单 tailnet、个人使用 |
| NetBird | WireGuard mesh 全开源栈，Pion ICE | WebSocket relay | 自带客户端 | 客户端 BSD-3；management/signal/relay 为 **AGPLv3** | 自托管友好，但服务端 AGPL 有网络分发义务 |
| ZeroTier | 自有 L2 协议 | root 中继 | - | MPL + `nonfree/` 商业限制 | 不推荐（许可复杂） |
| libp2p | 模块化 P2P 栈（transport/muxer/DHT/pubsub） | 打洞成功率较低（二手：约 70%） | Rust/Go/JS 多实现 | MIT | 过重，需要自己拼装；浏览器互通好 |
| WebRTC | 浏览器标准 P2P，ICE/STUN/TURN/DTLS/SCTP | 好，TURN 兜底 | 浏览器内**唯一**可打洞方案 | - | 仅在“浏览器/移动 Web 作为端点”时使用；需自建信令 |
| 自建 relay | 自己运维 WebSocket/QUIC 转发 | 不打洞，纯中继 | - | - | 作为兜底层存在，iroh-relay 本身可自托管，不必另造 |

来源：<https://www.iroh.computer/blog/v1>、<https://docs.iroh.computer/about/faq>、<https://wz-it.com/en/blog/mesh-vpn-comparison-2026-overview/>、<https://tailscaleguide.com/posts/tailscale-vs-zerotier-vs-netbird-mesh-vpn-compared/>、<https://tailscale.com/docs/features/tsnet>。libp2p 70% 的数字来自 Pinggy 博客，属【二手】。

### 2.2 iroh 关键事实与源码定位【已证实】

- **1.0 于 2026-06-15 发布**，本地克隆的 workspace 版本为 1.4.1（`iroh/iroh/Cargo.toml`，MSRV rust 1.91）。底层 QUIC 实现已换成 n0 自研的 `noq`，支持 QUIC multipath 和 QUIC NAT traversal。
- 公共 relay 速率受限；0.35 的公共 relay 到 2026-12-31 停止；1.0 起 relay URL 随 wire 变更更新。**生产必须自托管或买 dedicated relay。**
- **身份与加密**：每个 Endpoint 有 Ed25519 `SecretKey`，`PublicKey` 即 `EndpointId`。
  - 源码：`iroh-base/src/key.rs`（`PublicKey` 约第 30 行，`SecretKey` 约第 261 行，`sign`/`verify`）。
  - TLS 无 CA，对端身份由公钥保证。
  - **“允许谁连接”由应用决定**，iroh 只保证“你连上的确实是这把公钥”。
- **连接建立**（文档与讨论 #4344）：
  - 典型路径是先连 home relay，用 pkarr 记录发布 `(endpoint_id, relay_url)`。
  - 对端查 DNS 取得 relay，经 relay 完成 QUIC 握手。
  - **握手完成、双方 TLS 认证后**才交换 IP 地址做打洞。
  - 这对“设备是否可信”的语义很友好：地址信息只在已认证后暴露。
  - 其他地址发现方式：mDNS（本地、无需联网）、直接发布 IP。
- **EndpointAddr**：`iroh-base/src/endpoint_addr.rs` 的 `EndpointAddr { id, addrs: BTreeSet<TransportAddr> }`。
- **Relay 协议**：`iroh-relay/src/protos/relay.rs`。
  - `ClientToRelayMsg::{Ping,Pong,Datagrams{dst_endpoint_id,..}}`；`RelayToClientMsg::{Datagrams,EndpointGone,Status,Restarting,Ping,Pong}`。
  - 单包上限 64KiB；默认 ping 间隔 15s；每客户端发送队列 512。
  - Relay **按 EndpointId 转发加密包，看不到明文**，无状态，便于水平扩展。
- **Relay 访问控制**：`iroh-relay/src/server.rs` 第 282–312 行的 `trait AccessControl { on_connect(&ClientRequest)->Access; on_disconnect }`，默认 `AllowAll`；1.0 新增 **Bearer token** 访问控制（release note #4326）。自托管 relay 可直接做“只放行已注册设备”。
- **应用层钩子**：
  - `iroh/src/protocol.rs`：`Router`、`ProtocolHandler::{on_accepting, accept}`，按 ALPN 分发协议。
  - `iroh/src/endpoint/hooks.rs`：`EndpointHooks::{before_connect, after_handshake}`。握手完成后可按对端 EndpointId 拒绝，**这正是“设备白名单/配对表”的实现点**。
- **多路径/自定义传输**：`iroh/src/socket/transports/{ip,relay,custom}.rs`，`TRANSPORTS.md` 登记自定义传输 id（Tor、BLE 预留）。移动端、局域网无网环境有扩展空间。
- 其他 n0 生态：iroh-gossip（pub/sub）、iroh-blobs（内容寻址文件传输）。可用于“跨机器传文件/产物”，减少自研。

### 2.3 为何 iroh 优于其他方案（本项目场景）

1. **“拨号对象 = 设备公钥”与“配对 = 交换并信任公钥”完全同构**，无需再设计一层设备 ID。
2. 一条 QUIC 连接内多路复用流：控制 RPC、事件流、文件、屏幕/截图流各用独立 stream，天然避免队头阻塞。官方 FAQ 提到可在其上跑 MoQ 做低延迟媒体。
3. 全 Rust，和候选的 Tauri/Rust 桌面栈一致（Tauri 非本课题范围，仅作提示）。
4. **局限（必须如实写入设计）**：
   - 浏览器里不能直接用 iroh 打洞，Web 端要走 WebSocket relay 或 WebRTC。
   - iroh 的 relay/discovery 是“有限中心化”，生产需要自备 relay。
   - 移动端 FFI 绑定成熟度【未证实】，落地前需实测 iOS/Android。

### 2.4 推荐分层

```
L3  Agent 协议（JSON-RPC 2.0 over 双向流；MCP 兼容）  —— 与传输无关
L2  身份与授权（Ed25519 设备密钥、配对表、能力 token、审批）
L1  传输适配器（trait Transport）
      ├─ IrohTransport   （默认，桌面/服务器/原生移动）
      ├─ WsRelayTransport（Web/PWA/受限网络；Hub 或自托管 relay 提供 wss）
      └─ OverlayTransport（用户已有 Tailscale/Headscale/NetBird，直接拨 100.x 地址）
```

L3 与 L2 不依赖具体传输。这样即使 iroh 不适合某平台，也可替换而不动协议。

---

## 3. 远程浏览器方案

### 3.1 方案矩阵

| 类别 | 项目 | 连接方式 | 感知方式 | 登录态 | 许可/成本 | 适用 |
|---|---|---|---|---|---|---|
| 驱动 MCP | **Playwright MCP**（微软） | 自启浏览器；`--cdp-endpoint`；`--extension` | 可访问性树快照 + ref | 持久/isolated/扩展接管 | Apache-2.0，免费 | 默认动作驱动 |
| 驱动+调试 MCP | **Chrome DevTools MCP**（Google） | Puppeteer；`--autoConnect` 接管真实 Chrome | DevTools：trace、网络、console | 当前 Chrome（需开 remote debugging 并确认弹窗） | Apache-2.0，默认上报使用统计，可 `--no-usage-statistics` | 调试、性能、接管 |
| Agent 库 | **browser-use** 0.13.14 | CDP（`cdp-use`），已脱离 Playwright | DOM+截图 | 可读系统 Chrome profile | MIT；云 $0.02/h 起 | 端到端自主任务 |
| SDK | **Stagehand v4**（Browserbase） | CDP，Playwright 风格 API | `act/extract/observe` | 取决于后端 | MIT | 可维护的混合脚本 |
| 云浏览器 | **Browserbase** | CDP URL + SDK | - | profile/context | $20/月起，$0.10–0.12/h；SOC2 | 最全托管 |
| 云浏览器 | **Steel** | CDP；**steel-browser 可 Docker 自托管** | - | Profiles API | Apache-2.0；云 $0.10/h；自托管单会话 | 自托管首选 |
| 云浏览器 | **Kernel** | CDP；hosted MCP | - | Managed auth/Profiles | 浏览器镜像 Apache-2.0；约 $0.06/h headless，按秒计 | 低价、长会话（72h） |
| 云浏览器 | **Hyperbrowser** | CDP/SDK/MCP | - | Profiles | $0.10/h；HyperAgent 为 **AGPL-3.0** | 注意 AGPL |
| 扩展桥接 | **Claude in Chrome** | 扩展 + native messaging + 认证 WS bridge | a11y 树/截图/CDP | 用户真实登录态 | 专有，需付费 Claude 套餐 | 参考架构，不可复用 |
| 扩展桥接 | Playwright Extension / browser-relay / OpenCLI / chrome-use | 扩展 + 本地 relay | 同左 | 真实登录态 | Apache/MIT | 可借鉴或集成 |
| 视觉/桌面 | **Anthropic computer use** | 你的应用在沙箱中执行 | 截图 + 坐标 | 沙箱内 | API 计费 | 原生应用、canvas |

来源：<https://developertoolkit.ai/en/ecosystem/mcp/browser-automation/>、<https://agentscamp.com/guides/comparisons/browser-agents-compared-2026>、<https://ecorpit.com/cloud-browsers-ai-agents-browserbase-steel-kernel-2026/>、<https://browser-use.com/cloud-browsers>、<https://playwright.dev/mcp/configuration/browser-extension>、<https://github.com/ChromeDevTools/chrome-devtools-mcp>、<https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool>。价格和许可来自第三方评测（2026-10 前后），【二手】，选型落地前请核对官网。

### 3.2 browser-use 源码要点【已证实，亲读】

- 路径：`repos/browser-use/browser_use/`。`browser/session.py`（4197 行）中的 `BrowserSession` 以 **bubus EventBus** 为核心。
- `browser/events.py` 定义了全套事件类型，如 `NavigateToUrlEvent`、`ClickElementEvent`、`ScreenshotEvent`、`BrowserStateRequestEvent`、`TabCreatedEvent`、`TargetCrashedEvent`、`BrowserReconnectingEvent`、`DownloadStartedEvent`、`DialogOpenedEvent`、`CaptchaSolverStartedEvent` 等。
- `browser/watchdogs/` 下各个 watchdog 订阅事件处理横切关注点：security、downloads、popups、crash、permissions、captcha、har_recording、storage_state、dom、screenshot、default_action。
- **`security_watchdog.py` 实现 `allowed_domains`/`prohibited_domains`**；评测文章指出其 allowlist 曾有被绕过并已修补的严重漏洞【二手】，且 browser-use 自身不提供沙箱。
- 连接模式（`session.py` 约 213–280、806–880 行）：
  - 有 `cdp_url` 则直连。
  - `is_local` 则本地启动 Chrome。
  - `use_cloud` 则调 `browser/cloud/cloud.py` 的 `CloudBrowserClient` 申请云浏览器，拿回 `cdpUrl`。
  - 连接超时 15 秒。
- `mcp/` 目录同时提供 MCP server（`server.py`、`cli_mcp.py`）和 MCP client。
- **启发**：
  - “Browser 会话 = 事件总线 + 看门狗”，与本项目“一切皆事件”同构。
  - 浏览器后端抽象成“拿到一个 CDP URL”最简单，本地/远程/云统一。
  - 横切安全策略（域名、下载、弹窗）做成订阅者，而非塞进每个动作。

### 3.3 Claude in Chrome 的扩展桥接架构【二手，逆向分析；官方文档为辅】

来源：<https://noemica.io/blog/reverse-engineered-claude-in-chrome>、<https://claude-code.genisisiq.com/03-tools-integrations-security/browser-automation-and-claude-in-chrome/>、<https://code.claude.com/docs/en/chrome>、<https://github.com/whg517/browser-bridge/blob/main/docs/architecture.md>

- 本地链路（逆向文章）：`Claude Code ←stdio→ MCP server ←TCP:18765→ Native Host ←native messaging(4字节小端长度+JSON)→ 扩展 service worker → CDP / chrome.*`，五个进程、四次协议转换。
- 原因：扩展不能监听 stdio，MCP 必须 stdio，所以需要 native messaging host 做桥。
- 新版（claude-code 2.1.215 分析）：普通上下文走**带认证的 WebSocket BridgeClient** 连云端 bridge，通过 `connect` 帧携带 OAuth，经 `paired/waiting` 状态，按 `target_device_id` 选定扩展设备并持久化。**这就是“设备配对 + 远程浏览器”的现成产品形态。**
- native messaging 约束：manifest 的 `allowed_origins` 只允许指定扩展 ID；Chrome→host 上限 64MB，host→Chrome 上限 1MB；通过 stdin EOF 关闭；MV3 service worker 约 5 分钟会重启，状态应放在 MCP/Hub 侧，host 保持极薄（browser-bridge ADR）。
- 本地 socket 加固：目录 0700、socket 0600、校验属主、消息 ≤1MiB。
- 权限：每个站点首次动作询问，并可选“本会话该站点全部允许”；遇登录页/CAPTCHA 暂停，交给用户。

**对本项目的采纳建议**：自研一个“Agent Bridge 扩展”（MV3），用 native messaging 连本机 Node 进程，Node 进程再经 iroh 与 Hub 通信。这样“远程浏览器 = 某个 Node 上的真实 Chrome”，与 OpenClaw 的 `browser.proxy` 同构。扩展 ID 白名单、站点级权限、MV3 重启保活都按上面的坑处理。

### 3.4 接管用户真实 Chrome 的几条现实约束

- Chrome 144+ 的 `chrome://inspect/#remote-debugging` 开关加弹窗确认，是 Chrome DevTools MCP `--autoConnect` 和 Playwright `--cdp-endpoint=chrome` 的前提（官方文档，【已证实】）。
- “Chrome 136 起默认 profile 忽略 remote-debugging 端口”这一说法来自第三方对比页，【二手/未亲验】。含义是不能再简单地对用户日常 profile 开 `--remote-debugging-port`，所以扩展路线更稳。
- Chrome DevTools MCP **默认上报使用统计**，集成时必须 `--no-usage-statistics`，并设 `CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS`。
- Playwright MCP 的 `--allowed-origins/--blocked-origins` 文档明确写**不是安全边界、不处理重定向**，不能当作唯一防线。

### 3.5 推荐的远程浏览器架构（三档统一抽象）

```
Agent ──browser.* 工具──▶ BrowserRouter（在 Hub）
                           │  选择目标：host / node:<id> / cloud:<provider>
          ┌────────────────┼─────────────────────┐
          ▼                ▼                     ▼
   A. 托管隔离 profile   B. 真实 Chrome 接管      C. 云浏览器
   Node 本地 Chromium    Node 上的扩展桥接       CDP URL（Browserbase/
   CDP（独立 user-data）  或 DevTools MCP         Steel/Kernel/…）
                         autoConnect
```

- **统一动作面**：`navigate / snapshot / click(ref) / type / select / screenshot / tabs / download / evaluate(默认关) / wait`。snapshot 返回带 ref 的可访问性树，ref 过期要有恢复循环（OpenClaw 自带 `browser-automation` skill 即教这个“snapshot、stable-tab、stale-ref、manual-blocker”循环）。
- **默认 A**：每个 Agent/任务一个独立 profile，销毁即清。可选择性导入 cookie（OpenClaw 在 macOS 上提供“只复制所选 cookie”，localStorage/IndexedDB 不复制，是好的最小授权模式）。
- **B 需要显式开启**：每个站点首次访问弹审批，高危操作（提交表单、支付、删除）必须人工确认。遇到登录/CAPTCHA 交还用户（Take over）。
- **C 作为“云端无人值守”**：定时任务、事件触发（GitHub PR 等）的无人场景首选，不占用户电脑。自托管用 steel-browser。
- **路由规则（抄 OpenClaw）**：一旦某 Node/后端处理了请求，同一任务的后续调用粘在同一后端，失败不跨机重放；`target=host|node|cloud` 显式优先于自动。
- **实时观看与接管**：用 CDP `Page.startScreencast` 或定期截图，通过 iroh 独立 stream 推给 UI。Kernel/Browserbase/Steel 的 live view 可作为云档的现成实现。具体实现细节【未验证】，需原型。
- **实现语言**：驱动层可以是 Node sidecar（Playwright MCP / chrome-devtools-mcp 现成），或 Rust CDP 库。我没有验证具体 Rust CDP crate 的成熟度，【未证实】，建议第一版直接 sidecar 复用 Playwright MCP，Rust 只负责进程管理与路由。

### 3.6 视觉兜底：computer use

- Anthropic 计算机使用工具已有新的 `computer_toolset_20260801`（一个条目含 17 个成员：`screenshot`、`zoom`、`left_click`、`type`、`key`、`scroll` 等），**由你的应用在你控制的环境中执行每次调用**；目前不在 Claude Managed Agents 中提供（官方文档，【已证实】）。旧版 `computer_20251124` 仍需 beta header。
- 官方安全建议：专用 VM/容器最小权限、不给敏感数据、域名白名单、重大决策人工确认。工具返回内容（截图）会经分类器扫描 prompt injection。
- 本项目：把它作为 Node 的 `screen.*` + `input.*` capability，默认关闭，开启需 `operator.admin` 级审批，并**强烈建议跑在受控的虚拟显示（Xvfb/容器/VM）**，而非用户主桌面。

---

## 4. RustDesk 架构中值得借鉴之处（选读）

源码：`repos/rustdesk/`。协议 proto 在 submodule `libs/hbb_common`（未拉取），内容以 GitHub 原文 <https://github.com/rustdesk/hbb_common/blob/main/protos/rendezvous.proto> 为准。

### 4.1 两段式服务端【已证实，官方文档】

来源：<https://rustdesk.com/docs/en/self-host/>

- **hbbs**（ID/rendezvous/信令）：设备持续向它注册、保活当前地址；A 想连 B 时由它协调打洞。
- **hbbr**（relay）：打洞失败才走。多数情况下 relay 不被使用。
- 端口：TCP 21115（NAT 类型探测）、21116（UDP+TCP，注册与打洞）、21117（relay）、21118/21119（WebSocket 版，便于过代理）。

### 4.2 信令消息与打洞协调（DeepWiki + 原文）【二手为主】

- 消息：`RegisterPeer/RegisterPk/PunchHoleRequest/PunchHoleSent/PunchHoleResponse/RequestRelay/RelayResponse`。
- `PunchHoleRequest` 字段含 `licence_key`、`nat_type`、`force_relay`、`token`，新版加入 `webrtc_sdp_offer`（说明其也在引入 WebRTC 传输）。
- `handle_punch_hole_request` 逻辑：key 不匹配拒绝；对端不存在 `ID_NOT_EXIST`；超时 `OFFLINE`；双方同一内网则回 `FetchLocalAddr`；否则下发 `PunchHole`；对称 NAT 强制 relay。
- 记录 `PUNCH_REQS` 做审计，同源同目标 60 秒内去重。
- 客户端在 `src/rendezvous_mediator.rs`（1962 行）：`start_udp`/`start_tcp`/`handle_resp`/`handle_punch_hole`；`PunchPool` 并发上限 32；ICE 候选去重窗口 256、待处理上限 64、WebRTC answerer 上限 16。这些**资源上限**设计值得抄。
- 连接路径多级尝试：UDP/KCP 打洞 → TCP 打洞 → WebRTC ICE → relay（DeepWiki）。

### 4.3 被控端：采集、编码、输入、权限

亲读目录结构：

- `libs/scrap/src/`：屏幕采集，`dxgi`（Windows）、`quartz`（macOS）、`x11`、`wayland`、`android`；`common/` 下有 `vpx`、`aom`、`hwcodec`、`mediacodec` 编码。
- `libs/enigo/`：跨平台键鼠注入；`src/server/input_service.rs`（2838 行）。
- `src/server/video_service.rs`（1592 行）、`video_qos/`：采集、编码、码率自适应。
- `src/server/connection.rs`（7901 行）：被控端连接处理；`enum AuthConnType { Remote, FileTransfer, PortForward, ViewCamera, Terminal }`（第 290 行）。
- **权限模型**（`connection.rs` 约 2696–2730 行）：`is_permission_enabled_locally(enable-*)`，有 `access-mode` 全局 `full/view`，另有逐项开关：keyboard、clipboard、file、audio、camera、terminal、tunnel、restart、recording、block_input。服务端下发的 `ControlPermissions` 可以进一步收紧。
- **受信设备**：`src/trusted_devices/`（`mod.rs` 约 244 行）。每条记录含 `verifier: [u8;32]`（只存哈希）、`DeviceInfo{time, expires_at, id, name, platform}`，`MAX_RECORDS=128`，支持撤销和按 scope 校验——“记住此设备/二次验证”的好范例。
- 许可：**AGPL-3.0**（`LICENCE` 首行已确认）。借鉴设计可以，直接链接代码会传染。

### 4.4 对本项目

- **不要做远程桌面**，做 Agent 控制。如果要“看用户真实桌面”，优先集成：Node 的 `screen.snapshot`（单帧截图）+ 低帧率流，必要时调用户已装的 RustDesk 或操作系统自带方案。
- 可借鉴：
  1. 注册保活 + 按需打洞 + relay 兜底的分层，与 iroh 已内置的做法一致，不必另写。
  2. **每项能力独立开关**（键盘、剪贴板、文件、终端、端口转发），对应本项目 Node 的 capability 面。
  3. 连接类型分类（Remote/FileTransfer/PortForward/Terminal）对应不同审批。
  4. 登录失败限流（`src/server/login_failure_check.rs`）。
  5. 并发和队列的硬上限。

---

## 5. 多设备拓扑设计（建议方案）

### 5.1 角色

| 角色 | 说明 | 举例 |
|---|---|---|
| **Hub** | 主 Agent 所在进程：事件总线、会话/子 Agent 编排、审批队列、审计账本、设备注册表。可在桌面本机、家庭服务器或云 VPS | 桌面 App 内嵌 Hub；可选部署到常开主机 |
| **Operator** | 人机界面客户端：桌面 UI、手机 App、Web | Tauri/Web UI |
| **Node** | 外设：提供 capability 的设备守护进程 | 另一台 Win/Mac/Linux、手机、NAS、CI 机器 |
| **BrowserBackend** | 一种特殊 capability：本机 Chromium、扩展桥接、云 CDP | 见第 3 节 |
| **AgentHost** | Node 上的一种 capability：运行 Claude Code/Codex 等编程 agent 的子进程（通过 ACP/CLI/SDK），作为 Hub 的子智能体 | `agent.spawn`，【设计，需结合课题 07 或相关报告】 |

Hub 本机同样可以是自己的一个 Node（macOS app 的 node mode 就是这样：同一个 app 既是 operator 也是 node，只保留一个 Gateway 连接和一个 node 身份）。

### 5.2 设备注册与身份

- 每个设备首次启动生成 **Ed25519 密钥对**，私钥存 OS 密钥链（Windows DPAPI/Credential Manager、macOS Keychain、Linux Secret Service），不落明文文件。
- `device_id = 公钥`（iroh 的 EndpointId 同一把钥，省去映射）。
- Hub 的设备注册表（SQLite）字段建议：

```
device(id=pubkey, display_name, platform, roles[], approved_caps[],
       pending_caps[], created_at, last_seen, revoked_at,
       policy{exec: ask|allow-list|deny, browser:{profiles[], domains[]}, ...})
```

- 持久化与事件：状态变更都写入事件日志并广播 `device.pair.requested/resolved`、`device.online/offline`、`device.caps.changed`。

### 5.3 配对流程（建议）

```
[Hub UI] 添加设备 → 生成一次性 bootstrap：
   { hub_endpoint_id, relay_hint, token(单次,10min), tls_pin?, scopes_preview }
   → 二维码 / 短码 / 一行命令 `agent-node pair "<code>"`
[Node]  执行 → 用 hub_endpoint_id 经 iroh 拨号（或 ws relay）
         → 握手后出示自己的 device pubkey + 对 challenge 的签名 + token
[Hub]   校验 token → 创建 pending(device, roles, 声明的 caps)
         → UI 显示：设备名/平台/公钥指纹（SAS，如 4 组词）/ 请求的能力
         → 用户批准（可逐能力勾选） → 写入注册表，下发 device grant
[之后]  Node 重连只用设备密钥签名，无需 token
         声明的能力面变宽 → 回到 pending（与 OpenClaw 第二层一致）
```

- 增强：配对时双方各显示公钥短指纹，用户目视核对，防中间人（OpenClaw 靠 TLS pin 和一次性 token；本项目有设备公钥，可更强）。
- **自动批准只开两条窄通道**（照搬 OpenClaw 的限制）：同一局域网加 SSH 验证公钥；或管理员预签发 bootstrap。永不自动批准“权限升级/公钥变化”。
- 撤销：`device.remove` 立刻吊销授权、断开所有会话，并使其持有的能力 token 失效；同时在 relay 的 AccessControl 里拉黑该 EndpointId。

### 5.4 NAT 穿透与连接

- Hub 与 Node 双方都是 iroh Endpoint。Node 启动即注册 home relay 并发布 `(id, relay_url)`。
- 拨号：`endpoint.connect(hub_id, ALPN)`，iroh 自动 relay → 握手 → 打洞 → 直连迁移。
- **ALPN 划分**（单连接内多流）：`agent/ctl/1`（控制 RPC）、`agent/evt/1`（事件）、`agent/blob/1`（文件，可用 iroh-blobs）、`agent/screen/1`（屏幕/CDP screencast）。
- Hub 做服务端时在 `EndpointHooks::after_handshake` 校验对端 EndpointId 是否在注册表且未吊销，否则立即关闭（也可用 relay 侧 `AccessControl` 提前挡）。
- 无公网时：局域网 mDNS 发现；Web 端走 wss relay；用户自带 Tailscale 时直接拨 tailnet 地址。
- 自托管 relay：用 `iroh-relay`（`iroh-relay/src/main.rs`），配 Bearer token 访问控制。

### 5.5 离线与可靠性

- 连接模型是 **Node 主动外连、断线指数退避重连（上限 30s，同 OpenClaw）**。Hub 不假设 Node 一定在线。
- Hub 记录 Node 的 `last_seen` 与 presence；调用离线 Node 的工具立即返回结构化错误 `node_offline`，由编排层决定“等待上线、改派其他设备、通知用户”，而不是阻塞。
- 对**长任务**：Node 侧任务有 `task_id`，断线不丢，重连后 Hub 用 `task.resume(task_id, last_event_seq)` 补拉事件（事件带单调序号）。这与子 Agent “有状态、可从某点分支、可插话”的设计一致：Node 上的子 Agent 会话也由 Hub 持久化事件流，可 fork。
- 待办队列：对不要求即时的操作（定时任务触发的离线设备工作）入队，Node 上线后下发。需要用户明确这类操作允许延后（见第 8 节待拍板）。
- Hub 自己要“常开”：建议提供“一键部署到 VPS/家庭服务器”（OpenClaw 的主流用法也是常开 Gateway + 笔记本当 node）。

### 5.6 协议建议

- 传输之上用 **JSON-RPC 2.0（双向）+ 事件流**，工具面与 MCP 兼容，便于直接把 Node 的 capability 暴露为 MCP 工具给任意模型。
- 命名参考 OpenClaw：`node.invoke(node_id, command, args)`、`node.pair.*`、`system.run`、`system.which`、`browser.proxy`、`screen.snapshot`、`notifications.*`、`camera.*`。
- 所有请求带 `request_id`、`deadline`、`cancel`（OpenClaw 明确保留 deadline 与取消语义）。
- 版本：显式协议版本号与 N-1 兼容窗口（OpenClaw 有 “N-1 node window”）。

---

## 6. 安全模型

### 6.1 威胁面

| 威胁 | 说明 |
|---|---|
| 设备冒充/中间人 | 伪造 Node 或 Hub |
| 配对令牌泄露 | 二维码被拍、命令行进历史 |
| 命令执行滥用 | `system.run` 被提示注入驱动 |
| 浏览器横向 | Agent 用用户登录态访问内网/银行；SSRF；恶意页面注入指令 |
| 凭据泄露 | cookie、API key、截图中的敏感信息进入模型上下文或日志 |
| relay/中间节点窥探 | 流量元数据 |
| 多租户混用 | 一个 Hub 供互不信任用户 |

### 6.2 控制措施

**身份与密钥**
- 每设备 Ed25519；私钥在 OS 密钥链。公钥即身份；iroh QUIC/TLS 由公钥认证，relay 看不到明文。
- Hub 注册表是唯一授权来源（连接成功不等于被授权）。
- 轮换：设备密钥丢失就吊销重配；会话/能力 token 短期并可轮换（OpenClaw：token 轮换不能升级角色）。

**授权（三层）**
1. **设备准入**：是否允许此公钥连接（配对表）。
2. **能力面**：该设备被批准暴露哪些命令/能力（pending 机制）。
3. **调用时策略**：每次调用按风险分级——只读（自动）、写入/外发（按策略询问）、破坏性/金融/凭据（强制人工确认）。
- 执行审批 **在 Node 本机强制**（Hub 被攻破也不能绕过本机 allowlist）。默认 `ask`，而非 OpenClaw 的 `full/ask:off`。
- scope 分级：参照 `operator.read/write/pairing/admin`，`system.run`、`browser.proxy`、`fs.*`、`screen.*` 归 admin 级。

**浏览器专项**
- 默认隔离 profile；真实 Chrome 接管需逐站点授权，遇登录/CAPTCHA/支付交还用户。
- **SSRF/域名策略在网络层做**（拦截 request，含重定向），而不是靠提示词或只靠 allowed-origins（Playwright 官方说它不是安全边界）。默认阻断内网、`file://`、云元数据地址（169.254.169.254）。
- 快照中密码、OTP、卡号字段脱敏（学 OpenClaw `[redacted]`）。
- 凭据通过 secrets 注入（Playwright MCP 有 `--secrets` 文件；browser-use 有 sensitive_data），**不进模型上下文**。
- 下载进隔离目录、视为不可信输入。
- `evaluate`（任意 JS）默认关闭。
- 页面内容一律按不可信输入包裹（OpenClaw 有 external content wrapping）。

**屏幕/桌面专项**
- computer use 跑在受控虚拟显示或容器；用户主桌面只允许单帧截图，且需明显的“Agent 正在查看/控制”指示和随时中止热键。

**审计**
- 追加式审计账本：谁（operator/agent/子 agent）、何时、哪个设备、哪个命令、参数摘要（脱敏）、审批人、结果。OpenClaw 有 “metadata-only 活动历史与决策回执” 的 Ledger RPC，可参照。
- 哈希链（每条含前一条哈希）防篡改；与事件总线同源，便于回放。
- 敏感内容只存元数据，转录与截图另存并设保留期。

**网络暴露**
- Hub 控制端口默认仅 loopback；远程仅经认证后的 iroh/wss；不要对公网直接暴露 CDP 端口或控制 API（OpenClaw 与 Anthropic 文档都强调）。
- 自托管 relay 开 Bearer/AccessControl，避免成为开放中继。

**信任边界**
- 与 OpenClaw 一致：**一个 Hub 一个信任边界**，不宣称多租户隔离；多用户需多 Hub。

**应急**
- “一键断开所有 Node 并吊销能力 token”，轮换 Hub 密钥，导出审计证据（对应 OpenClaw 的 incident response 流程）。

### 6.3 密钥与凭据存放

| 资产 | 位置 | 备注 |
|---|---|---|
| 设备私钥 | OS 密钥链 | 不导出 |
| 配对 bootstrap token | 内存 + 哈希落库 | 单次使用、10 分钟过期；只存哈希（RustDesk `trusted_devices` 同做法） |
| 模型 API key、站点凭据 | 加密 vault，按需注入 | 绝不进入 prompt 与日志 |
| 浏览器 profile/cookie | 每任务隔离目录，任务结束清理 | 云 profile 视为活凭据，最小化保存 |
| 审计账本 | 本地追加文件/SQLite + 哈希链 | 可选外部备份 |

---

## 7. 对本项目的具体建议（落地顺序）

1. **v0（2–4 周）**：Hub 内嵌于桌面 App；Node 为同一二进制的 headless 模式；传输先用 WebSocket + 配对码（含 TLS pin），跑通：配对 → 能力声明 → `node.invoke` → 审批 UI → 审计。参考 OpenClaw 的协议形态，快速验证。
2. **v1**：换 iroh 传输（`Router` + ALPN 分流；`EndpointHooks::after_handshake` 做白名单），自托管 relay + Bearer；保留 WS 兜底。
3. **浏览器 v1**：A 档（Node 本地托管 Chromium + Playwright MCP/CDP sidecar，a11y 快照）+ C 档适配器（CDP URL 接 steel-browser、Browserbase、Kernel）。B 档（扩展桥接）排 v2。
4. **统一事件化**：设备上下线、配对请求、审批请求、浏览器下载/弹窗/崩溃，全部作为事件进入主总线。子 Agent 在 Node 上运行时，其事件流经 `agent/evt` 回流，支持 fork 与 interrupt（取消 + 注入新消息）。
5. **不自研**：打洞与 relay（iroh）、远程桌面（集成现有）、浏览器内核操作（Playwright/Chrome DevTools MCP）、云浏览器（适配 CDP 即可）。
6. **许可检查清单**：
   - RustDesk（AGPL-3.0）：只借鉴设计。
   - Hyperbrowser HyperAgent（AGPL-3.0）：避免链接。
   - NetBird 服务端、Browserless（SSPL）：谨慎。
   - iroh（Apache-2.0/MIT）、Playwright MCP、Chrome DevTools MCP、browser-use（MIT）、steel-browser（Apache-2.0）：可用。
7. **测试**：打洞成功率实测（家宽、4G、公司网络）、relay 降级体验、Node 断线重连与事件补拉、批准 UI 的可理解性。

---

## 8. 待用户拍板的问题

1. **Hub 部署形态**：默认“桌面 App 内嵌 Hub（关机即离线）”，还是引导用户部署常开 Hub（VPS/家用机）？后者更契合定时/事件触发，但增加上手成本。
2. **是否强依赖自带穿透**：接受默认用 iroh（含 n0 公共 relay，开发期可用，生产需自托管/付费）？还是第一版只支持“用户已有 Tailscale/局域网/SSH 隧道”，更简单但门槛更高？
3. **浏览器接管真实 Chrome（B 档）** 是否进入第一版？它最有“wow”但风险最高（登录态、隐私、扩展商店审核周期）。
4. **云浏览器**：是否内置某一家默认（Browserbase 最全、Kernel 最便宜、Steel 可自托管），还是只提供“填 CDP URL”的通用适配？是否由产品方代付费用？
5. **默认审批强度**：Node 执行默认 `ask`（安全）还是像 OpenClaw 默认放行（顺滑）？建议前者，需要你确认体验取舍。
6. **移动端/Web 作为 Operator 还是 Node**：手机是否也要暴露能力（相机、通知、位置）？这决定是否需要 iOS/Android 原生 iroh 绑定（成熟度【未证实】）。
7. **离线队列语义**：Node 离线时，是否允许把任务排队等上线执行？涉及“过时指令误执行”的风险与 TTL 设置。
8. **多用户/团队**：是否需要超出“单人一个信任边界”的能力？如果需要，就不能照搬 OpenClaw 的单边界模型。
9. **编程 Agent 子智能体放在哪**：Claude Code/Codex 在 Hub 本机运行，还是允许在任意 Node 上运行（需要 `agent.spawn` capability 与工作区同步方案）？建议后者，与本课题拓扑一致，细节需与“子智能体/编程 agent”课题合并设计。

---

## 9. 来源清单

OpenClaw（官方文档，访问于 2026-11-06）
- Node pairing：<https://docs.openclaw.ai/gateway/pairing>
- Node pairing and status：<https://docs.openclaw.ai/nodes/pairing-and-status>
- Nodes：<https://docs.openclaw.ai/nodes/>
- Run a node host：<https://docs.openclaw.ai/nodes/node-host>
- Remote access：<https://docs.openclaw.ai/gateway/remote>
- Gateway protocol：<https://docs.openclaw.ai/gateway/protocol>
- Security / trust model：<https://docs.openclaw.ai/gateway/security>、<https://docs.openclaw.ai/gateway/security/trust-model>
- Browser：<https://docs.openclaw.ai/tools/browser>、<https://docs.openclaw.ai/tools/browser/remote>、<https://docs.openclaw.ai/gateway/security/browser-control>
- DeepWiki 源码问答：<https://deepwiki.com/search/where-in-the-source-code-are-n_45cd4e5e-40b3-4ea1-8635-5c12d41b68a8>

传输与网络
- iroh 1.0：<https://www.iroh.computer/blog/v1>（2026-06-15）；FAQ <https://docs.iroh.computer/about/faq>；API <https://docs.rs/iroh/latest/iroh/>；讨论 <https://github.com/n0-computer/iroh/discussions/4344>
- Mesh VPN 对比：<https://wz-it.com/en/blog/mesh-vpn-comparison-2026-overview/>（2026-08）、<https://tailscaleguide.com/posts/tailscale-vs-zerotier-vs-netbird-mesh-vpn-compared/>
- tsnet / Grants：<https://tailscale.com/docs/features/tsnet>、<https://tailscale.com/docs/reference/syntax/grants>
- iroh vs libp2p/WebRTC：<https://pinggy.io/blog/iroh_1_0_dial_keys_not_ips/>

浏览器
- Playwright MCP：<https://github.com/microsoft/playwright-mcp>、<https://playwright.dev/mcp/configuration/browser-extension>
- Chrome DevTools MCP：<https://github.com/ChromeDevTools/chrome-devtools-mcp>
- 浏览器 Agent 对比：<https://agentscamp.com/guides/comparisons/browser-agents-compared-2026>、<https://developertoolkit.ai/en/ecosystem/mcp/browser-automation/>、<https://chrome-use.leeguoo.com/en/compare.html>
- 云浏览器：<https://ecorpit.com/cloud-browsers-ai-agents-browserbase-steel-kernel-2026/>、<https://browser-use.com/cloud-browsers>、<https://www.notte.cc/compare/pricing>
- Claude in Chrome：<https://code.claude.com/docs/en/chrome>、<https://noemica.io/blog/reverse-engineered-claude-in-chrome>、<https://claude-code.genisisiq.com/03-tools-integrations-security/browser-automation-and-claude-in-chrome/>、<https://github.com/whg517/browser-bridge/blob/main/docs/architecture.md>
- Anthropic computer use：<https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool>

RustDesk
- 自托管文档：<https://rustdesk.com/docs/en/self-host/>
- rendezvous proto：<https://github.com/rustdesk/hbb_common/blob/main/protos/rendezvous.proto>
- hbbs 源码与 DeepWiki：<https://github.com/rustdesk/rustdesk-server/blob/master/src/rendezvous_server.rs>、<https://deepwiki.com/rustdesk/rustdesk/2.4-nat-traversal-and-relay>

本地亲读源码（`D:\code\xuqiu\repos\`）
- `iroh/iroh-relay/src/protos/relay.rs`、`iroh/iroh-relay/src/server.rs`（AccessControl，约 282–312 行）
- `iroh/iroh/src/protocol.rs`（Router/ProtocolHandler）、`iroh/iroh/src/endpoint/hooks.rs`（EndpointHooks）、`iroh/iroh/src/endpoint.rs`（Builder：secret_key、alpns、relay_mode、address_lookup、hooks）
- `iroh/iroh-base/src/key.rs`、`iroh/iroh-base/src/endpoint_addr.rs`、`iroh/TRANSPORTS.md`
- `browser-use/browser_use/browser/{session.py,events.py,profile.py}`、`browser/watchdogs/security_watchdog.py`、`browser/cloud/cloud.py`、`mcp/server.py`
- `rustdesk/src/{rendezvous_mediator.rs,client.rs}`、`rustdesk/src/server/{connection.rs,video_service.rs,input_service.rs}`、`rustdesk/src/trusted_devices/mod.rs`、`rustdesk/libs/{scrap,enigo}`

## 附：未证实/待验证清单

- iroh 在 iOS/Android 的绑定成熟度、移动端后台保活表现。
- Rust 生态 CDP 库（如 chromiumoxide 等）的成熟度，本次未调研。
- Chrome 136 起对默认 profile 禁用 remote-debugging 端口的具体行为（仅来自第三方对比页）。
- 各云浏览器的最新价格与 SOC2 状态（来自 2026-10 评测，落地前需核官网）。
- OpenClaw 源码文件路径（经 DeepWiki，仓库克隆完成后应复核）。
- browser-use `allowed_domains` 绕过漏洞的细节（二手）。
- CDP screencast 的带宽与延迟、经 iroh 推送的实际效果，需原型测试。
