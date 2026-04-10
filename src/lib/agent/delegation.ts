import type { ResolvedAgent } from "../../stores/subAgentStore";

const EXPLICIT_DELEGATION_PATTERNS = [/子代理/u, /委派/u, /交给/u, /让.+代理/u, /请.+代理/u, /调用.+代理/u, /由.+代理/u];
const SPECIALIST_TASK_KEYWORDS = [
  "分析",
  "审稿",
  "校对",
  "诊断",
  "评估",
  "规划",
  "梳理",
  "提炼",
  "设定",
  "世界观",
  "人物",
  "动机",
  "冲突",
  "节奏",
  "大纲",
  "结构",
  "润色",
];

type AgentMatch = {
  agent: ResolvedAgent;
  score: number;
};

function includesText(source: string, target: string | null | undefined) {
  return Boolean(target && source.includes(target.toLowerCase()));
}

function computeAgentScore(prompt: string, agent: ResolvedAgent) {
  let score = 0;

  if (includesText(prompt, agent.name)) {
    score += 5;
  }

  if (includesText(prompt, agent.role)) {
    score += 3;
  }

  const matchedTags = agent.tags.filter((tag) => includesText(prompt, tag));
  score += matchedTags.length * 3;

  return score;
}

function hasExplicitDelegationIntent(prompt: string) {
  return EXPLICIT_DELEGATION_PATTERNS.some((pattern) => pattern.test(prompt));
}

function hasSpecialistIntent(prompt: string) {
  return SPECIALIST_TASK_KEYWORDS.some((keyword) => prompt.includes(keyword.toLowerCase()));
}

export function selectSubAgentForPrompt(prompt: string, enabledAgents: ResolvedAgent[]) {
  if (enabledAgents.length === 0) {
    return null;
  }

  const normalizedPrompt = prompt.toLowerCase();
  const matches: AgentMatch[] = enabledAgents.map((agent) => ({
    agent,
    score: computeAgentScore(normalizedPrompt, agent),
  }));
  const bestMatch = [...matches].sort((left, right) => right.score - left.score)[0] ?? null;

  if (!bestMatch) {
    return null;
  }

  if (hasExplicitDelegationIntent(prompt)) {
    if (bestMatch.score > 0) {
      return bestMatch.agent;
    }
    return enabledAgents.length === 1 ? enabledAgents[0] : null;
  }

  if (bestMatch.score >= 6) {
    return bestMatch.agent;
  }

  if (bestMatch.score >= 3 && hasSpecialistIntent(normalizedPrompt)) {
    return bestMatch.agent;
  }

  return null;
}
