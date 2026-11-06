# 对话式 Agent 工作台 UI 模式调研（给 Muster 主对话页减负）

> 调研日期：2026-11-06。目的：解决 Muster 当前“太密”的问题：右侧「此刻」面板堆满中文、左上角“主线”大标题突兀。目标是做到 ChatGPT / Claude 网页版那种安静、简单的样子，面板默认收起、点了才展开。
> 标注说明：**[文档]** 表示本次在官方文档或官方博客里核实过；**[观察]** 表示来自对产品的长期使用印象或第三方资料，本次没有逐条复核，落地前建议截图对照。

---

## 0. 先说结论（Muster 改什么）

1. **去掉「主线」页标题。** 顶栏只放一样东西：居中或靠左的**对话名下拉**，比如 `Pip · 今天 ▾`，字号 14px、常规字重。右侧最多放 2–3 个图标按钮（状态胶囊、面板开关、更多）。ChatGPT 和 Claude 的对话页都不显示“页面名”，只显示对话名或模型选择器。
2. **「此刻」面板默认收起**，只留一条 44–48px 宽的**图标轨**（或者顶栏上的一个状态胶囊），只显示数字徽标：`需要你 2`、`进行中 3`、`失败 1`。点击后展开成 360px 的抽屉，再点一次或按 Esc 收起。展开与否按用户记住（localStorage）。
3. **状态优先级只有一套**，参照 ChatGPT 桌面端 Pet 的顺序：**需要你 > 受阻/失败 > 已完成未读 > 运行中**。图标轨、顶栏胶囊、系统通知都按这个顺序决定显示哪一个。
4. **任务进度放进对话流里**，用一行可折叠的“任务行”表示，比如 `Codex 正在修改 3 个文件 · 2/5 步 · 1m12s ›`；**不要**在侧栏里重复放一整段中文描述。正在运行的目标可以在输入框上方固定一条 progress row（参照 ChatGPT 的 Goal mode）。
5. **思考过程默认折叠。** 运行中显示 `思考中 · 8s`（灰色，带计时）；结束后变成 `已思考 12 秒 ›`，展开后才能看到摘要。工具调用同样折叠成一行，例如 `读取了 4 个文件 ›`。
6. **审批（需要你）在对话流里以内联卡片出现**：一句话说明 + 主次两个按钮（`批准一次` / `拒绝`，“本会话都允许”收进更多菜单）。全局只在图标轨显示计数徽标，不弹大面板。
7. **中文密度规则**：正文 15px / 行高 1.7 / 字距 0；单栏最大宽度 38–40 个汉字（约 640–680px）；段落之间留 0.75em；任何状态描述控制在 1 行、20 个字以内，长说明一律折叠。

---

## 1. “Muse”到底指什么

- **Muse = Meta Superintelligence Labs（MSL）的模型系列。** 第一款 **Muse Spark** 于 2026-04-08 发布，同时 **Meta AI App 和 meta.ai 换了新外观**。[文档] https://about.fb.com/news/2026/04/introducing-muse-spark/
- 跟 UI 有关的几点 [文档]：
  - 只有 **Instant / Thinking 两个模式**，靠一个开关切换，不让用户挑模型列表。
  - Meta AI 可以**并行启动多个子代理**（例子：一个排行程、一个比较目的地、一个找活动），但对用户呈现的是**一个答案**。这和 Muster “Pip 协调、成员执行”的结构几乎一样。可以借鉴的是：子代理是实现细节，不是界面主角。
  - “side chats”：在群聊里点 Meta AI 图标，拿到一个私密的快速回答，不打断主对话。（5 月 12 日更新）
  - 地点、热点类问题会把“相关上下文”放在对话旁边（“right alongside the conversation”），而不是塞进回答正文。
