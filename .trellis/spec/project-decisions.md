# 项目决策（Muster，个人 Agent 指挥台）

已与用户确认的约定。设计全文见 `docs/00-总览.md`、`docs/07-单人开发方案.md`、`design/mockups/README.md`。

## 已确认

- **人力**：单人开发，用 Claude Code / Codex 等编程 Agent 写代码（2026-11-06 确认）。
- **UI 风格**：按 `design/mockups/*.png` 的方向——Lovable / Meta Muse 式暖白底、柔和渐变、毛玻璃卡片、大圆角，珊瑚橙 `#FF6B4A` 主色、薰衣草紫 `#8B7CF6` 辅色；Bot 形象为带小芽天线的卵石小生物（Pip 主 Bot + 小码/阿克/小探/小文）（2026-11-06 用户认可“整体不错”）。
- **页面**：桌面 12 个页面/视图 + 手机 3 屏，清单以 `design/mockups/README.md` 为准；概念稿里各图导航不一致、个别错字，实现不照搬。
- **前端栈**：React + TypeScript + Tailwind + shadcn/ui，对话组件用 AI Elements / assistant-ui，分支树用 React Flow，动画用 Motion，图标用 Lucide；不手搓通用组件。
- **Agent 内核**：以 Pi 的 `@earendil-works/pi-durable`（MIT）为主线，第一周做验证原型（主 Bot 只有 `dispatch`、Codex app-server 子 Bot 能插话/打断/分支、cron 触发、kill 后能续跑）；跑不通则退回 DeepSeek Harness。**验证结果（2026-11-06，B8）**：steer、fork、关闭重开后恢复都已在 pi-durable 的 faux provider 上跑通（`packages/daemon/src/drivers/native/`，14 个测试）；**尚未用真实模型验证**。未配置 `MUSTER_NATIVE_MODEL`/`MUSTER_NATIVE_BASE_URL` 时内置 Bot 回退到脚本化引擎。
- **桌面壳**：Electron（ChatGPT / Codex / Claude 桌面端同款；pi-durable 是 Node 库，直接放进 Electron）。依据见 `.trellis/research/chatgpt-desktop-stack.md`；用户看完该调研后说“开干”，按此执行（2026-11-06）。
- **今日目标**（2026-11-06）：一个下午做出可演示的纵向切片，验收项与任务划分见 `docs/08-今日开发计划.md`。契约冻结位置：`packages/protocol`、`packages/daemon/src/core/contracts.ts`、`packages/ui`。monorepo 用 pnpm workspace（`apps/web`、`apps/desktop`、`packages/{protocol,ui,daemon}`）。
- **工程约定**：并行 Agent 安装依赖只用 `node scripts/pnpm-locked.mjs`；Electron 二进制需国内镜像 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`（GitHub 直连失败）；Windows 下 bash 的带引号 heredoc 不可靠，写文件用编辑器工具。
- **二期**（2026-11-06 用户要求）：UI 大整改（饱满、用满宽度、吉祥物持续动画、侧栏可收起、点 Logo 回主线）；模型由用户在界面配置，基于 pi-ai 原生 provider / CredentialStore 体系，key 存 `dataDir/credentials.json`、不下发客户端；子 Agent 除 Claude Code / Codex 外还要有**原生子 Agent**（用户自建，自定义人设 / 模型 / 工具，跑在 pi-durable 上）。计划与 UI 规范见 `docs/10-二期开发计划.md`。
- **UI v3（2026-11-06，取代二期 UI 方向）**：采用用户提供的设计师交接规范——安静克制：单一强调色 accent `#5976D9`、暖白 canvas `#FCFBF9`、无渐变/毛玻璃/光晕/厚阴影；成员色只在头像旁；Pip 动画低频可关闭；对话优先、不做 KPI 墙；**一切数字与状态来自真实数据**，后端没有的能力（资源库、记忆、暂停、技能发现、消息渠道）做诚实空态。改版要同时删除冗余代码。规范见 `docs/12-UI改版规范.md`，参考图 `design/reference/`。二期后端能力保留（基线提交 `64aad82`）。
- **UI v3 修订（2026-11-06 用户反馈）**：小图标与 Pip 吉祥物动效**保留**（取代 docs/12 中删除持续动画的要求；仍受“设置→通用→减少动态效果”与系统 prefers-reduced-motion 控制，不恢复渐变/光晕/毛玻璃/卡片上浮）；左侧栏、右侧上下文栏、列表/详情分栏**可拖拽调宽**（宽度持久化，双击复位，窄屏抽屉态不可拖）。
- **架构定稿（2026-11-06 用户确认“按推荐来”，全文 `docs/14-架构定稿.md`，取代 docs/13 提案）**：
  - 核心只有 4 个概念：Pip（管家）、成员、工单（含多个尝试 Attempt）、设备；**取消“分支”概念**，多方案 = 工单内多个尝试，对话 fork 降为“从这一步重来”。
  - Pip 不碰文件、不跑命令，只用 11 个工具：route / read / say / ask_user / ticket_note / ticket_retry / attempt_add / schedule / memory_search / memory_propose / web_search（只读）。默认安静，只在有结果、要你决定、做不下去时开口。
  - 成员统一模型（native / external）；Codex、Claude Code 必须装在并登录在运行它的设备上，提供按设备的激活流程；默认用它们自己的登录，“用 Muster 模型”为可选；继续直接调本机 CLI，不用 Claude Agent SDK；其它 agent 走 ACP 驱动。
  - 设备一期 SSH，二期 muster-node；记忆须用户确认才生效（用户明说“记住”除外）。
  - UI 按 docs/14 §6：对标 ChatGPT / Claude 网页版，无页面大标题、44px 头部、“此刻”右栏默认关闭（头部状态胶囊按需打开）、思考/工具/整轮过程默认折叠、审批停靠输入框上方、中文 15px/1.7/行长≤40 字；LobeHub 为社区许可，只借鉴思路不复制代码。
  - 落地顺序：UI 骨架 → 工单 + Pip harness → 成员激活 + 真工作区 → 多方案 + 采用即合并 → SSH 设备 → 记忆 → muster-node。

## 许可边界

- 产品代码不得复制 AGPL 项目的代码：`repos/Varin`、`repos/mini-trellis` 只看思路。可借鉴代码的来源（MIT/Apache）需在 NOTICE 注明。
- mini-trellis 只是开发期的记忆工具（`.trellis/`、`.claude/`、`.codex/` 中的生成文件），不进入产品发行物。

## 仓库约定

- `repos/` 是只读参考克隆，已 gitignore，不在里面构建或运行脚本。
- 绘图 API Key 只通过环境变量 `IMAGE_API_KEY` 传给 `scripts/gen_image.py`，不写入任何文件。
