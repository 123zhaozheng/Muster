# LobeHub UI 调研 → Muster 界面优化建议

> 调研日期：2026-11-06
> 对象：`lobehub/lobehub`（原 `lobehub/lobe-chat`，GitHub 已重定向，两个地址 HEAD 相同：`fb7dfa2`，2026-11-06 提交，package `@lobehub/lobehub@2.3.1`，UI 库 `@lobehub/ui@^6.12`）
> 方式：`git clone --depth 1` 到沙箱只读阅读，**未运行任何脚本、未安装依赖、未构建**。
> 下文路径都是 LobeHub 仓库内的相对路径。

---

## 0. 结论速览

- **许可证**：不是纯 Apache-2.0，而是 **"LobeHub Community License"**（Apache-2.0 + 附加条款）。**Muster 只借鉴思路和交互，不复制代码、样式和文案。**
- **最值得学的 5 点**：
  1. 页头只有一行 44px，左边放会话标题（14px/600），右边放几个 28px 图标按钮。没有大号页面标题。
  2. 右侧工作面板**默认关闭**（`showRightPanel: false`），在页头点一下图标才打开。打开后宽 360px，可以拖动调宽。
  3. 一轮回答里的"过程"（思考、工具调用、中间叙述）**运行中展开，完成后自动折叠成一行**："共运行 N 步 (3m 37s) ›"，最终答案始终显示。
  4. 思考块：运行时显示"深度思考中…"（带闪光文字）并展开；结束后折叠成"已深度思考（用时 X 秒）"。展开后内容最高 `min(40vh, 320px)`，可以滚动，文字用次要色。
  5. 工具调用：折叠时是一行"动作 + 关键词"加状态图标和耗时。展开后显示参数和结果；如果有自定义渲染，可以在自定义渲染和原始 JSON 之间切换。需要审批时自动展开，审批条放在输入框上方。

---

## 1. 仓库与许可证

### 1.1 仓库
- 当前名称是 `lobehub/lobehub`，旧名 `lobehub/lobe-chat` 仍能访问（重定向），两者 `git ls-remote` 结果一致。
- 主体是 Vite SPA，路由在 `src/routes`，功能模块在 `src/features`，Electron 端在 `apps/desktop`，共享包在 `packages/*`。
- 根目录有 `DESIGN.md` 和 `DESIGN.dark.md`，是官方写给 AI/开发者看的设计规范，信息密度很高，推荐通读。

### 1.2 LICENSE 原文要点（`LICENSE`）
```
LobeHub Community License
From 1.0, LobeChat is licensed under the LobeHub Community License, based on Apache License 2.0
with the following additional conditions:
1. a. LobeChat may be utilized commercially ... without modifying the source code.
   b. a commercial license must be obtained from the producer if you want to develop and
      distribute a derivative work based on LobeChat.
2. (contributor terms) ... producer can adjust the license ...
Apart from the specific conditions mentioned above, all other rights and restrictions follow the Apache License 2.0.
```

### 1.3 对 Muster 的判定
| 事项 | 能否 | 说明 |
|---|---|---|
| 阅读源码、学习交互和布局思路 | ✅ | 思路、交互模式、信息架构不受著作权保护 |
| 参考通用设计数值（4px 间距体系、8/12px 圆角、14px 正文、44px 页头等） | ✅ | 属于行业通用事实性参数，Muster 用自己的 token 重新表达 |
| 复制 `.tsx/.ts` 组件、样式代码或 hooks 到 Muster | ❌ | 会构成"基于 LobeChat 的衍生作品"，分发需要商业授权；附加条款还允许他们随时收紧许可 |
| 复制 `locales/*` 文案、`DESIGN.md` 原文 | ❌ | 同上。可以用自己的话写类似的规范 |
| 使用其 logo、图标资源、品牌名 | ❌ | Apache-2.0 第 6 条本身不授予商标权 |
| 引入 `@lobehub/ui` npm 包 | ⚠️ 暂不 | 它是单独的仓库和许可证，本次未核实；而且会带入 antd 和 antd-style 体系，跟 Muster 的 Tailwind v4 + `packages/ui` 冲突，不建议引入 |