- 有媒体说还有一个 “Contemplating” 深度模式，但各家说法不一致，暂不作为依据。[观察] https://www.neowin.net/amp/meta-launches-muse-spark-ai-with-reasoning-and-native-multimodal-capabilities/ ；评测见 https://www.techradar.com/ai-platforms-assistants/i-tried-metas-new-muse-spark-ai-model-and-it-feels-like-chatgpt-built-for-the-social-internet
- **对 Muster 的启示**：模式开关越少越好（Muster 可以只留“快速 / 深入”）；多 agent 并行可以在回答上方折叠成一行 `Pip 派了 3 位成员 ›`，展开后才看到每个成员的状态。

---

## 2. 逐个产品的具体模式

### 2.1 ChatGPT 桌面端（2026 年已与 Codex 合并）

- **侧栏**：Projects 视图把项目和聊天放在一起；侧栏里有一个**铃铛（Activity）**，只列出“未读 / 运行中 / 等你回复”的聊天，可以筛选，也可以“全部标为已读”。快捷键是 Ctrl+Alt+U。[文档] https://learn.chatgpt.com/docs/notifications.md
- **长任务**：`/goal` 启动 Goal mode 后，**输入框上方出现一条 progress row**，可以暂停、继续、编辑、清除。想问进度而不打断主对话时，用 **side chat**。[文档] https://learn.chatgpt.com/docs/long-running-work.md
- **状态只有四种**，并且有明确优先级：Running / **Needs input** / Ready / Blocked。多个聊天同时有活动时，按 需要输入 > 受阻 > 就绪 > 运行中 的顺序展示。[文档] https://learn.chatgpt.com/docs/pets.md
- **Pet / Mini 悬浮控件**：一个可选的小伙伴浮在其他窗口上方，只显示状态，点铃铛展开线程列表，用 chevron 收起。吉祥物在这里是**状态指示器**，不是装饰。[文档] 同上
- **右侧面板按需打开**：生成的文档、表格、PDF、HTML 在聊天旁边预览；任务运行期间，“chat sidebar”可以显示计划、来源、生成的文件和摘要，用来引导工作。[文档] https://learn.chatgpt.com/docs/artifacts-viewer.md
- **审批**：权限控件放在**输入框下方**（询问 / 替我批准 / 完全访问）。官方建议“选能让任务继续下去的最窄范围”，比如只批准一次，而不是整个会话。沙箱本身的作用之一就是**减少审批疲劳**。[文档] https://learn.chatgpt.com/docs/sandboxing.md
- **顶栏** [观察]：对话页顶部只有模型/模式选择器和分享按钮，没有页面标题；侧栏可以整体收起成图标。
- **旧版 ChatGPT agent**（接管浏览器、高影响操作前确认）已经下线，由 ChatGPT Work 接替。[文档] https://help.openai.com/en/articles/11752874-chatgpt-agent

### 2.2 Codex app

- 三栏布局：项目侧栏、线程、审阅面板（diff）。审阅面板默认只看“本轮改动”，可以切换已暂存和未暂存。线程列表可以**按状态筛选**或改成时间顺序。[文档] https://developers.openai.com/codex/app ；https://developers.openai.com/codex/app/troubleshooting
- 启示：**成员 agent 的产出（diff、文件）放在右侧按需面板里**，主对话只放一行摘要和“查看改动 ›”。

### 2.3 Claude（网页、桌面端、Cowork）

- **思考展示**：运行中显示带计时器的“Thinking”指示；完成后，回答上方出现一个**可展开**的 Thinking 区块，点开才看到思考摘要（不是原始推理）。[文档] https://support.claude.com/en/articles/10574485
- **Cowork 已经与 Chat 合并**：同一个输入框里切换 Chat / Cowork；用户描述一个结果后就可以离开，回来拿成品。左侧栏有新任务、项目、Scheduled，以及 Tasks 列表。[文档] https://support.claude.com/en/articles/13345190
- **Cowork 右侧**有 Progress（分步计划）、Working folders、Context（当前启用的连接器）三块。Progress 只用来**看**，不能编辑；要改方向，就改指令。[观察，第三方课程] https://findskill.ai/courses/claude-cowork-essentials/lesson-3-interface
- **顶栏** [观察]：顶部居中是**对话名（可点开重命名或加星）**；Artifact 只在生成时才从右侧滑出，可以关闭；侧栏可以收成窄条。工具调用折叠成一行，比如 “Searched the web ›”。

