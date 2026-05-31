import { describe, expect, it } from "vitest";
import { parsePseudoJson } from "./pseudoJsonParse";

describe("parsePseudoJson", () => {
  it("解析标准 JSON 不出错", () => {
    const input = JSON.stringify({ a: 1, b: [2, 3], c: { d: "e" } });
    expect(parsePseudoJson(input)).toEqual({ a: 1, b: [2, 3], c: { d: "e" } });
  });

  it("解析缺失逗号的对象", () => {
    const input = '{"a":1\n"b":2}';
    expect(parsePseudoJson(input)).toEqual({ a: 1, b: 2 });
  });

  it("解析键与冒号、值分多行的对象", () => {
    const input = '{\n"id"\n:\n"x"\n}';
    expect(parsePseudoJson(input)).toEqual({ id: "x" });
  });

  it("解析 [0: value 1: value] 索引化数组", () => {
    const input = '[\n0\n:\n{"a":1}\n1\n:\n{"b":2}\n]';
    expect(parsePseudoJson(input)).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("解析嵌套字符串中未转义的双引号（短样本）", () => {
    const input = '{"arguments":"{"path":"a.md"}"\n"name":"x"}';
    const result = parsePseudoJson(input);
    expect(result).toEqual({
      arguments: '{"path":"a.md"}',
      name: "x",
    });
  });

  it("解析非标准 JSON 时不抛异常", () => {
    expect(parsePseudoJson("")).toBeNull();
    expect(parsePseudoJson("not json")).toBeNull();
    expect(parsePseudoJson("{")).toBeNull();
  });

  it("解析真实样本 1（用户提供：workspace_read 成功被识别）", () => {
    const input = `{
"id":"resp_04317e061f5eadb8016a0f03c..."
"choices"
:
[
0
:
{
"index":0
"message"
:
{
"role":"assistant"
"tool_calls"
:
[
0
:
{
"id":"call_DWmLBcqRDeZfLzcgnYmiiLku"
"type":"function"
"function"
:
{
"name":"workspace_read"
"arguments":"{"afterLines":0,"anchor":"","beforeLines":0,"caseSensitive":false,"endLine":1,"heading":"","limit":20,"mode":"head","occurrence":1,"path":"正文/第015章_你们只管修炼剩下的交给我.md","startLine":1}"
}
"index":0
}
]
"reasoning_content":"**Planning chapter writing** I need to continue."
}
"finish_reason":"tool_calls"
}
]
"object":"chat.completion"
"created":1779368909
"model":"gpt-5.5"
}`;
    const result = parsePseudoJson(input) as Record<string, unknown>;
    expect(result).toBeTruthy();
    expect(result.object).toBe("chat.completion");
    expect(result.model).toBe("gpt-5.5");
    const choices = result.choices as Array<Record<string, unknown>>;
    expect(choices).toHaveLength(1);
    const message = choices[0].message as Record<string, unknown>;
    const toolCalls = message.tool_calls as Array<Record<string, unknown>>;
    expect(toolCalls).toHaveLength(1);
    const fn = toolCalls[0].function as Record<string, unknown>;
    expect(fn.name).toBe("workspace_read");
    const argsParsed = JSON.parse(fn.arguments as string);
    expect(argsParsed.path).toBe("正文/第015章_你们只管修炼剩下的交给我.md");
    expect(argsParsed.mode).toBe("head");
  });

  it("解析真实样本 2（用户提供：workspace_write 含大段中文小说内容）", () => {
    const novelContent = "# 第015章\n\n姜兆军站在演武场边上。\n\n他说：\"宗主好。\"\n林小雨答道：\"好的。\"";
    // 关键：模拟伪 JSON 中 arguments 字段不转义内部双引号
    const argsRaw = `{"action":"replace","content":"${novelContent}","path":"正文/第015章.md"}`;
    const input = `{
"id":"resp_test_write"
"choices"
:
[
0
:
{
"index":0
"message"
:
{
"role":"assistant"
"tool_calls"
:
[
0
:
{
"id":"call_write"
"type":"function"
"function"
:
{
"name":"workspace_write"
"arguments":"${argsRaw}"
}
"index":0
}
]
}
}
]
"object":"chat.completion"
"created":1779369155
"model":"gpt-5.5"
}`;
    const result = parsePseudoJson(input) as Record<string, unknown>;
    expect(result).toBeTruthy();
    expect(result.object).toBe("chat.completion");
    const choices = result.choices as Array<Record<string, unknown>>;
    const message = choices[0].message as Record<string, unknown>;
    const toolCalls = message.tool_calls as Array<Record<string, unknown>>;
    const fn = toolCalls[0].function as Record<string, unknown>;
    expect(fn.name).toBe("workspace_write");
    // arguments 是字符串，内部应保留原样
    expect(fn.arguments).toContain("\"path\":\"正文/第015章.md\"");
    expect(fn.arguments).toContain("姜兆军站在演武场边上");
  });

  it("不接受空输入或非对象/数组起始", () => {
    expect(parsePseudoJson("hello world")).toBeNull();
    expect(parsePseudoJson("123")).toBeNull();
    expect(parsePseudoJson("\"foo\"")).toBeNull();
  });

  it("解析用户提供的完整长篇真实样本（含 3000+ 字中文小说内容、含中英文混排引号、\\n 换行）", () => {
    // 模拟用户实际遇到的最复杂场景：
    // - 缺逗号 / [0: ...] 索引数组 / 键值分行
    // - arguments 内含未转义的双引号（中文小说里的人名对话）
    // - 含未转义换行符（\n 直接出现在字符串内）
    const novel = [
      "# 第015章 你们只管修炼剩下的交给我",
      "",
      "姜兆军站在演武场边上，看了半天，终于确认一件事。",
      "",
      "落霞宗现在最大的问题，不是没人。",
      "是地方太小。",
      "",
      "林小雨一剑劈出去，剑气刚飞出三丈，就被旁边张大力一拳打散。",
      "“宗主。”",
      "“嗯？”",
      "“要不……我们分批练？”",
      "",
      "姜兆军看了一眼脚下这块演武场。",
    ].join("\\n");
    const argsRaw = `{"action":"replace","content":"${novel}","path":"正文/第015章_你们只管修炼剩下的交给我.md"}`;
    const input = `{
"id":"resp_047036eae7d82713016a0f04c..."
"choices"
:
[
0
:
{
"index":0
"message"
:
{
"role":"assistant"
"tool_calls"
:
[
0
:
{
"id":"call_8lzRNnaQDOn1vFUmBnPmyFvO"
"type":"function"
"function"
:
{
"name":"workspace_write"
"arguments":"${argsRaw}"
}
"index":0
}
]
"reasoning_content":"**Planning chapter writing** I need to continue."
}
}
]
"object":"chat.completion"
"created":1779369155
"model":"gpt-5.5"
}`;
    const result = parsePseudoJson(input) as Record<string, unknown>;
    expect(result).toBeTruthy();
    expect(result.object).toBe("chat.completion");
    expect(result.model).toBe("gpt-5.5");
    const choices = result.choices as Array<Record<string, unknown>>;
    expect(choices).toHaveLength(1);
    const message = choices[0].message as Record<string, unknown>;
    expect(message.role).toBe("assistant");
    const toolCalls = message.tool_calls as Array<Record<string, unknown>>;
    expect(toolCalls).toHaveLength(1);
    const fn = toolCalls[0].function as Record<string, unknown>;
    expect(fn.name).toBe("workspace_write");
    const args = fn.arguments as string;
    // arguments 是字符串：内部含裸换行（伪 JSON 不转义换行），不强求标准 JSON.parse
    // 关键：用 pseudoJsonParse 二次解析能拿出结构（这正是 providerApi 兜底链路要做的）
    const parsedArgs = parsePseudoJson(args) as Record<string, unknown>;
    expect(parsedArgs).toBeTruthy();
    expect(parsedArgs.action).toBe("replace");
    expect(parsedArgs.path).toBe("正文/第015章_你们只管修炼剩下的交给我.md");
    expect(parsedArgs.content).toContain("姜兆军");
    expect(parsedArgs.content).toContain("“宗主。”");
  });

  it("解析包含 usage 子对象的样本（保留 usage 字段）", () => {
    const input = `{
"id":"x"
"choices":[]
"object":"chat.completion"
"created":1
"model":"m"
"usage"
:
{
"prompt_tokens":38596
"completion_tokens":105
"total_tokens":38701
"prompt_tokens_details"
:
{
"audio_tokens":0
"cached_tokens":37888
}
}
}`;
    const result = parsePseudoJson(input) as Record<string, unknown>;
    expect(result).toBeTruthy();
    const usage = result.usage as Record<string, unknown>;
    expect(usage.prompt_tokens).toBe(38596);
    expect(usage.completion_tokens).toBe(105);
    expect((usage.prompt_tokens_details as Record<string, unknown>).cached_tokens).toBe(37888);
  });

  it("解析 arguments 内含 ASCII 双引号对白的真实失败样本（回归测试）", () => {
    // 这是用户实际复现的失败样本简化版：
    // arguments 内 content 字段含 \"地、地动了？\" 这种用 ASCII " 包起来的对白，
    // 旧版"括号深度+引号配对"启发式会被这些裸引号击穿。
    const input = `{
"id":"resp_test"
"choices"
:
[
0
:
{
"index":0
"message"
:
{
"role":"assistant"
"tool_calls"
:
[
0
:
{
"id":"call_X"
"type":"function"
"function"
:
{
"name":"workspace_write"
"arguments":"{"action":"append","content":"林小雨喊道："地动了？"陈风看着东侧："是灵气在聚。""}"
}
"index":0
}
]
}
}
]
"object":"chat.completion"
"created":1779377528
"model":"gpt-5.5"
}`;
    const result = parsePseudoJson(input) as Record<string, unknown>;
    expect(result).toBeTruthy();
    expect(result.object).toBe("chat.completion");
    const choices = result.choices as Array<Record<string, unknown>>;
    expect(choices).toHaveLength(1);
    const message = choices[0].message as Record<string, unknown>;
    const toolCalls = message.tool_calls as Array<Record<string, unknown>>;
    expect(toolCalls).toHaveLength(1);
    const fn = toolCalls[0].function as Record<string, unknown>;
    expect(fn.name).toBe("workspace_write");
    const args = fn.arguments as string;
    // 关键：尽管内容里有裸引号，整段 arguments 必须被完整保留
    expect(args).toContain("林小雨喊道");
    expect(args).toContain("地动了？");
    expect(args).toContain("陈风看着东侧");
    expect(args).toContain("是灵气在聚");
  });

  it("解析 arguments 内 JSON 缺右括号 + 含 ASCII 引号的最棘手样本（回归测试 — 用户实际失败样本）", () => {
    // 用户实际复现的"无法识别"场景：
    // - 缺逗号 / [0: ...] 索引数组 / 键值分行
    // - arguments 是字符串值，内部 JSON 没有闭合 }（LLM 输出截止在内容末尾）
    // - 内容里大量使用 ASCII " 作为中文对白引号
    // 旧版基于"引号配对 + 严格括号计数"的启发式无法处理；
    // 新版用"反向锚定 + 容错括号搜索 (findSubstructureEnd)"解决。
    const input = `{
"id":"resp_08fc8438b68eeb33016a0f257..."
"choices"
:
[
0
:
{
"index":0
"message"
:
{
"role":"assistant"
"tool_calls"
:
[
0
:
{
"id":"call_IYYtgUAkbBNmmmz85w4kIP02"
"type":"function"
"function"
:
{
"name":"workspace_write"
"arguments":"{"action":"append","content":"\\n\\n山门口正在登记的少年少女全都抬起头。\\n\\n林小雨手里的笔一歪，在纸上划出一道长线。\\n\\n"地、地动了？"\\n\\n"不像。"陈风看向山腰东侧，"是灵气在往那边聚。"\\n\\n姜兆军站在宗主院前，看着东侧旧药田。"
}
"index":0
}
]
}
}
]
"object":"chat.completion"
"created":1779377528
"model":"gpt-5.5"
}`;
    const result = parsePseudoJson(input) as Record<string, unknown>;
    expect(result).toBeTruthy();
    expect(result.object).toBe("chat.completion");
    expect(result.model).toBe("gpt-5.5");
    expect(result.created).toBe(1779377528);
    const choices = result.choices as Array<Record<string, unknown>>;
    expect(choices).toHaveLength(1);
    const message = choices[0].message as Record<string, unknown>;
    expect(message.role).toBe("assistant");
    const toolCalls = message.tool_calls as Array<Record<string, unknown>>;
    expect(toolCalls).toHaveLength(1);
    const fn = toolCalls[0].function as Record<string, unknown>;
    expect(fn.name).toBe("workspace_write");
    const args = fn.arguments as string;
    expect(args).toContain("山门口正在登记");
    expect(args).toContain("地、地动了？");
    expect(args).toContain("不像");
    expect(args).toContain("陈风看向山腰东侧");
    expect(args).toContain("姜兆军站在宗主院前");
  });

  it("解析嵌套对象/数组内的字符串字段，即使含裸引号也不会越界", () => {
    // 防止 advancePastString 在 bracketDepth>0 时把内部引号误判为字符串结束
    const input = `{
"a":{"b":"包含 "嵌套引号" 的内容"}
"c":"普通值"
}`;
    const result = parsePseudoJson(input) as Record<string, unknown>;
    expect(result).toBeTruthy();
    expect(result.c).toBe("普通值");
    const a = result.a as Record<string, unknown>;
    expect(a.b).toContain("包含");
    expect(a.b).toContain("的内容");
  });

  it("超大输入直接返回 null 避免炸内存", () => {
    // 构造刚超过 MAX_PSEUDO_JSON_INPUT_CHARS = 64M 的输入
    // 用 padStart 一次性分配字符串，避免 repeat 累积造成 CI OOM
    const overLimit = "{".padEnd(64 * 1024 * 1024 + 16, " ") + "}";
    expect(parsePseudoJson(overLimit)).toBeNull();
  });
});
