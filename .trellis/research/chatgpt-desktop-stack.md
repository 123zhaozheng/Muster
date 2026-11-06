# ChatGPT 桌面端的壳与技术栈（2026-11-06 调研）

OpenAI 闭源，以下均为第三方对安装包的拆解，不是官方说明。

## 结论
- **新版 ChatGPT 桌面端（Chat + Work + Codex 三合一）是 Electron 应用**，不是 Tauri，也不是原生。bundle id 为 `com.openai.codex`，Windows 包名 `OpenAI.Codex`，显示名 ChatGPT。
- 壳是 **OpenAI 定制的 Chromium/Electron**（内部叫 "Owl" / "Codex Framework"），带 `app.asar`（约 567 MB）、Sparkle 自动更新（macOS）。
- **旧的原生 Swift macOS 版已被取代**，现称 ChatGPT Classic，**2027-01-30 退役**（9to5Mac 2026-11-02）。网上不少文章（如 2026-05 的 codenote 审计）仍写"Mac 版原生 Swift，只有 Windows 是 Electron"，已过时。
- Codex 团队公开说选 Electron 是为了一套代码覆盖 macOS / Windows / Linux，并与 VS Code 扩展共享代码（HN、X）。

## 架构分层
| 层 | 技术 |
|---|---|
| 壳 | 定制 Electron（Chromium 155 系），main 进程管窗口、菜单、更新、进程监督 |
| 前端 | React 19、React Router 7、Radix UI、Tailwind 4、Framer Motion、cmdk、Lucide、dnd-kit |
| 状态 | Redux Toolkit / Jotai / Zustand 并存、TanStack Query / Form / Table |
| 编辑与终端 | CodeMirror 6、Shiki、xterm.js + node-pty、`@pierre/diffs` |
| 本地存储 | better-sqlite3；Yjs 做文档同步 |
| Agent 后端 | **Rust 的 `codex app-server` 作为随包二进制**，Electron main 通过 **stdio JSON-RPC** 与它通信；渲染进程经 preload 的 `electronBridge` → IPC → main 转发 |
| 其他 | Windows 另带 sandbox service、command runner；macOS 另带 Computer Use 服务（`cua_node`） |

## 对本项目的含义
- Electron + React/Radix/Tailwind/Lucide/Motion 与我们已选的前端栈基本一致，印证"不用手搓"的方向。
- "Electron 壳 + 独立 agent 后端进程 + stdio JSON-RPC"正是我们想要的形状。pi-durable 是 Node 库，放进 Electron 的 main 或 utilityProcess 即可，不必像 Tauri 那样再打包 Node sidecar。
- 代价：安装包大（ChatGPT Windows 版约 260–284 MB）。

## 来源
- https://9to5mac.com/2026/11/02/openai-is-retiring-chatgpt-classic-app-will-soon-combine-chat-and-work-tabs-in-new-app/
- https://seanthegeek.net/doubleagent/research/chatgpt-desktop.html （真机安装拆解，2026-10）
- https://www.kitze.io/posts/codex-electron-app-technical-breakdown
- https://github.com/seanthegeek/doubleagent/issues/121
- GreatFrontEnd / Yangshun Tay 对应用内"开源许可"清单的整理（LinkedIn，2026-07-13）
- 已有对照：`docs/research/07-crossplatform-stack-protocols.md` §3.1 记录 Codex app 为 Electron + Rust app-server

## 未证实
- "Owl" 壳具体改了 Electron 的哪些部分，所有来源都说不清。
- 几个状态库并存是否都在主 UI 中使用，原整理者也不确定。