### 2.4 Microsoft 365 Copilot（2026-05 改版）

- 左侧导航**可以展开和收起**，首屏是干净的极简布局；更多工具和历史记录只在需要时出现。新增置顶区（常用 agent/应用），以及一个 **Tasks 标签页**，集中显示长时间运行的 Copilot 活动（定时聊天、agent 活动）。[文档/媒体] https://microsoft.com/en-us/microsoft-365/blog/2026/05/28/introducing-a-new-design-for-microsoft-365-copilot （本次直接抓取被拦截，内容来自搜索摘要和 https://hothardware.com/news/microsoft-unveils-microsoft-365-copilot-redesign ）
- 启示：**长任务有一个独立的“任务”入口**，不在聊天页常驻。对 Muster 来说，就是「此刻」收进图标轨，详情去“事件/需要你”页查看。

### 2.5 Google Workspace / Gemini

- 侧边面板曾经是所有 Workspace 应用通用的入口，**点按钮才打开**。2026 年开始在 Chat 中退役，改成内嵌的 Ask Gemini；Gmail 个人版也逐步换成 in-line AI。[媒体] https://spaces.collab365.com/posts/google-moves-gemini-into-chat-and-retires-the-side-RliiSz ；https://gulfnews.com/technology/gemini-side-panel-phased-out-as-gmail-rolls-out-in-line-ai-1.500403819 ；帮助中心 https://support.google.com/a/users/answer/15146419
- 启示：**常驻的 AI 侧栏正在被“内联在上下文里”的做法取代**。

### 2.6 Linear

- 2024 年改版的目标写得很直接：调整侧栏、标签、页头和面板，“**减少视觉噪声**、保持对齐、提升层级”；主题只由 3 个变量生成（base、accent、contrast）。[文档] https://linear.app/changelog/2024-03-20-new-linear-ui ；https://linear.app/now/how-we-redesigned-the-linear-ui
- 2026-09 推出 **Priority inbox**：把“需要你注意的”和“可以等的”分开，例如阻塞发布的 review 不会被埋掉；原来的 inbox 也保留。[文档] https://linear.app/changelog/2026-09-03-priority-inbox
- Inbox 支持**稍后提醒（snooze）**，到时间后重新出现。[文档] https://linear.app/docs/inbox

### 2.7 Slack（2026-05 Activity 改版）

- 核心观点：“通知一直被当成 **feed**，其实应该是 **inbox**。feed 从你身边流过，inbox 会等你处理，处理完会有‘完成’的感觉。”改版提供保存视图、批量操作和快捷键。[文档] https://slack.com/intl/en-gb/blog/news/slack-activity-triage-for-notifications
- 启示：「需要你」应该做成**可以清空的收件箱**，而不是滚动的事件流；「此刻」面板目前的问题正是把它做成了 feed。

### 2.8 飞书 aily

- 2025-12 推出“任务模式”，在独立的云端电脑里执行任务并交付产物；2026-07 增加主动工作和多智能体协同，会根据消息、文档、日历、任务跟进事项。[文档/媒体] https://www.feishu.cn/content/article/7585126677299137754 ；https://www.news.cn/tech/20260723/5a84c09560134a5c9937a825773fba95/c.html
- 官方资料没有说明进度界面长什么样，这次没有找到可以引用的细节。

---

## 3. 中文（CJK）密度规则

依据 W3C《中文排版需求》（clreq），结合主流产品的做法 [观察]：

