import { create } from "zustand";
import { persist } from "zustand/middleware";

/** 子代理定义 */
export type SubAgentDefinition = {
  /** 唯一标识 */
  id: string;
  /** 显示名称 */
  name: string;
  /** 一句话角色定位 */
  role: string;
  /** 详细说明 */
  description: string;
  /** 是否启用 */
  enabled: boolean;
  /** 来源 */
  source: "builtin" | "imported";
  /** lucide 图标名 */
  avatar: string;
};

type SubAgentState = {
  subAgents: SubAgentDefinition[];
  toggleSubAgent: (id: string) => void;
};

const builtinSubAgents: SubAgentDefinition[] = [
  {
    id: "editor",
    name: "编辑",
    role: "审查叙事节奏、结构完整性和章节衔接",
    description:
      "从专业编辑视角审视稿件，检查叙事节奏是否流畅、章节之间的衔接是否自然、故事结构是否完整。标注冗余段落、断裂的伏笔和需要补充的过渡场景。",
    enabled: true,
    source: "builtin",
    avatar: "PenLine",
  },
  {
    id: "senior-reader",
    name: "资深读者",
    role: "以深度读者视角评估沉浸感和情感张力",
    description:
      "模拟资深读者的阅读体验，评估故事的沉浸感、情感张力和角色共情度。指出让人出戏的情节、薄弱的情感高潮和缺乏吸引力的段落。",
    enabled: true,
    source: "builtin",
    avatar: "BookOpen",
  },
  {
    id: "internet-critic",
    name: "网络喷子",
    role: "模拟苛刻读者挑刺，找出逻辑漏洞和尬点",
    description:
      "以最挑剔的网络读者身份审阅，专门寻找逻辑漏洞、不合理设定、尴尬对话和令人出戏的情节。用犀利但有建设性的方式指出问题。",
    enabled: false,
    source: "builtin",
    avatar: "MessageCircleWarning",
  },
  {
    id: "risk-reviewer",
    name: "风险审核",
    role: "检查敏感内容、政策合规和出版风险",
    description:
      "扫描文本中的敏感内容、潜在政策违规和出版风险点。覆盖暴力尺度、意识形态表达、版权风险和平台审核红线。",
    enabled: false,
    source: "builtin",
    avatar: "ShieldAlert",
  },
];

export const useSubAgentStore = create<SubAgentState>()(
  persist(
    (set) => ({
      subAgents: builtinSubAgents,
      toggleSubAgent: (id) =>
        set((state) => ({
          subAgents: state.subAgents.map((agent) =>
            agent.id === id ? { ...agent, enabled: !agent.enabled } : agent,
          ),
        })),
    }),
    { name: "ainovelstudio-subagents" },
  ),
);
