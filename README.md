<p align="center">
  <img src="src-tauri/icons/icon.png" alt="神笔写作 Logo" width="116" height="116" />
</p>

<h1 align="center">神笔写作</h1>

<p align="center">
  为中文小说作者设计的本地优先 AI 创作工作台：写书、拆文、扫榜、管理设定，让 Agent 在真实书籍工作区里协同执行。
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Tauri-2-24C8DB?style=flat-square&logo=tauri&logoColor=white" alt="Tauri 2" />
  <img src="https://img.shields.io/badge/React-19-149ECA?style=flat-square&logo=react&logoColor=white" alt="React 19" />
  <img src="https://img.shields.io/badge/SQLite-Local%20First-0F80CC?style=flat-square&logo=sqlite&logoColor=white" alt="SQLite Local First" />
  <img src="https://img.shields.io/badge/pi-AgentHarness-111827?style=flat-square" alt="pi AgentHarness" />
</p>

<p align="center">
  <a href="#设计理念"><strong>设计理念</strong></a> ·
  <a href="#快速上手"><strong>快速上手</strong></a> ·
  <a href="#核心功能"><strong>功能</strong></a> ·
  <a href="#开发者"><strong>开发者</strong></a>
</p>

---

## 这是什么

神笔写作不是一个单纯的聊天框，也不是把正文粘进去再让 AI 回答的网页工具。它把一本小说当成一个长期项目：章节、设定、人物、世界观、伏笔、市场资料、风格规则、AI 会话和写作技能，都围绕同一个本地书籍工作区组织。

你可以把它理解为：

- 一个本地小说项目管理器，用文件树管理整本书。
- 一个写作编辑器，用 Markdown / 文本文档承载章节与设定。
- 一个可调用工具的 AI Agent，在当前书籍里读取、搜索、编辑、写回。
- 一个写作技能系统，把长篇写作、短篇拆解、扫榜、润色、风格提取等流程沉淀成可复用方法。
- 一个数据和模型都由作者掌控的桌面应用。

神笔写作的目标很朴素：让 AI 成为作者工作区里的执行者，而不是替代作者做最终判断。作品结构、事实源、节奏取舍和发布策略，始终应该握在作者手里。

## 设计理念

### 1. 本地优先，作品先属于你

小说正文、设定文件、项目规则、技能和应用设置都以本地数据为中心。应用支持完整 ZIP 备份和 WebDAV 备份，但备份是作者主动发起的行为。神笔写作不会把你的书籍工作区设计成某个远端服务的附属物。

### 2. Markdown 是项目骨架

0.5.0 之后，神笔写作更明确地把项目资料放回 Markdown：项目说明、创作规则、人物设定、世界观、时间线、伏笔、章节状态和写作记忆，都应该能被作者直接打开、阅读、修改和备份。旧式 JSON 化资料和专用维护工具会让小说项目变得不透明，也会让 Agent 把精力浪费在格式修复上；Markdown 更适合长期创作。

### 3. 文件是事实源，不靠聊天记忆撑长篇

长篇小说最怕“聊着聊着设定漂了”。神笔写作鼓励把人物、势力、地点、能力边界、时间线、伏笔和章节状态写进文件，再让 Agent 用搜索和读取工具查证。聊天记录可以提供上下文，但真正可靠的依据应该是项目文件。

### 4. Agent 要会动手，也要可控

Agent 不只是回答建议，它可以在授权范围内搜索工作区、读取文件、统计字数、改写段落、创建文件、维护关联、更新计划。普通协作模式适合边聊边改；YOLO / 自动执行适合目标明确、希望它连续推进的任务。

### 5. 技能是方法论，不是提示词堆料

内置技能以 `SKILL.md` 和按需参考资料组织。Agent 命中任务时先读技能说明，再根据流程读取必要材料。这样可以把“长篇续写怎么拆步骤”“短篇怎么分析反转”“去 AI 味检查哪些句式”等方法固化下来，又避免每次都把所有资料塞进上下文。

### 6. 市场观察和正文创作在同一个工作台里

神笔写作内置番茄榜单、分类统计和题材机会分析能力。扫榜结果可以直接沉淀成项目资料，再进入立项、设定、细纲和正文阶段。它不是只服务“写一句更漂亮”，而是服务从选题到成稿的完整创作链路。

## 快速上手

### 第一步：配置模型

打开“设置 -> 模型设置”，选择或填写：

- Base URL
- API Key
- Model
- reasoning_effort 开关与强度
- OpenCode beta 兼容请求头

神笔写作以 OpenAI-compatible API 为核心接入方式，设置页内置常见供应商推荐，包括 OpenAI、Claude、Gemini、DeepSeek、Qwen、智谱 AI、Moonshot AI、MiniMax、硅基流动、OpenRouter、腾讯、ByteDance、小米 MiMo、LongCat 等。