| 项 | 建议值 | 说明 |
|---|---|---|
| 正文字号 | 15px（对话气泡）/ 14px（侧栏、列表） | 13px 以下只用于时间戳、计数 |
| 行高 | 1.7（正文）/ 1.5（单行列表） | 中文没有升部和降部，需要比英文更大的行距才透气 |
| 字距 | **0**，不要加 letter-spacing | clreq：行内文字“原则上密排”。加字距会让中文显得松散、不像正文 |
| 中西文间距 | 约 1/4 字宽（CSS `text-autospace` 或手动加半角空格） | clreq：汉字与西文、数字之间“不多于四分之一个汉字宽” |
| 行长 | 每行 35–40 字；对话列 max-width ≈ 40em | 太宽是“文字墙”感的主要来源 |
| 字重 | 正文 400，强调最多 500；**不要整段加粗** | 中文粗体在小字号下容易糊成一片 |
| 段间距 | 0.75em；列表项之间 4–6px | 用留白分组，不用分隔线和卡片框 |
| 文案长度 | 状态 ≤ 12 字，说明 ≤ 1 行（约 20 字），超出就折叠 | 例如“Codex 正在跑测试”，而不是一整句解释 |
| 颜色层级 | 主文本 / 次文本（60% 透明度）/ 弱文本（40%）三级 | 用灰度区分信息层级，比加框、加底色安静 |

参考：https://www.w3.org/TR/clreq/ ；W3C i18n 关于行内空白的文章 https://w3c.github.io/i18n-drafts/articles/styling/inline-space.en

---

## 4. Muster 具体方案

### 4.1 主对话页的顶栏（替代「主线」标题）

```
[≡]  Pip · 今天的对话 ▾                         (● 2 需要你) [▤] [⋯]
```
- 左：侧栏开关（侧栏收起时才显示）。
- 中或左：**对话名下拉**，14px、字重 500、颜色为次文本。点开后可以切换或重命名对话、查看历史。没有对话名时只显示 “Pip”。
- 右：**一个状态胶囊**，只显示优先级最高的那一项（需要你 > 失败 > 新完成 > 运行中，见 §0.3），没有事项时隐藏。然后是面板开关和更多菜单。
- 去掉大号页标题、副标题、日期问候和面包屑。其他页面（团队、设备……）也不用 H1 大标题，标题放在顶栏左侧，14–15px。

### 4.2 「此刻」面板

- **默认收起**，只剩一条 48px 宽的竖向图标轨，从上到下：需要你（带徽标数）、进行中（数字或旋转小点）、日程（下一项的时间）、设备（异常时显示红点）。**不显示任何中文句子。**
- 点击任一图标 → 展开 360px 抽屉并定位到对应分区。抽屉里每条只占 1 行（图标 + ≤20 字标题 + 右侧相对时间），点击后跳到对话中的对应位置或对应页面。
- 抽屉分区标题 12px 次文本，不加卡片边框，用 16px 留白分组。
- 动效：宽度过渡 180ms ease-out；徽标数字变化时淡入，不要弹跳或发光（遵守 v3 规范：no glow/hover-lift）。
- 空状态写一行即可，比如“此刻没有需要你的事”，不配插画。

### 4.3 对话流里的任务进度

- Pip 派出任务时，插入一行**任务行**（不是卡片墙）：
  `◐ Codex · 修复登录测试 · 2/5 步 · 1:12  ›`
  完成后变成 `✓ Codex 完成了“修复登录测试” · 查看改动 ›`。
- 展开后显示步骤列表（每步一行，灰色，最多默认显示 5 条，其余收起）和产物链接；diff 和文件在右侧**按需面板**里打开（参照 Codex 审阅面板、Claude Artifact）。
- 多个成员并行时，合并成一行 `Pip 派了 3 位成员 · 1 进行中 · 2 完成 ›`（参照 Meta 的子代理呈现方式）。
- 正在运行的长目标：在输入框上方固定一条 progress row，带暂停和停止按钮（参照 ChatGPT Goal mode）。

### 4.4 思考展示

- 运行中：`思考中 · 8s`，次文本颜色，计时器跳动，不要大块骨架屏。
- 完成后：`已思考 12 秒 ›`，默认折叠；展开后是摘要文本（14px、次文本色、左侧细竖线），不要另做卡片。
- 工具调用归入同一个折叠区或单独一行：`查阅了 3 条记忆 · 运行了 2 条命令 ›`。

### 4.5 审批（需要你）

