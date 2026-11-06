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

## 许可边界

- 产品代码不得复制 AGPL 项目的代码：`repos/Varin`、`repos/mini-trellis` 只看思路。可借鉴代码的来源（MIT/Apache）需在 NOTICE 注明。
- mini-trellis 只是开发期的记忆工具（`.trellis/`、`.claude/`、`.codex/` 中的生成文件），不进入产品发行物。

## 仓库约定

- `repos/` 是只读参考克隆，已 gitignore，不在里面构建或运行脚本。
- 绘图 API Key 只通过环境变量 `IMAGE_API_KEY` 传给 `scripts/gen_image.py`，不写入任何文件。
