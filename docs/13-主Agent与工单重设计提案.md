# 13 · 主 Agent / 工单 / 记忆 / 多设备 重设计（提案，待拍板）

状态：**已被 `docs/14-架构定稿.md` 取代**，仅作历史参考。依据：
- `.trellis/research/deepseek-super-agent.md`（DeepSeek Harness 团队 2026-10-31《Super-agent 设计探索》+ MIT 原型 `deepseek-ai/dsh-superagent-prototype`）
- `.trellis/research/current-capability-audit.md`（现有代码能力核对，带 file:line）
- `.trellis/research/multi-device-remote.md`（多设备 / SSH 方案调研）

---

## 0. 先对齐一个事实

DeepSeek 的观点**不是**“主 Agent 要更强”，而是：**瓶颈是人的注意力，不是模型能力**。他们的主 Agent（Router）刻意很薄——不读代码、不写计划、甚至不需要 Bash；真正干活的是带全套工具的 worker。

但“薄”≠“只会路由”。对照之下，Muster 的 Pip 薄错了地方：

| 能力 | Super Agent Router | Muster Pip 现状 |
|---|---|---|
| 接单并转述 | ✅ 原话转交 + ≤30 字备注 | ✅ dispatch |
| 判断“这是新事还是旧事的追加” | ✅ 挂到已有工单 / 停止 / 忽略，一次最多 20 个决定 | ❌ 每次都新建任务 |
| 把用户追问转给正在干活的 worker | ✅ | ❌ 不能 steer 子任务 |
| 全局状态 / 全局记忆 | ✅ Router 就是全局记忆 | ❌ 只看主线最近 10 行 |
| 汇报 | ✅ 只在有结果、要决定、做不下去时开口 | ⚠️ 模板拼接（测试数、改动文件、最后一行） |
| 向人提问 | ✅ 一次只问一个结构化问题 | ❌ 无 ask_user |
| 主动性 | ✅ off / observe（默认，只记录“本来会做什么”）/ auto | ⚠️ 只有触发器 |

**结论**：Pip 不去读目录、跑命令（这点跟 Super Agent 一致，也是安全边界），但要从“路由器”升级为**“管家”：管工单、管状态、管记忆、管打扰**。

---

## 1. 主 Agent Pip：从路由器到管家

### 1.1 Pip 的工具（建议）
| 工具 | 作用 | 备注 |
|---|---|---|
| `ticket.create` | 新建工单（原话 + 简短备注 + 指派成员 + 设备/目录） | 取代现在的 dispatch |
| `ticket.attach` | 用户这句话属于已有工单 → 追加给该工单的 worker（steer/queue） | 解决“每句话都开新任务” |
| `ticket.stop` / `ticket.ignore` | 停止 / 不处理 | 一次回合可批量决定 |
| `status.read` | 查工单、成员、设备、日程的真实状态 | “小码那个做完没？”Pip 自己答 |
| `ask_user` | 结构化单问题（选项 + 默认值） | 一次只问一个 |
| `report.summarize` | worker 结束后用模型写 2–3 句人话汇报 + 证据链接 | 替代模板 |
| `memory.search` / `memory.propose` | 查记忆 / 提议新记忆（需你确认） | 见 §3 |
| `schedule.create` | 自然语言建日程（“每天 9 点看下 PR”） | 复用现有 triggers |
| `web.search`（可选） | 回答简单事实问题不必派单 | **待拍板**：Super Agent 不给 Router 这个，我们可以给只读版 |

**不给 Pip**：读写文件、Bash、改代码——这些永远交给成员。

### 1.2 打扰预算（照搬 Super Agent 的第一原则）
- 接单时确认一次，然后静默；只在 **有结果 / 需要你决定 / 做不下去** 时开口。
- 多个工单同时完成 → 合并成一条汇报。
- 主动模式三档：关 / 观察（默认，只在“此刻”栏记录“我本来会做 X”）/ 自动。

---

## 2. “分支”改为“工单 + 多方案”

### 2.1 现在的分支是什么（实话）
就是**对话检查点 fork**（Claude `--fork-session`、Codex `thread/fork`）。“采用”只是打个 `adopted` 标记，**不合并任何代码**；worktree 代码写了但从来没跑过，任务都在空目录 `~/.muster/workspaces/<taskId>` 里。你的判断对：没什么用。

### 2.2 改成什么
**工单（Ticket）** 作为核心对象（取自 Super Agent）：
- 授权范围（谁要的、能动哪个仓库/设备、审批策略）
- 订阅：相关 PR 评论、CI 结果、你的追问 → 自动送到这张工单的 worker
- 独立工作区：**真实仓库的 git worktree**（不是空目录）
- 可替换的会话：重试 = 换会话，工单不变
- 状态机：排队 / 进行中 / 空闲 / 等你回答 / 等你审阅 / 卡住 / 失败 / 完成

**多方案（我们自己的扩展，Super Agent 没有）**：同一张工单可以开 2–3 个“方案”并行：
- 每个方案 = 独立 worktree + 一个成员（例：小码用 Codex 做 A，阿克用 Claude 做 B）
- 跑完自动验证（测试 / 类型检查 / 你指定的命令）
- Pip 给出对比：改动量、测试结果、各自一句话思路
- **采用 = 把该方案的 worktree 真正合并回你的分支**（或开 PR），其余方案清理