- **就地出现**：在发起任务的那条消息下方，插入内联审批卡片：
  `Codex 想要运行 pnpm test（在 D:\code\xuqiu）` → `[批准一次]  [拒绝]  ⋯（本会话都允许 / 查看详情）`
- 默认按钮是最窄的范围（批准一次），参照 Codex 文档“选最窄范围”的建议。
- 全局入口只做计数：图标轨徽标、顶栏胶囊，以及应用在后台时的系统通知（可以在设置里选“从不 / 仅后台 / 总是”，参照 ChatGPT）。
- 「需要你」页面做成**可以清空的 inbox**（Slack / Linear 的思路）：支持批量处理、稍后提醒、处理完显示“都处理完了”。

### 4.6 侧栏

- 默认显示：新对话、对话列表（最近 N 条），底部是几个页面入口（团队、事件、设备、记忆、技能、成本、设置）。页面入口可以折叠到“更多”里，像 M365 Copilot 那样只置顶常用项。
- 可以整体收成 56px 图标条（Ctrl+B / Ctrl+\\），状态记住。
- 头像和吉祥物：Pip 用一个小头像（20px）标识发言者即可；如果要做“吉祥物”，参照 ChatGPT Pet，让它承担**状态指示**的作用（运行中 / 需要你 / 失败），而不是装饰。

---

## 5. 不要做的事（从反面总结）

- 不要在主页面常驻一个文字面板，把“现在发生了什么”写成句子（这就是 feed 化，Slack 改版专门在纠正这一点）。
- 不要为每个成员 agent 单独放一张状态卡（会形成 KPI 墙）；合并成一行，展开才看明细。
- 不要用加粗、彩色标签、边框来区分层级；用灰度和留白。
- 不要显示原始思考流，也不要在回答里内联大段工具输出。

---

## 来源

- Meta Muse Spark 公告：https://about.fb.com/news/2026/04/introducing-muse-spark/
- TechRadar 评测：https://www.techradar.com/ai-platforms-assistants/i-tried-metas-new-muse-spark-ai-model-and-it-feels-like-chatgpt-built-for-the-social-internet
- ChatGPT/Codex 文档：https://learn.chatgpt.com/docs/notifications.md ，https://learn.chatgpt.com/docs/long-running-work.md ，https://learn.chatgpt.com/docs/pets.md ，https://learn.chatgpt.com/docs/artifacts-viewer.md ，https://learn.chatgpt.com/docs/sandboxing.md ，https://learn.chatgpt.com/docs/projects.md ，https://developers.openai.com/codex/app
- ChatGPT agent 下线说明：https://help.openai.com/en/articles/11752874-chatgpt-agent
- Claude：https://support.claude.com/en/articles/10574485 ，https://support.claude.com/en/articles/13345190 ；第三方 Cowork 界面课程：https://findskill.ai/courses/claude-cowork-essentials/lesson-3-interface
- Microsoft 365 Copilot：https://microsoft.com/en-us/microsoft-365/blog/2026/05/28/introducing-a-new-design-for-microsoft-365-copilot ，https://hothardware.com/news/microsoft-unveils-microsoft-365-copilot-redesign
- Gemini 侧边面板：https://support.google.com/a/users/answer/15146419 ，https://spaces.collab365.com/posts/google-moves-gemini-into-chat-and-retires-the-side-RliiSz ，https://gulfnews.com/technology/gemini-side-panel-phased-out-as-gmail-rolls-out-in-line-ai-1.500403819
- Linear：https://linear.app/changelog/2024-03-20-new-linear-ui ，https://linear.app/now/how-we-redesigned-the-linear-ui ，https://linear.app/changelog/2026-09-03-priority-inbox ，https://linear.app/docs/inbox
- Slack：https://slack.com/intl/en-gb/blog/news/slack-activity-triage-for-notifications
- 飞书 aily：https://www.feishu.cn/content/article/7585126677299137754 ，https://www.news.cn/tech/20260723/5a84c09560134a5c9937a825773fba95/c.html
- W3C clreq：https://www.w3.org/TR/clreq/ ；https://w3c.github.io/i18n-drafts/articles/styling/inline-space.en
