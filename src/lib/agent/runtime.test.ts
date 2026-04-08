import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentRuntime } from "./runtime";

const readFile = vi.fn().mockResolvedValue("初稿内容");

describe("agent runtime", () => {
  beforeEach(() => {
    readFile.mockClear();
  });

  it("运行工具并生成工具结果消息", async () => {
    const runtime = createAgentRuntime({
      tools: {
        read_file: {
          description: "读取文件",
          execute: async () => {
            const content = await readFile();
            return { ok: true, summary: content };
          },
        },
      },
    });

    const result = await runtime.runTool("read_file", {});

    expect(readFile).toHaveBeenCalledTimes(1);
    expect(result.summary).toBe("初稿内容");
  });
});