### 第二步：建立一本书

在书架页新建书籍，进入工作区后可以按自己的习惯组织文件。一个常见结构是：

```text
章节/
设定/
素材/
.project/
  README.md
  AGENTS.md
  canon/
  memory/
```

`.project/README.md` 适合写项目概述，`.project/AGENTS.md` 适合写本书专属规则，`.project/canon/` 适合沉淀人物、设定、时间线、伏笔和连续性资料。

### 第三步：在工作区里写作

左侧文件树管理章节和设定，中间编辑器写正文，右侧 Agent 面板用于协作。你可以让 Agent：

- 读取当前章节并提出节奏问题。
- 根据设定文件续写下一场戏。
- 把一段正文改得更像目标风格。
- 检查前后设定是否矛盾。
- 统计章节字数、整理细纲、生成状态文件。

### 第四步：启用技能

进入技能页查看内置技能，按项目需要启用。任务明显匹配某个技能时，Agent 会先读取该技能，再执行对应流程。

### 第五步：备份与迁移

在“设置 -> 数据管理”中可以导出完整 ZIP 备份，也可以配置 WebDAV 后上传或下载云端备份。建议在长篇项目进入稳定连载后定期备份。

## 核心功能

| 功能                 | 说明                                                                    |
| -------------------- | ----------------------------------------------------------------------- |
| 书籍工作区           | 创建、打开、导入、导出书籍；用文件树管理章节、设定、素材和项目文件      |
| 本地编辑器           | 支持 Markdown / 文本文档编辑，切换文件时自动保存                        |
| Agent 写作面板       | 在书籍内直接对话，支持当前文件、手动选择文件和技能上下文                |
| YOLO 自动执行        | 给出明确目标后连续读取、执行、检查和回写，直到完成或遇到真实阻塞        |
| pi AgentHarness 会话 | 长篇会话落在每本书自己的持久 jsonl 会话中，支持真实上下文压缩           |
| 工作区工具           | 搜索、读取、写入、编辑、字数统计、结构操作、关系维护等工具供 Agent 调用 |
| Canon 与项目记忆     | 通过 `.project/canon`、状态文件、风格文件和章节线索维护长篇事实源       |
| 文件关联图谱         | 任意工作区文件可建立关系，并在图谱页查看整本书的设定网络                |
| 技能库               | 内置 13 个小说创作技能，也可创建和改进自己的本地技能                    |
| 番茄榜单             | 拉取榜单、查看分类、打开作品详情，辅助选题与拆文                        |
| 数据统计             | 对榜单进行题材占比、阅读占比、机会指数、风险信号等统计分析              |
| 模型设置             | 支持 OpenAI-compatible 接口、供应商推荐、连接测试和 reasoning 参数      |
| 用量分析             | 查看请求数、token、模型调用、上下文占用和最近日志                       |
| 数据备份             | 支持完整 ZIP 备份恢复和 WebDAV 云备份                                   |
| 自动更新             | 应用内检查更新，打开对应 Windows EXE 或 Android APK 下载链接            |

## 内置技能

当前内置 13 个技能，覆盖小说项目从立项、拆解、写作、改编到质检的常见环节。

| 技能                     | 用途                                               |
| ------------------------ | -------------------------------------------------- |
| `story-long-write`       | 长篇章节写作、续写、返修和推进                     |
| `story-long-analyze`     | 长篇拆文、结构分析、人物与节奏分析                 |
| `story-long-scan`        | 长篇扫榜、题材研究、市场观察                       |
| `story-short-write`      | 短篇构思、正文写作与成稿                           |
| `story-short-analyze`    | 短篇结构拆解、反转复盘、案例分析                   |
| `story-short-scan`       | 短篇题材扫描、案例搜集与机会判断                   |
| `story-prose-craft`      | 正文落笔技法：视角、动作、对话、节奏、标点、人设味 |
| `story-deslop`           | 去 AI 味、清理模板句、提升表达的人味和具体感       |
| `story-author-style`     | 提取或套用作者风格基因，辅助风格化写作             |
| `story-continuity-audit` | 检查连续性、伏笔、人设、时间线和能力边界问题       |
| `story-rewrite-adapt`    | 长短篇互改、平台适配、旧稿改编和调性重做           |
| `story-title-blurb`      | 书名、简介、标签、卖点包装与门面优化               |
| `skill-creator`          | 把反复使用的方法、风格或检查清单沉淀为新技能       |

技能不是越多越好。建议按当前任务启用：写长篇时启用长篇写作、正文技法、连续性检查；拆文时启用分析和扫榜；终稿阶段再启用去 AI 味和门面包装。

## 典型工作流

### 长篇连载推进

