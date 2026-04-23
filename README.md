<p align="center">
  <img src="src-tauri/icons/icon.png" alt="神笔写作 Logo" width="120" height="120" />
</p>

<h1 align="center">神笔写作</h1>

<p align="center">
  面向网文、长篇连载与 AI 协同创作的本地优先写作工作台
</p>

<p align="center">
  把书籍工作区、Agent、Skill、Workflow、模型配置、数据备份与 WebDAV 云备份整合进一个桌面应用
</p>

<p align="center">
  <a href="https://github.com/qgming/ainovelstudio">
    <img src="https://img.shields.io/github/stars/qgming/ainovelstudio?style=for-the-badge&logo=github&label=Stars" alt="GitHub Stars" />
  </a>
  <img src="https://img.shields.io/badge/Version-0.2.1-111827?style=for-the-badge" alt="Version 0.2.1" />
  <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20Android-1f2937?style=for-the-badge" alt="Platform Windows and Android" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Tauri-2-24C8DB?style=flat-square&logo=tauri&logoColor=white" alt="Tauri 2" />
  <img src="https://img.shields.io/badge/React-19-149ECA?style=flat-square&logo=react&logoColor=white" alt="React 19" />
  <img src="https://img.shields.io/badge/TypeScript-5.8-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript 5.8" />
  <img src="https://img.shields.io/badge/Vite-7-646CFF?style=flat-square&logo=vite&logoColor=white" alt="Vite 7" />
  <img src="https://img.shields.io/badge/SQLite-Local%20First-0F80CC?style=flat-square&logo=sqlite&logoColor=white" alt="SQLite Local First" />
  <img src="https://img.shields.io/badge/AI%20SDK-Vercel-000000?style=flat-square&logo=vercel&logoColor=white" alt="Vercel AI SDK" />
</p>

<p align="center">
  <a href="#快速开始"><strong>快速开始</strong></a> ·
  <a href="#核心能力"><strong>核心能力</strong></a> ·
  <a href="#内置资源"><strong>内置资源</strong></a> ·
  <a href="#项目结构"><strong>项目结构</strong></a> ·
  <a href="#模型接入"><strong>模型接入</strong></a>
</p>

---

## 概览

`AiNovelStudio` 服务于小说创作的完整链路：从书籍结构管理、正文写作、设定维护，到代理调度、技能复用、工作流自动化和本地数据同步，全部在同一个应用内完成。

<table>
  <tr>
    <td width="25%" valign="top">
      <strong>本地优先</strong><br />
      SQLite + 本地资源目录管理书籍、代理、技能与工作流
    </td>
    <td width="25%" valign="top">
      <strong>AI 协同写作</strong><br />
      在书籍工作区内直接调用 Agent，结合上下文持续创作
    </td>
    <td width="25%" valign="top">
      <strong>流程自动化</strong><br />
      把规划、写作、审校、润稿、回写设定串成可重复执行的工作流
    </td>
    <td width="25%" valign="top">
      <strong>同步与备份</strong><br />
      支持完整备份 ZIP 与 WebDAV 云端备份
    </td>
  </tr>
</table>

## 核心能力

- 本地书籍工作区：以文件树管理一本书，支持新建、重命名、删除、自动保存和持续编辑，并把 `.project/AGENTS.md`、`.project/项目状态.json` 等项目元数据统一收纳到 `.project/`。
- 书架与书籍包：支持创建书籍、导入 `.zip` 书籍包、导出标准书籍包。
- Agent 面板：在书籍工作区内直接发起对话，结合当前文件、工作区结构、技能和代理资源完成写作或编辑任务。
- 技能库：支持内置技能、ZIP 导入、自建技能工作区，以及技能启停管理。
- 代理库：支持内置代理、ZIP 导入、自建代理模板，以及代理启停管理。
- 工作流引擎：把书籍、代理和步骤编排成可重复运行的多节点流程，支持运行、暂停、继续、查看历史与节点执行结果。
- 模型设置：配置任意 OpenAI-compatible 接口，内置常见供应商地址推荐与连接测试。
- 数据管理：支持完整备份导入导出与 WebDAV 云备份，覆盖书籍、技能、代理、工作流、模型配置、主代理 AGENTS 与数据同步设置。
- 用量统计：记录请求数、Token 和模型维度的使用日志。
- 工具库：按工具维度控制 Agent 会话可用能力。

