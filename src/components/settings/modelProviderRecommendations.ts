export type ModelProviderRecommendation = {
  id: string;
  name: string;
  provider: string;
  baseURL: string;
  websiteUrl: string;
};

export const MODEL_PROVIDER_RECOMMENDATIONS: ModelProviderRecommendation[] = [
  {
    id: "anthropic",
    name: "Claude",
    provider: "anthropic",
    baseURL: "https://api.anthropic.com/v1",
    websiteUrl: "https://console.anthropic.com/",
  },
  {
    id: "zhipu",
    name: "智谱 AI",
    provider: "zhipu",
    baseURL: "https://open.bigmodel.cn/api/paas/v4/",
    websiteUrl: "https://open.bigmodel.cn/",
  },
  {
    id: "google",
    name: "Gemini",
    provider: "google",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    websiteUrl: "https://aistudio.google.com/",
  },
  {
    id: "qwen",
    name: "Qwen",
    provider: "qwen",
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    websiteUrl: "https://bailian.console.aliyun.com/",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    provider: "deepseek",
    baseURL: "https://api.deepseek.com/v1",
    websiteUrl: "https://platform.deepseek.com/",
  },
  {
    id: "xiaomi-mimo",
    name: "小米 MiMo",
    provider: "xiaomi-mimo",
    baseURL: "https://api.xiaomimimo.com/v1",
    websiteUrl: "https://platform.xiaomimimo.com/",
  },
  {
    id: "moonshot",
    name: "Moonshot AI",
    provider: "moonshot",
    baseURL: "https://api.moonshot.cn/v1",
    websiteUrl: "https://platform.moonshot.cn/",
  },
  {
    id: "openai",
    name: "OpenAI",
    provider: "openai",
    baseURL: "https://api.openai.com/v1",
    websiteUrl: "https://platform.openai.com/",
  },
  {
    id: "bytedance",
    name: "ByteDance",
    provider: "bytedance",
    baseURL: "https://ark.cn-beijing.volces.com/api/v3",
    websiteUrl: "https://console.volcengine.com/ark",
  },
  {
    id: "siliconflow",
    name: "硅基流动",
    provider: "siliconflow",
    baseURL: "https://api.siliconflow.cn/v1",
    websiteUrl: "https://cloud.siliconflow.cn/",
  },
  {
    id: "longcat",
    name: "LongCat",
    provider: "longcat",
    baseURL: "https://api.longcat.chat/openai/v1",
    websiteUrl: "https://longcat.chat/",
  },
  {
    id: "minimax",
    name: "MiniMax",
    provider: "minimax",
    baseURL: "https://api.minimax.chat/v1",
    websiteUrl: "https://platform.minimaxi.com/",
  },
  {
    id: "tencent",
    name: "腾讯",
    provider: "tencent",
    baseURL: "https://api.lkeap.cloud.tencent.com/v1",
    websiteUrl: "https://console.cloud.tencent.com/lkeap",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    provider: "openrouter",
    baseURL: "https://openrouter.ai/api/v1",
    websiteUrl: "https://openrouter.ai/",
  },
];

