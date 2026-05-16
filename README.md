<p align="center">
  <img src="src-tauri/icons/icon.png" alt="神笔写作 Logo" width="116" height="116" />
</p>

<h1 align="center">神笔写作</h1>

<p align="center">
  本地优先的 AI 小说创作工作台，为长篇连载、短篇拆解、设定管理和 Agent 协同写作而生。
</p>

<p align="center">
  <a href="https://github.com/qgming/ainovelstudio/releases/latest">
    <img src="https://img.shields.io/badge/Download-最新版本-0f172a?style=for-the-badge" alt="Download latest release" />
  </a>
  <img src="https://img.shields.io/badge/Version-0.2.9-111827?style=for-the-badge" alt="Version 0.2.9" />
  <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20Android-1f2937?style=for-the-badge" alt="Platform Windows and Android" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Tauri-2-24C8DB?style=flat-square&logo=tauri&logoColor=white" alt="Tauri 2" />
  <img src="https://img.shields.io/badge/React-19-149ECA?style=flat-square&logo=react&logoColor=white" alt="React 19" />
  <img src="https://img.shields.io/badge/SQLite-Local%20First-0F80CC?style=flat-square&logo=sqlite&logoColor=white" alt="SQLite Local First" />
  <img src="https://img.shields.io/badge/AI%20SDK-Vercel-000000?style=flat-square&logo=vercel&logoColor=white" alt="Vercel AI SDK" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/AI-Agent%20Workspace-111827?style=flat-square" alt="AI Agent Workspace" />
  <img src="https://img.shields.io/badge/Mode-Collab%20%7C%20YOLO-7c3aed?style=flat-square" alt="Collab and YOLO modes" />
  <img src="https://img.shields.io/badge/Canon-Longform%20Memory-b45309?style=flat-square" alt="Longform Canon Memory" />
  <img src="https://img.shields.io/badge/Backup-ZIP%20%7C%20WebDAV-475569?style=flat-square" alt="ZIP and WebDAV backup" />
</p>

<p align="center">
  <a href="#下载与安装"><strong>下载</strong></a> ·
  <a href="#为什么用神笔写作"><strong>产品亮点</strong></a> ·
  <a href="#核心能力"><strong>核心能力</strong></a> ·
  <a href="#模型接入"><strong>模型接入</strong></a> ·
  <a href="#开发者"><strong>开发者</strong></a>
</p>

---

## 一句话介绍

神笔写作把“小说文件夹、AI Agent、写作技能、设定事实源、模型配置、备份同步”放进一个本地应用里。它适合用来管理一部长篇小说，也适合用来拆文、扫榜、润色、整理设定和让 AI 按目标持续推进写作任务。

它的重点很明确：让作者掌控项目事实源，让 AI 读到该读的文件、使用该用的技能、把结果写回真实工作区。

## 下载与安装