**结论：只借鉴思路，不借鉴代码。** 这条规则同样适用于其他 AGPL 或限制性许可证的项目。下文建议全部是用自己的话描述的交互规格，由 Muster 用自己的组件实现。

---

## 2. 整体布局

文件：`src/routes/(main)/_layout/index.desktop.tsx`、`src/features/NavPanel/*`、`src/features/NavRail/*`、`src/features/Conversation/Workspace/index.tsx`、`src/store/global/initialState.ts`

```
┌ TitleBar 38px（Electron，含 Tab 栏） ─────────────────────────────────────────┐
│ NavPanel 280px │ 会话列 (flex)                      │ Portal │ WorkingSidebar │
│ (240–400 可拖) │ ┌ 页头 44px（宽屏时浮在内容上方） ┐ │ 400px  │ 360px          │
│ 侧栏：Agent    │ │ 消息流（阅读列 ≤960px 居中）    │ │ 按需   │ 默认关闭       │
│ + 话题列表     │ └ 输入框（审批条/Todo 进度贴在上方）┘ │        │                │
│                │ ChatTerminal（底部抽屉，默认关闭）               │                │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **左侧**：`NavPanel` 默认 280px，可在 240–400px 间拖动（`NAV_PANEL_MIN/MAX_WIDTH`，`src/store/global/selectors/systemStatus.ts`），可以完全收起，收起动画 0.2s。实验中的 `im_layout` 还会在最左加一条图标 rail（`src/features/NavRail`），点 rail 切换面板内容。
- **Agent 侧栏**（`src/features/AgentSidebar/Body.tsx`）：顶部是 Agent 切换器，下方是可折叠的"话题"分组（Accordion）。每个 Agent 单独记住分组的折叠状态。
- **中间**：`ConversationWorkspace` 组合了"页头 + 消息 + Portal + 工作侧栏 + 底部终端"。消息阅读列宽 `min(960px, 100%)`，左右内边距 16px（`src/features/WideScreenContainer/index.tsx`，`CONVERSATION_MIN_WIDTH = 960`）。
- **右侧有两层，都按需打开**：
  - **Portal**（`src/routes/(main)/agent/features/Portal`，`src/features/Portal/portalWidth.ts`）：点击消息里的任务、工具 UI、文件、Artifact 时打开的详情面板。默认 400px；任务和工具类不小于 600px，报告类 840px，最大 1280px。**每种视图各自记住宽度**。
  - **WorkingSidebar**（`src/features/Conversation/WorkingSidebar`）：工作面板，是带 Tab 的工作区（概览、文件、浏览器、Canvas、PR、Review）。**默认关闭**（`showRightPanel: false`），宽 360px，可在 300–1200 间拖动。另有一个 340px 的"概览"（Overview）浮层，单独开关。
  - 联动规则：打开 Portal 时**自动收起左栏**，关闭后恢复（`agent/_layout/PortalAutoCollapse.tsx`）。会话列至少保留 420px（`CONVERSATION_KEEP_WIDTH`），放不下时工作侧栏先让位（`fitsBesidePortal.ts`）。
- **底部**：`ChatTerminal` 是可开关的终端抽屉，默认 320px 高，默认关闭。

## 3. 页头（Chat Header）

文件：`src/routes/(main)/agent/features/Conversation/Header/index.tsx`、`Header/Tags/index.tsx`、`src/features/NavHeader/index.tsx`、`packages/const/src/layoutTokens.ts`

- 页头高 **44px**，内边距 8px。
- **左侧**：会话（话题）标题，**14px、字重 600**，单行省略。进入子线程时显示"话题 / 线程"面包屑，父级用次要色。旁边是一个"…"菜单。**没有大号页面标题，也没有 Agent 简介。**
- **右侧**：一排 28px 图标按钮（图标 16px，`DESKTOP_HEADER_ICON_SMALL_SIZE`）：在 IDE 打开（仅当设置了工作目录）、终端开关、评论、分享、概览开关、"打开工作面板"（仅在面板关闭时显示）。
- **宽屏浮动**：容器宽度 ≥1200px 时，页头变成透明的绝对定位层（借鉴 Codex 的做法）。左边标题变成一颗 ≤220px 的小药丸，右边按钮组单独有底色，中间可以点穿到消息流。窄屏时是普通实色栏，底部有 1px 分隔线。
- 群聊会话时，左侧只显示"成员数"标签。

## 4. 消息渲染

文件：`src/features/Conversation/ChatItem/ChatItem.tsx`、`ChatItem/style.ts`、`ChatItem/components/MessageContent/index.tsx`、`Messages/User/index.tsx`、`Messages/AssistantGroup/*`

- **用户消息**：靠右，气泡样式，背景 `colorFillTertiary`（约 3% 黑）、圆角 12px、内边距 8×12，左侧留 36px 空白。**个人模式下不显示用户头像和名字**（只有多人工作区、机器人来源、Agent 互发时才显示）。超过 30,000 字符时改为短预览（`longMessage.ts`）。
- **助手消息**：靠左，**没有气泡**，正文直接铺满阅读列。头部是方形头像（约 24–28px）和名字。
- **悬停才显示的元素**：时间戳和操作栏（`role=menubar`）默认 `opacity: 0`，悬停或菜单打开时淡入（200ms）。所以静止状态的消息流里只有内容本身。
- 消息上下间距 8px，各元素间 gap 8px。
- 操作栏（`Messages/components/MessageActionBar`）按插槽配置，常用的几个直接露出，其余收进"…"。
- "跳转到某条消息"时，用一次 1.4s 的主色淡底高亮代替滚动箭头。

## 5. 思考（Reasoning）显示

文件：`src/features/Conversation/components/Thinking/{index,Title,StatusIndicator}.tsx`、`Messages/components/Reasoning.tsx`；文案见 `locales/zh-CN/components.json`

- 用 Accordion 实现，标题区内边距 4px，指示箭头紧跟在标题文字后面。
- **流式中**：自动展开，标题为"深度思考中…"，用 shiny 闪光文字效果。内容区自动滚到底部，用户往上滚时暂停自动滚动（阈值 120px）。
- **结束后**：自动折叠，标题变为"已深度思考（用时 12.3 秒）"，用次要色。
- 展开后的内容区：**最大高度 `min(40vh, 320px)`**，内部滚动，边缘有渐隐遮罩。文字用 `colorTextDescription`（比正文浅），以 Markdown 渲染。
- 只有签名、没有实际内容的 reasoning 不渲染（`hasRenderableReasoning`），避免出现空卡片。

## 6. 工具调用 & 整轮过程折叠

文件：`Messages/AssistantGroup/components/WorkflowCollapse.tsx`、`ProcessFold.tsx`、`AssistantGroup/Tool/index.tsx`、`Tool/Inspector/*`、`Tool/useToolExpandState.ts`、`AssistantGroup/constants.ts`、`toolDisplayNames.ts`

**两级折叠：**

1. **ProcessFold（整轮）**：一轮结束后，把这一轮的"过程"（思考 + 工具 + 中间叙述）折叠成**一行纯文字**："共运行 N 步 (3m 37s) ›"。颜色为 tertiary，悬停时变为正文色，下方有一条分隔线。**最终答案在折叠行下方，始终显示。** 折叠状态只存在于视图中，不持久化。
2. **WorkflowCollapse（一段连续的工具调用）**：
   - 左侧是 24px 描边小方块状态位：运行中显示网络型 Spin，等待审批显示蓝色手形，完成显示勾，失败显示叉。
   - 运行中**默认全展开**。标题是**一句动态标题**，按优先级取：正在思考的标题 → 当前工具的"动作 + 参数关键词" → 已经成句的叙述（句末 280ms 提交，未成句 680ms 提交，标题防抖 320ms，最长 100 字）。运行超过 2.1s 后才显示计时。
   - 完成后**自动折叠为摘要行**："共 N 次调用 · M 次失败 · 用时"。如果用户手动展开过，就不再自动折叠。
   - 有待审批项时**强制展开**，不能收起。
3. **单个工具卡**（`Tool/index.tsx`）：
   - 折叠时是一行：`状态图标 + "动作 关键词"（如 "读取 src/app.ts"）+ 执行计时`。工具 API 名映射为人话（`TOOL_API_DISPLAY_NAMES`，Codex 的 `command_execution`、`file_change` 等也有映射）。
   - 展开后显示参数和结果。如果有自定义渲染器，默认用它，并提供"切回原始参数/结果"的开关，另有 Debug 视图（原始 JSON）。
   - 工具清单可以声明 `collapsed / expand / alwaysExpand`；需要审批或 MCP App 的卡片自动展开（延迟 100ms，避免闪烁）。
   - 参数仍在流式输出时，显示专门的 streaming 渲染。
4. **审批（Intervention）**：待审批的工具调用不放在消息流里打断阅读，而是**贴在输入框上方**做成审批条（`src/features/Conversation/InterventionBar`）。多个审批以 Tab 形式排列，支持"全部批准"。全局还有一个跨会话的审批通知（`src/features/GlobalApprovalNotification`）。

## 7. 委派任务 / 子 Agent 渲染

文件：`Messages/Task/*`、`Messages/GroupTasks/*`、`GroupTasks/TaskItem/{ServerTaskItem,TaskTitle}.tsx`

- 一条消息派发多个任务时（GroupTasks），头像位置显示**成员头像组合**（28px），右上角加一个 16px 的 ListTodo 小徽标。
- 每个任务是一个 Accordion 行：`24px 状态方块（Spin / 绿勾 / 红叉）+ 执行成员头像 + 任务标题 + 指标（耗时 · LLM 调用次数 · 工具调用次数，运行中显示实时计时）`。**默认折叠**。展开后是一个描边 Block（内边距 12），显示子任务的消息流，内容只在展开时才挂载。
- 单任务消息（Task）：标题后带"子任务"Tag，正文是状态内容。点击可在 Portal 打开 `TaskDetail`（≥600px）。

## 8. Agent / 成员定义

### 8.1 字段（`packages/types/src/agent/item.ts`、`agencyConfig.ts`、`heterogeneousAgent.ts`）
- **身份**：`title`、`description`、`avatar`、`backgroundColor`、`tags`。
- **大脑**：`model`、`provider`、`params`（温度等）、推理强度。
- **人设**：`systemRole`（系统提示词）、`fewShots`。
- **能力**：`plugins`（工具/MCP/技能）、`knowledgeBases`、`files`。
- **开场**：`openingMessage`、`openingQuestions`（最多显示 5 个）。
- **会话配置**：`chatConfig`（历史条数、自动话题等）。
- **外部 Agent**：`agencyConfig.heterogeneousProvider`。`type` 支持 claude-code / codex / amp / cursor / opencode / kimi-code 等十余种 CLI，配置项有 `command`、`args`、`env`、`model`、`effort`（推理强度）、`speed`（仅 Codex）、`authMode`（订阅或 API）、`systemContext`（每次提示前附加的固定上下文）。另有 `executionTarget`（本机 / 设备 / 云端沙箱）和 `boundDeviceId`。每种 CLI 的描述符包含安装命令、登录命令、认证失败的错误匹配模式，以及是否支持 resume。
- **群组**（`packages/types/src/agentGroup/index.ts`）：群组本身有 `title`、`description`、`avatar`、`systemPrompt`、`openingMessage/Questions`、`allowDM`、`revealDM`；成员关系 `ChatGroupAgent` 有 `agentId`、`role`、`order`、`enabled`。

### 8.2 资料页 UI（`src/routes/(main)/agent/profile/features/ProfileEditor/index.tsx`）
- 页面从上到下：
  1. **头部**：头像、名称、描述，点击即可就地编辑（`AgentHeader`）。
  2. **"运行配置"卡**：padding 24、圆角 12、1px 浅边框、`colorFillQuaternary` 底色。卡内一行放模型选择按钮和推理强度，下面是工具列表（`AgentTool`）。
  3. **系统提示词**：一整块文档式编辑器（`EditorCanvas`），像写文档一样编辑，不是一个小 textarea。
- **外部 CLI Agent 不显示提示词编辑器**。因为 CLI 有自己的系统提示，LobeHub 不在界面上放一个"看起来能改但实际无效"的控件。取而代之的是"在哪运行（本机/设备/云端）"选择卡和 CLI 状态卡（命令、是否安装、登录状态、认证方式）。
- 不常用的设置（开场白、分类、渠道、Connector、Graph Runtime）放在 `src/features/AgentSetting/*` 的设置弹窗或标签页里，不铺在主页面上。

## 9. 市场（Agent / MCP / 技能）

文件：`src/routes/(main)/community/(list)/mcp/features/List/{index,Item}.tsx`、`(detail)/mcp/*`
- 列表用 `Grid`（默认 3 列）卡片：标题 16px/500（悬停变链接色）、作者用描述色、简介用次要色并截断、底部一行 12px 元信息加连接类型 Tag（stdio/http）。
- 详情页左边是正文（README、版本、相关推荐），右边是侧栏（安装按钮、目录 TOC、相关）。

## 10. 设置

文件：`src/routes/(main)/[workspaceSlug]/settings/*`、`src/features/Setting/SettingContainer.tsx`、`packages/const/src/layoutTokens.ts`
- 左侧导航复用 NavPanel（通用、外观、Provider、快捷键、设备、环境、技能、Connector 等），右侧内容区**居中，最大宽 1024px**，分组之间间距 36px。
- 表单项最小宽 `max(34%, 240px)`，标签和控件左右排列；窄屏时自动换成上下排列。

## 11. 空状态

文件：`src/features/AgentHome/{index,AgentInfo,OpeningQuestions}.tsx`
- 内容**靠下**，贴着输入框上方（上面用 flex:1 撑开），而不是在屏幕正中堆一大块。
- 从上到下：64px 方形头像 → 24px 粗体名称 → 开场白 Markdown（最大 640px 宽）→ 最多 5 个**药丸形建议问题**（圆角 48px，内边距 8×16，filled 底色，点击后填入输入框而不是直接发送）。
- 加载中显示同样结构的骨架屏（头像 64、标题 32 高、两行文字）。

## 12. 输入框

文件：`src/routes/(main)/agent/features/Conversation/MainChatInput/index.tsx`、`src/features/ChatInput/ActionBar/*`、`ControlBar/*`
- **左侧**只有两个按钮："+"和语音。"+"是一个菜单，把上传、工具、知识库、参数、附件、设目标等**全部收起来**，计数用小角标显示。
- **右侧**：模型 chip、上下文窗口用量、发送按钮。
- 输入框下方的 ControlBar 放运行环境相关的 chip：工作目录、分支/worktree、设备、审批模式（`ApprovalMode.tsx`）。都是小号 chip，点击弹出 popover。
- 输入框上方依次是：审批条、Todo 进度（`TodoProgress`）。

## 13. 设计 Token（`DESIGN.md`）

| 类别 | 值 |
|---|---|
| 间距 | 4 / 8 / 12 / 16 / 20 / 24 / 32（4px 体系）。组内 8，组间 16，区块间 24–32；卡片内边距 16–24。不允许 6/10/13 这类非体系值 |
| 字号 | 12（说明/元信息）/ **14（正文默认）** / 16（强调）/ 20；标题 38/30/24/20/16；**没有 13px**；行高约 1.57 |
| 字体 | Geist / Geist Mono；中文回退依次为 PingFang SC、Microsoft YaHei UI |
| 圆角 | 4（Tag）/ 6（输入框、小控件）/ 8（按钮、卡片，默认值）/ 12（菜单、弹窗、大面板）；圆形只用于药丸、头像、圆形图标按钮 |
| 控件高 | 28 / **36** / 40 |
| 颜色 | **主色默认是单色**（浅色主题近黑 #222，深色主题近白），只在用户自选主题色时才有色相。文本分 4 级：#080808 / #666 / #999 / #bbb。悬停填充 3% 黑，激活填充 1.5% 黑。边框 #eee（次级分隔）/ #e3e3e3 |
| 阴影 | 卡片基本不用阴影（用 1px 边框）；popover 用 `0 8px 16px -4px rgba(0,0,0,.2)`；弹窗用最强一级 |
| 动效 | 状态切换和 popover 100–200ms，遮罩和弹窗约 300ms；遵守 `prefers-reduced-motion` |
| 文案 | 一句主文案 + 可选的第二行补充；动词 + 名词（"创建 Agent"），不用裸"确定"；进行中统一写成"正在…"；同一概念只用一个词（不在 bot、助手、Agent 之间混用） |

## 14. 密度控制手法（怎么避免满屏文字）

1. **默认折叠，展开一步到位**：完成的过程、思考、工具、子任务全部折成一行；一次点击直接展开到完整内容（WorkflowCollapse 注释："nothing is two hops deep"）。
2. **悬停才显示**：时间、操作栏、行内操作按钮。
3. **用文字层级代替颜色**：信息重要性靠 4 级文本色区分，主色只留给唯一的主操作。
4. **用一句话概括状态**：工具调用折叠时只写一句"动作 + 关键词"；摘要行只放数字（N 步、M 次失败、耗时）。
5. **面板按需出现**：右侧工作面板、Portal、终端都默认关闭，由页头图标或消息内链接打开；打开 Portal 时自动给中间让出空间（收起左栏）。
6. **区块标题极小**：Overview 区块标题 10.5px/600/tertiary，行高最小 32px，值 13px，单行省略，右侧放数字（tabular-nums），整行可点击打开对应 Tab（`WorkingSidebar/Overview/{OverviewRow,sectionStyles}.ts`）。

## 15. 桌面端（Electron）特性
- 自绘 TitleBar 高 38px（`packages/desktop-bridge/src/index.ts: TITLE_BAR_HEIGHT`），内含多标签页 TabHost，可以同时开多个会话。
- 链接悬停时在底部显示状态条，缩放时显示 HUD，提供系统托盘和截图浮层、全局快捷键面板（`HotkeyHelperPanel`）、Cmd+K 命令面板（`CmdkLazy`）。
- 外部 CLI Agent 重启后自动恢复（`HeteroRestartRecovery`）。页头有"在 IDE 打开工作目录"按钮。

## 16. 响应式
- `src/routes/(mobile)` 和 `.mobile.tsx`/`.desktop.tsx` 双实现。移动端页头 44px、图标 36/22，底部 TabBar 48px，左栏变成抽屉，Portal 变为全屏。
- 桌面端靠 **container query** 而不是视口宽度判断：会话列 ≥1200px 时页头才浮动，工作侧栏根据剩余宽度决定是否让位。

---

## 17. 给 Muster 的具体建议

> 以下全部遵守 Muster UI v3 规范：单一强调色 #5976D9，画布 #FCFBF9，不用渐变、玻璃、发光、重阴影、悬停抬升；数据必须真实；状态映射统一走 `apps/web/src/lib/status.ts`。下文出现的 LobeHub 只是思路来源。

### 17.1 主对话页（"主线"）整体
- 三栏：**左栏 260px**（可收起到 0，快捷键 `Ctrl+B`），**中间阅读列 `min(860px, 100%)` 居中**，左右 16px 内边距；**右栏默认关闭**。
- 去掉左上角的大号"主线"页面标题。"主线"只在左栏会话列表里作为第一项（置顶、带图钉图标），以及在页头作为 14px 标题出现。
- 正文 14px，行高 22px；元信息 12px；不用 13px。间距只用 4/8/12/16/24/32。

### 17.2 页头（44px 单行）
- **左**：会话名（14px/600，单行省略，最长约 240px）+ 一个 `⌄` 菜单（重命名、归档、导出）。进入成员子会话时显示面包屑"主线 / Codex · 任务名"，父级用 secondary 色。
- **右**：最多 4 个 28px 图标按钮（图标 16px，悬停时 3% 底色，无边框）：
  1. 正在运行的任务数小徽标（如"2 运行中"，点击打开右栏的"任务"Tab，没有任务时不显示）；
  2. 终端/日志开关；
  3. 右栏开关（`PanelRight` 图标，开启时为 active 态）；
  4. "…"（更多）。
- 不在页头放 Agent 描述、模型名、统计数字。中间窗口宽度 ≥1200px 时可以让页头透明浮动（可选，二期再做）。

### 17.3 右侧"此刻"面板 → 按需的工作面板
- **默认关闭**，记住上次的开关状态和宽度（默认 340px，可在 300–560px 间拖动）。从页头图标打开；点击消息里的任务卡、文件、diff 时**自动打开并定位到对应 Tab**。
- 结构改为 **Tab**：`概览 | 任务 | 文件 | 日志`，每次只显示一个 Tab 的内容。
- "概览"Tab 改成**行列表**，不再是段落：
  - 区块标题 11px/600/tertiary（如"运行中""工作目录""成员"）；
  - 每行最小高 32px，结构为 `16px 图标 + 13–14px 值（单行省略）+ 右侧数字/状态（12px tabular-nums）+ ›`，整行可点击，悬停时 3% 底色；
  - 每个区块最多显示 3 行，多出的显示"查看全部 N 项"；
  - **不写解释性的中文长句**。说明文字放到 tooltip 或"?"图标里。
- 没有数据的区块**直接不渲染**，不要"暂无 xxx"占位行。整个面板都没数据时，只显示一行空状态。
- 打开大视图（任务详情 ≥600px、diff/报告 ≥840px）时自动收起左栏，关闭后恢复。

### 17.4 消息渲染
- **用户消息**：靠右气泡，底色为 3% 中性填充（不用强调色），圆角 12px，内边距 8×12，最大宽度约 80%。**不显示用户头像和名字**。
- **Pip / 成员消息**：靠左，**无气泡**。头部是 24px 方形头像 + 名字（14px/600），成员消息在名字后加一个 12px 的"Codex""Claude Code"来源 Tag。
- 时间戳和操作栏（复制、重试、分支、更多）**悬停才显示**，淡入 150ms；"更多"菜单打开时保持显示。
- 消息上下间距 8px；同一个人连续发多条时省略重复的头部。

### 17.5 思考显示
- 运行中：一行"思考中…"，文字有轻微的 opacity 呼吸动效（不用彩色闪光，遵守 v3），默认**展开**，内容区自动跟随滚动到底。
- 结束后：自动折叠为"已思考 12s ›"（12px，tertiary 色）。用户展开过的块保持展开。
- 展开内容区：最大高度 `min(40vh, 320px)`，内部滚动，13px，secondary 色，左侧加 2px 竖线（中性色）区分正文。
- 只有签名、没有内容的思考不渲染。

### 17.6 工具调用与"过程"
- **单个工具行**（折叠，默认）：`状态点 + 动作 关键词 + 耗时`，例如"● 读取 apps/web/src/App.tsx · 0.4s""● 运行 pnpm test · 12s"。动作做人话映射（Codex 的 `command_execution` 显示为"运行"，`file_change` 显示为"修改"……），关键词取第一个字符串参数，截断到 80 字。
- 展开后：先显示"参数"（键值对，最多 6 行，其余折叠），再显示"结果"（`<pre>` 最高 240px，可滚动）；右上角提供"原始 JSON"开关。
- **连续的工具调用合成一组**：运行中全展开，组头是一句动态标题（当前步骤），超过 2s 后才显示计时；组结束后**自动折叠**为"共 8 次调用 · 1 次失败 · 34s ›"。
- **整轮结束后**，把思考、工具和中间叙述再折成一行"已处理 5 步 · 2m 10s ›"（tertiary 色 + 底部分隔线），**最终回答始终显示**。
- **需要审批的调用**：组强制展开，同时在**输入框上方**显示审批条（命令摘要 + 允许 / 拒绝 / 全部允许），多个审批用 Tab 切换。不要用弹窗打断阅读。

### 17.7 Pip 派发任务的渲染
- Pip 派发任务时，在消息流中插入一张**任务组卡**：头像位是被派成员的头像叠放（24px）加一个"任务"小徽标。
- 每个任务一行（默认折叠）：`24px 状态方块（运行中显示 spinner，完成显示勾，失败显示叉；状态色来自 status.ts）+ 成员头像 + 任务标题 + 右侧指标"2m 10s · 14 次工具"`。运行中实时计时。
- 展开后在一个描边容器（内边距 12）内显示该成员的精简过程（同样是折叠后的工具组）和最终结果摘要；底部放一个"在面板中打开"按钮，打开右栏的"任务"Tab 或任务详情（600px）。
- 成员的完整对话**不铺进主线**，主线里只保留摘要和入口。

### 17.8 成员（Agent）定义页
- 页面最大宽 800px，居中。
- **头部**：64px 方形头像、名称（24px/600）、一行描述，三者都可以就地点击编辑。
- **"运行配置"卡**（一张卡，padding 24，圆角 12，1px 边框，无阴影）：
  - 内建 Agent：模型、推理强度、工具/MCP 列表（chip 形式，"+"添加）；
  - **CLI 成员**（Codex / Claude Code）：类型、命令、运行位置（本机/WSL/远程）、安装与登录状态（绿点 + "已登录"，或者"未安装 → 显示安装命令"）、认证方式、模型/effort/速度。**不显示系统提示词编辑器**，改为"附加上下文"（每次派发前附加的固定说明，对应 LobeHub 的 `systemContext` 思路）。
- **人设**（仅内建 Agent）：全宽的文档式编辑器，最低 240px 高。
- **高级**（默认折叠的分区）：环境变量、额外参数、开场白、建议问题（最多 5 条）、在主线中的角色和顺序。
- 字段建议：`name / description / avatar / kind(native|codex|claude-code) / model / effort / tools[] / systemPrompt(仅 native) / extraContext / command / args / env / cwd / runTarget / openingMessage / openingQuestions / role / order / enabled`。

### 17.9 空状态
- 内容放在**输入框上方靠下**的位置：48–64px Pip 头像 → 20–24px 标题"有什么要交给团队的？" → 一行 secondary 说明 → 最多 4 个药丸形建议（点击填入输入框，不直接发送）。
- 各成员没有任务时，列表只显示一行"暂无任务"，不要放大图插画。

### 17.10 输入框
- 左侧只放"+"（附件、指派给某个成员、选工具都收在里面）；右侧放模型/成员 chip 和发送按钮。
- 下方一行放 12px 的小 chip：工作目录、分支、审批模式。点击弹出 popover，不常驻展开。

---

## 18. 关键文件索引（LobeHub 仓库）
- 设计规范：`DESIGN.md`、`DESIGN.dark.md`
- 布局：`src/routes/(main)/_layout/index.desktop.tsx`、`src/features/Conversation/Workspace/index.tsx`、`src/features/NavPanel/components/NavPanelDraggable.tsx`、`packages/const/src/layoutTokens.ts`、`src/store/global/initialState.ts`
- 页头：`src/routes/(main)/agent/features/Conversation/Header/index.tsx`、`Header/Tags/index.tsx`、`Header/WorkingPanelToggle/index.tsx`
- 右栏：`src/features/Conversation/WorkingSidebar/{index.tsx,layout.ts,fitsBesidePortal.ts,Overview/*}`、`src/features/Portal/portalWidth.ts`、`src/routes/(main)/agent/_layout/PortalAutoCollapse.tsx`
- 消息：`src/features/Conversation/ChatItem/*`、`Messages/User/*`、`Messages/AssistantGroup/*`
- 思考：`src/features/Conversation/components/Thinking/*`
- 工具/过程：`Messages/AssistantGroup/components/{WorkflowCollapse,ProcessFold}.tsx`、`AssistantGroup/Tool/*`、`AssistantGroup/constants.ts`
- 任务：`Messages/Task/*`、`Messages/GroupTasks/*`
- 审批：`src/features/Conversation/InterventionBar/*`、`src/features/GlobalApprovalNotification/*`
- Agent 定义：`packages/types/src/agent/{item,agencyConfig,heterogeneousAgent}.ts`、`packages/types/src/agentGroup/index.ts`、`src/routes/(main)/agent/profile/features/ProfileEditor/index.tsx`
- 空状态：`src/features/AgentHome/*`
- 输入框：`src/features/ChatInput/{ActionBar,ControlBar}/*`
- 市场：`src/routes/(main)/community/(list)/mcp/*`
- 设置：`src/features/Setting/SettingContainer.tsx`、`src/routes/(main)/[workspaceSlug]/settings/*`
