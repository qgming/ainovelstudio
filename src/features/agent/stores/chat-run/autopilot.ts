// CP-F：autopilot「React 外循环」已退场——续轮/目标完成/协议修复判定全部内聚到
// harness 内循环（见 lib/modes/autopilotMode.ts 的 decideContinuation，由
// writingAgentHarnessRunner 在 turn_end 调用并以 harness.followUp 续轮）。
//
// 本文件仅保留与外循环无关、仍被 UI 使用的 COACH_PROMPT（用户「继续/督促」按钮）。

export const COACH_PROMPT =
  "请继续执行刚才未完成的任务，从当前断点往下做即可。不要额外改变任务目标或创作要求。";