## 内置资源

<table>
  <tr>
    <td width="33%" valign="top">
      <strong>7 个内置代理</strong><br /><br />
      <code>连载作者</code><br />
      <code>章节编辑</code><br />
      <code>总编</code><br />
      <code>设定编辑</code><br />
      <code>大纲编辑</code><br />
      <code>润稿编辑</code><br />
      <code>审校编辑</code>
    </td>
    <td width="33%" valign="top">
      <strong>8 个内置技能</strong><br /><br />
      <code>chapter-planner</code><br />
      <code>continuity-check</code><br />
      <code>humanizer</code><br />
      <code>outline-manager</code><br />
      <code>plot-planner</code><br />
      <code>story-bible</code><br />
      <code>story-state</code><br />
      <code>story-writer</code>
    </td>
    <td width="33%" valign="top">
      <strong>2 个内置工作流</strong><br /><br />
      <code>全自动写小说</code><br />
      <code>自动生成番茄短篇</code>
    </td>
  </tr>
</table>

## 技术栈

- `Tauri 2`
- `React 19`
- `TypeScript`
- `Vite 7`
- `Tailwind CSS 4`
- `shadcn/ui`
- `Zustand`
- `Vercel AI SDK`
- `Rust + rusqlite`
- `SQLite`

## 快速开始

### 环境依赖

- `Node.js 20+`
- `npm`
- `Rust stable`
- Tauri 对应平台构建环境

### 安装依赖

```bash
npm install
```

### 启动前端开发环境

```bash
npm run dev
```

### 启动 Tauri 桌面开发模式

```bash
npm run tauri -- dev
```

## 测试

运行主测试集：

```bash
npm test
```

运行集成测试：

```bash
npm run test:integration
```

## 构建

前端构建：

```bash
npm run build
```

Windows EXE：

```bash
npm run build:exe
```

Android APK：

```bash
npm run build:android
```

## 项目结构

```text
.
├─ src/                     React 前端
│  ├─ pages/                页面层
│  ├─ components/           UI 组件
│  ├─ stores/               Zustand 状态管理
│  ├─ lib/                  Agent / Workflow / Workspace 等业务逻辑
│  └─ test/                 前端测试初始化
├─ src-tauri/               Tauri + Rust 后端
│  ├─ src/                  本地命令、数据库、工作流、数据管理
│  ├─ resources/            内置 agents / skills / workflows / config
│  └─ icons/                应用图标资源
├─ public/                  静态资源
└─ README.md
```

## 适合的使用场景

- 管理一部长篇小说的章节、设定、状态文件和写作过程。
- 把“规划 -> 写作 -> 审校 -> 润稿 -> 回写设定”串成自动化创作流程。
- 沉淀可复用的 Agent、Skill、Workflow 包，并通过 ZIP 分发给其他项目。
- 在本地优先的数据环境里完成创作，同时通过 WebDAV 做跨设备云备份。

## 模型接入

应用当前以 OpenAI-compatible API 为核心接入方式，设置页内已经提供以下供应商的快捷推荐地址：

- `OpenAI`
- `Claude`
- `Gemini`
- `DeepSeek`
- `Qwen`
- `智谱 AI`
- `Moonshot AI`
- `MiniMax`
- `硅基流动`
- `OpenRouter`
- `腾讯`
- `ByteDance`
- `小米 MiMo`
- `LongCat`

## 数据说明

- 书籍、技能、代理、工作流和应用状态由本地数据库与资源目录共同管理。
- 应用支持导出完整备份 ZIP，并恢复为完整客户端状态，包含模型配置、主代理 AGENTS、工具开关和页面偏好。
- WebDAV 云备份以完整数据包为单位进行上传和下载，跨设备恢复时沿用同一份备份范围。