| 平台 | 安装包 |
| --- | --- |
| Windows x64 | [下载 EXE](https://github.com/qgming/ainovelstudio/releases/latest/download/ainovelstudio_0.2.9_windows_x64.exe) |
| Android arm64 | [下载 APK](https://github.com/qgming/ainovelstudio/releases/latest/download/ainovelstudio_0.2.9_android_arm64.apk) |

更多版本记录见 [Releases](https://github.com/qgming/ainovelstudio/releases)。

## 为什么用神笔写作

### 为小说项目设计

神笔写作的第一屏就是书籍工作区。你可以把章节、设定、状态文件、素材和项目规则放在同一个书籍目录中，用文件树管理，用编辑器写作，用 Agent 在右侧协作。

### 本地优先，作品在你手里

书籍和应用数据保存在本地。应用支持完整备份 ZIP，也支持 WebDAV 云备份，适合在本地创作和跨设备恢复之间取得平衡。

### Agent 在工作区里行动

Agent 可以读取当前书籍结构、指定文件、启用的技能和项目规则。它能用 `workspace_search`、`workspace_read`、`workspace_edit`、`workspace_write` 处理工作区内容，用 `project_memory_search` 查项目事实源，用 `text_stats` 统计字数，也能通过 `update_plan` 维护任务计划。

### 长篇创作有事实源

`.project/canon`、项目状态、章节线索和风格信息可以作为长篇事实源。Agent 在处理人物、地点、伏笔、能力边界和连续性时，可以先查事实源，再生成或修改内容。

### 可切换协作强度

普通协作模式适合边聊边改。YOLO 模式适合给出明确目标后，让 Agent 连续读取、执行、检查和回写，直到目标完成或遇到真实阻塞。

## 核心能力

| 能力 | 说明 |
| --- | --- |
| 书籍工作区 | 创建、打开、导入、导出书籍；用文件树管理章节、设定和项目文件 |
| 本地编辑器 | 支持 Markdown / 文本编辑，文件切换后自动保存 |
| Agent 写作面板 | 在书籍内直接对话，支持当前文件、手动选择文件和技能上下文 |
| YOLO 自动执行 | 围绕目标连续推进，多轮执行、检查和回写 |
| Canon 查询 | 查询 `.project/canon`、状态、风格、章节线索，减少长篇设定漂移 |
| Skill 技能库 | 内置长篇写作、拆文、扫榜、去 AI 味、短篇分析等专项技能 |
| 工具权限 | 控制 Agent 可用的读取、搜索、编辑、写入、网页检索、任务派发等工具 |
| 模型设置 | 支持 OpenAI-compatible 接口、模型测试、供应商推荐和 reasoning 参数开关 |
| 用量统计 | 查看请求数、token、模型调用和会话上下文占用 |
| 数据备份 | 支持完整 ZIP 备份恢复和 WebDAV 云备份 |
| 自动更新 | 应用内读取自建更新 JSON 检查新版本，并通过浏览器打开 Windows EXE 或 Android APK 下载链接 |

## 内置技能

当前内置 7 个写作技能，覆盖小说创作常见任务：

| 技能 | 用途 |
| --- | --- |
| `story-long-write` | 长篇小说写作、续写、章节推进 |
| `story-long-analyze` | 长篇拆文、结构分析、人物与节奏分析 |
| `story-long-scan` | 扫榜、题材研究、长篇市场观察 |
| `story-short-write` | 短篇写作与成稿 |
| `story-short-analyze` | 短篇结构拆解与复盘 |
| `story-short-scan` | 短篇题材与案例扫描 |
| `story-deslop` | 去 AI 味、润色、压缩、增强人味表达 |

Agent 在遇到明显匹配技能的任务时，会先读取对应 `SKILL.md`，再按技能流程执行。

## 典型工作流

### 写长篇

1. 新建一本书。
2. 在文件树里整理 `章节/`、`设定/`、`.project/canon/`。
3. 配置模型 API。
4. 打开 Agent 面板，让它读当前章节和设定。
5. 用普通模式协作修改，或用 YOLO 模式让它按目标推进。

### 拆一本书

1. 导入或整理章节文本。
2. 启用 `story-long-analyze`。
3. 让 Agent 读取章节、抽样分析结构、人物、设定、节奏。
4. 输出分段细纲、总纲和设定文档。

### 做备份

1. 在设置页打开数据管理。
2. 导出完整 ZIP 备份。
3. 配置 WebDAV 后，可上传或下载云端备份。

## 模型接入

神笔写作以 OpenAI-compatible API 为核心接入方式。设置页提供常见供应商地址推荐，并支持连接测试。

已内置快捷推荐：

- OpenAI
- Claude
- Gemini
- DeepSeek
- Qwen
- 智谱 AI
- Moonshot AI
- MiniMax
- 硅基流动
- OpenRouter
- 腾讯
- ByteDance
- 小米 MiMo
- LongCat

支持配置：

- Base URL
- API Key
- Model
- reasoning_effort 开关与强度
- OpenCode beta 兼容请求头

## 数据与隐私

- 书籍、技能、设置和应用状态以本地数据库与本地资源目录为主。
- 模型请求会发送你选择给 Agent 的上下文，包括当前对话、选中的文件内容、技能规则和必要的项目结构。
- WebDAV 备份只在你配置并主动使用时上传。
- API Key 存储在本地应用设置中，请自行保护设备和备份文件。

## 更新日志

- [v0.2.9](docs/releases/v0.2.9.md)：Agent 历史更多菜单、工作区文件一键加入上下文、用量统计独立表与最近 100 条日志。
- [v0.2.8](docs/releases/v0.2.8.md)：镜像文件自动同步回内部工作区、桌面端关闭即退出、托盘轻量模式与 AI 状态展示。
- [v0.2.6](docs/releases/v0.2.6.md)：桌面端文件夹镜像同步、目录栏系统资源管理器入口、网文大白话规则、Agent 流式失败自动续跑。
- [v0.2.5](docs/releases/v0.2.5.md)：Agent 核心重构、YOLO、Canon、流式模型代理、todo 稳定性修复、双端发布。
- [v0.2.4](docs/releases/v0.2.4.md)：模型推理开关默认安全值、会话上下文面板、工作流判断容错。
- [历史版本](docs/releases)

## 开发者

### 技术栈

- Tauri 2
- React 19
- TypeScript 5.8
- Vite 7
- Tailwind CSS 4
- Zustand
- Vercel AI SDK
- Rust + SQLite

### 本地启动

```bash
npm install
npm run tauri -- dev
```

### 测试

```bash
npm test
npx tsc --noEmit
cargo check --manifest-path src-tauri/Cargo.toml
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
│  ├─ app/                  应用壳、路由、启动副作用
│  ├─ features/             books / agent / skills / settings / update
│  ├─ shared/               通用 UI、hooks、utils
│  └─ assets/               前端静态资源
├─ src-tauri/
│  ├─ src/                  app / domains / infrastructure
│  ├─ resources/skills      内置技能
│  ├─ resources/config      默认 AGENTS 规则
│  └─ icons/                应用图标
├─ docs/releases/           版本更新日志
├─ scripts/                 发布打包辅助脚本
└─ release-packages/        本地发布产物
```

## 适合谁

- 正在写长篇连载，需要管理章节、设定、伏笔和连续性的作者。
- 经常拆文、扫榜、分析题材，希望把分析结果沉淀成可复用文档的创作者。
- 想用 AI 写作，但希望 AI 尊重本地文件和项目事实源的用户。
- 需要 Windows 桌面端与 Android 安装包的个人创作工作流。

神笔写作的目标是让 AI 成为书籍工作区里的执行者，而作品结构、事实源和最终决定仍掌握在作者手里。