1. 新建书籍，整理章节、设定和 `.project/canon/`。
2. 在 `.project/README.md` 写清题材、主角、目标读者和当前进度。
3. 在 `.project/AGENTS.md` 写本书的硬规则，比如人称、禁写项、设定优先级。
4. 启用 `story-long-write`、`story-prose-craft`、`story-continuity-audit`。
5. 让 Agent 先读取相关设定和上一章，再续写、返修或整理细纲。
6. 每完成一段关键剧情，把新事实写回 canon 或状态文件。

### 拆文与题材研究

1. 在排行榜页查看番茄榜单，进入数据统计页观察题材占比、阅读占比和机会指数。
2. 把候选作品、题材观察和拆解目标整理到素材文件。
3. 启用 `story-long-analyze` 或 `story-short-analyze`。
4. 让 Agent 对章节样本做结构、人物、爽点、反转、节奏和读者预期分析。
5. 将结论沉淀为立项文档、题材卡、细纲模板或新技能。

### 旧稿改编

1. 导入旧稿和原始设定。
2. 启用 `story-rewrite-adapt`、`story-author-style`、`story-title-blurb`。
3. 先让 Agent 判断适配方向：长改短、短改长、换平台、换调性或重做门面。
4. 确认改编方案后分章节执行，必要时维护文件关联和 canon。
5. 成稿后用 `story-continuity-audit` 和 `story-deslop` 做最后体检。

### 建立个人写作方法库

1. 当某套流程反复使用，比如“我的女频开篇检查清单”，启用 `skill-creator`。
2. 让 Agent 把流程整理成 `SKILL.md`，长资料拆进 `references/`。
3. 在后续项目中启用这个技能，让 Agent 按你的方法执行。

## Agent 协作方式

神笔写作中的 Agent 可以读取当前工作区，但它不会凭空知道所有文件内容。为了获得更稳定的结果，建议给它明确的目标和事实入口。

好的任务示例：

```text
请读取 章节/第012章.md、设定/主角.md 和 .project/canon/能力体系.md，
检查本章战斗是否违反能力边界，只列问题和修改建议，先不要改正文。
```

```text
请按 story-long-write 推进下一章，目标是完成男主第一次主动反击。
先读上一章、细纲和人物设定，再写 2500 字左右正文，写完后更新章节状态。
```

```text
把当前章节去 AI 味。保留剧情信息，不扩写，重点处理模板句、空泛心理描写和不自然对话。
```

如果任务很大，建议先让 Agent 制定计划；如果目标清楚、上下文充分，可以使用 YOLO / 自动执行让它连续推进。

## 数据与隐私

- 书籍、技能、设置、会话和应用状态以本地数据库与本地资源目录为主。
- 模型请求会发送你选择给 Agent 的上下文，包括对话、选中文件、技能规则、工具结果和必要的项目结构。
- WebDAV 备份只在你配置并主动使用时上传。
- API Key 存储在本地应用设置中，请保护好设备和备份文件。
- 使用第三方模型供应商时，请同时遵守对应供应商的数据政策。

## 开发者

### 技术栈

- Tauri 2
- React 19
- TypeScript 6
- Vite 8
- Tailwind CSS 4
- Zustand
- pi AgentHarness / pi-ai
- Rust + SQLite

### 本地启动

```bash
npm install
npm run tauri -- dev
```

### 测试

```bash
npm test
npm run typecheck
cargo test --manifest-path src-tauri/Cargo.toml
```

### 打包

```bash
npm run build:exe
npm run build:android
```

### 项目结构

```text
.
├─ src/
│  ├─ app/                  应用壳、路由、标题栏和启动副作用
│  ├─ features/             books / agent / skills / settings / leaderboard / update
│  ├─ shared/               通用 UI、hooks、主题和工具函数
│  └─ assets/               前端静态资源
├─ src-tauri/
│  ├─ src/                  app / domains / infrastructure
│  ├─ resources/skills      内置写作技能
│  ├─ resources/config      默认 AGENTS 规则
│  └─ icons/                应用图标
├─ docs/releases/           版本更新日志
├─ scripts/                 发布打包辅助脚本
└─ release-packages/        本地发布产物目录
```

## 适合谁

- 正在写长篇连载，需要管理章节、设定、伏笔、人物状态和连续性的作者。
- 经常拆文、扫榜、研究题材，希望把分析结果沉淀为项目资产的创作者。
- 想用 AI 写作，但不希望作品完全依赖聊天窗口记忆的用户。
- 希望把个人写作流程、风格经验和质检清单固化为可复用技能的人。
- 需要 Windows 桌面端与 Android 安装包配合使用的个人创作流程。

神笔写作会继续围绕一个方向演进：让 AI 更会查证、更会动手、更尊重本地事实源，同时让作者更容易掌控自己的作品系统。