“分支页”改为工单详情里的“方案”页签；对话检查点 fork 保留为高级操作“从这一步重来”，不再单独成页。

---

## 3. 记忆：怎么产生

现状：完全没做，页面是空态。Super Agent 也没有解决长期记忆，只给了两个可借鉴的原则：最少上下文 + 指针（Inline & Spill）、对象都有 ID 可逐跳回溯（Chain of Recall）。

建议方案：
1. **来源**
   - 你明说“记住……” → 直接写入。
   - 工单完成时 Pip 提取候选（偏好、项目约定、设备信息、常用命令）→ **待确认**。
   - 成员 worker 可以 `memory.propose`，同样待确认。
2. **确认**：主线里一条轻提示“我想记住：xxx · 保存 / 不要”，记忆页有待确认队列；不确认的不生效。
3. **存储**：`~/.muster/mind/` 下的 Markdown 文件（人 / 项目 / 设备 / 偏好），git 版本化，可回滚；规则与技能只在你要求时改，存为不可变版本。
4. **使用**：Pip 派单时检索相关记忆，在工单说明里只放摘要 + 指针，worker 需要时再展开。

---

## 4. Codex / Claude Code 成员：你问的两个问题

**Q：是不是对应设备上必须装了它们才能用？** 是。必须在**运行它的那台机器**上安装并登录 `codex` / `claude` CLI。现在只能跑在 musterd 所在的本机；检测只跑 `--version`，不检查登录。

**Q：我们会把模型注入进去吗？** 现在**不会**，它们用各自的登录和模型；orchestrator 也没把模型参数传下去。

建议：
- 默认：沿用它们自己的登录（订阅额度最划算）。
- 可选“用 Muster 配的模型”：Claude Code 通过环境变量（`ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_MODEL`）接 Anthropic 兼容端点；Codex 通过 `-c model_provider=…` 并用独立 `CODEX_HOME` 隔离，不污染你自己的配置。**需真机验证各 provider 兼容性。**
- 检测升级为“已安装 / 已登录 / 版本”，每台设备分别显示。

---

## 5. 多设备与远程 SSH

现状：设备只是展示记录；只有一个写死的“本机”；配对码是随机数，不校验；daemon 只监听 127.0.0.1。

分两期：
- **A 期：免安装 SSH（约 1–2 周，推荐先做）**。Codex 桌面版、Claude Desktop、Zed 都这么做。
  - 设备 = `~/.ssh/config` 里的主机（支持 ssh-agent、ProxyJump、Tailscale SSH）
  - Codex：`ssh -T host -- codex app-server`，现有 JSON-RPC 驱动不变
  - Claude：spawn 改成 ssh；登录用 `claude setup-token` 生成的令牌，每次以 `CLAUDE_CODE_OAUTH_TOKEN` 传入，不落盘
  - 原生成员：加 Executor 层（本地 / SSH，用 MIT 的 `ssh2` 做 exec + sftp），远端什么都不用装
  - 工单带 `deviceId + cwd`；设备页显示每台机器的 CLI 安装/登录情况
  - 限制：Windows 远端需开 OpenSSH Server；SSH 断线会中断当前回合，按会话 ID 续跑
- **B 期：`muster-node` 小守护进程（3–6 周）**：每台设备主动连回主 daemon（WebSocket），配对码 + 设备密钥 + 你批准；解决 NAT、无 sshd 的 Windows、断线不丢任务、屏幕/浏览器能力。参考 OpenClaw nodes、Happy（均 MIT）。
- 网络层：推荐 Tailscale，不自己做穿透。
- 许可：Coder / Teleport / claudecodeui 是 AGPL，只看思路不抄代码。

---

## 6. 本轮已经改了的（你提的界面问题）
- 小图标与 Pip 动效已恢复（呼吸、眨眼、思考点点、工作摇摆、完成小跳、等你确认的“!”、导航图标悬停/选中动效、进行中状态点脉冲）；“减少动态效果”开关与系统设置仍然生效。
- 左侧栏、主线“此刻”栏、工作台右栏、设备列表都可以拖拽调宽，双击复位，宽度会记住。

---

## 7. 建议顺序与需要你拍板的点

建议顺序：**① 工单模型 + Pip 管家化（1.5–2 周）→ ② 多方案 + 真 worktree + 采用即合并（1 周）→ ③ SSH 多设备 A 期（1–2 周）→ ④ 记忆（1 周）→ ⑤ muster-node B 期**

待拍板：
1. Pip 坚持“不读文件、不跑命令”，只做管家？（建议：是）
2. Pip 是否给只读 `web.search`？
3. “分支”改为“工单 + 多方案”，原对话 fork 降为“从这一步重来”？
4. Codex/Claude 默认用自己的登录，“注入 Muster 模型”做成可选项？
5. 多设备先做 SSH（A 期），再做 muster-node？
6. 记忆必须经你确认才生效？
7. 先做哪一块？
