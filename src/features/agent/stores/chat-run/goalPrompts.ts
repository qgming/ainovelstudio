// CP-F：goal「React 外循环」已退场——续轮/目标完成/协议修复判定全部内聚到
// harness 内循环（见 lib/modes/goalMode.ts 的 decideContinuation，由
// writingAgentHarnessRunner 在 turn_end 调用并以 harness.followUp 续轮）。
//
// 本文件保留与外循环无关、仍被 UI 使用的固定提示词：COACH_PROMPT（「继续/督促」按钮）、
// ORGANIZE_MEMORY_PROMPT（「整理项目记忆」按钮）。

export const COACH_PROMPT =
  "请继续执行刚才未完成的任务，从当前断点往下做即可。不要额外改变任务目标或创作要求。";

// 「整理项目记忆」按钮发送的固定指令：让当前书籍 Agent 读取 README + memory，
// 去重合并、修正 frontmatter、核对伏笔台账，并写回 .project/memory/。
export const ORGANIZE_MEMORY_PROMPT = [
  "请整理本书的项目记忆：",
  "1. 读 `.project/README.md` 与 `.project/memory/` 下全部记忆文件；",
  "2. 结合最近相关的正文 / 大纲 / 设定，去重合并、补全或修正记忆，确保每个记忆文件顶部 frontmatter（name、description 含 Use when、type、updated）正确；",
  "3. 核对伏笔台账（type: foreshadow）：把已回收的伏笔移入「已回收」，登记新出现的伏笔并标注预计回收章；",
  "4. 删除明显过期或重复的记忆，必要时新建缺失的记忆文件；更新记忆时同步其 frontmatter 的 updated；",
  "5. 完成后用一句话说明：改了哪些记忆文件、为什么。",
  "只写稳定事实，不要把临时草稿状态写进记忆。",
].join("\n");
