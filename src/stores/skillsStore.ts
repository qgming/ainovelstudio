import { create } from "zustand";

const STORAGE_KEY = "ainovelstudio-skills";

export type SkillDefinition = {
  description: string;
  enabled: boolean;
  id: string;
  name: string;
  source: "builtin" | "imported";
  suggestedTools: string[];
  systemPrompt: string;
};

type SkillsState = {
  builtinSkills: SkillDefinition[];
  importedSkills: SkillDefinition[];
};

type SkillsActions = {
  reset: () => void;
  toggleSkill: (skillId: string) => void;
};

export type SkillsStore = SkillsState & SkillsActions;

function getDefaultSkills(): SkillsState {
  return {
    builtinSkills: [
      {
        id: "worldbuilding",
        name: "世界观构建",
        description: "补全势力结构、地理设定和历史暗线，确保世界观内部一致性",
        enabled: false,
        source: "builtin",
        suggestedTools: ["read_file", "write_file"],
        systemPrompt:
          "你是世界观架构师。你的任务是审视和补全小说的世界观体系，包括势力分布、地理格局、历史脉络和魔法/科技体系。确保所有设定之间逻辑自洽，标记矛盾点并提出修复方案。输出格式：先列出现有设定摘要，再逐项检查一致性，最后给出补全建议。",
      },
      {
        id: "chapter-outline",
        name: "章节大纲",
        description: "规划章节结构、场景转换节奏和悬念布局",
        enabled: false,
        source: "builtin",
        suggestedTools: ["read_file", "list_directory"],
        systemPrompt:
          "你是章节规划师。你的任务是为小说设计章节级别的结构大纲，包括每章的核心冲突、场景切换节奏、悬念钩子和情感弧线。确保每一章都有明确的叙事目标和推进动力。输出格式：章节编号 → 核心事件 → 场景列表 → 悬念点 → 与前后章的衔接。",
      },
      {
        id: "style-control",
        name: "文风控制",
        description: "统一叙述腔调、句式密度和修辞风格，保持全书文风一致",
        enabled: false,
        source: "builtin",
        suggestedTools: ["read_file", "write_file"],
        systemPrompt:
          "你是文风把控者。你的任务是分析和统一小说的叙述腔调，包括句式长短搭配、修辞密度、叙事视角一致性和用词层次。对比不同章节的文风差异，标注偏离基准的段落并提供改写建议。保持作者原有风格意图的同时消除不协调感。",
      },
      {
        id: "character-voice",
        name: "角色语气",
        description: "强化角色区分度，确保每个人物的对话和内心独白有独特纹理",
        enabled: false,
        source: "builtin",
        suggestedTools: ["read_file", "write_file"],
        systemPrompt:
          "你是角色塑造师。你的任务是审查和强化每个角色的语言特征，包括口头禅、句式偏好、用词习惯和情绪表达方式。确保读者仅通过对话就能辨识说话人。对比角色语言档案，标注语气趋同的段落并提供区分度更高的改写方案。",
      },
    ],
    importedSkills: [],
  };
}

function readSkillsState(): SkillsState {
  if (typeof window === "undefined") {
    return getDefaultSkills();
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return getDefaultSkills();
    }

    return { ...getDefaultSkills(), ...(JSON.parse(raw) as Partial<SkillsState>) };
  } catch {
    return getDefaultSkills();
  }
}

function persistSkillsState(state: SkillsState) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function getEnabledSkills(state: SkillsState) {
  return [...state.builtinSkills, ...state.importedSkills].filter((skill) => skill.enabled);
}

export const useSkillsStore = create<SkillsStore>((set) => ({
  ...readSkillsState(),
  reset: () => {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(STORAGE_KEY);
    }

    set(getDefaultSkills());
  },
  toggleSkill: (skillId) =>
    set((state) => {
      const nextState = {
        builtinSkills: state.builtinSkills.map((skill) =>
          skill.id === skillId ? { ...skill, enabled: !skill.enabled } : skill,
        ),
        importedSkills: state.importedSkills.map((skill) =>
          skill.id === skillId ? { ...skill, enabled: !skill.enabled } : skill,
        ),
      };

      persistSkillsState(nextState);
      return nextState;
    }),
}));
