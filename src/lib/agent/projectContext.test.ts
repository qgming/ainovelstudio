import { describe, expect, it, vi } from "vitest";
import { DEFAULT_PROJECT_AGENT_PATH, loadProjectContext } from "./projectContext";

describe("project context", () => {
  it("读取工作区默认的 .project/AGENTS.md", async () => {
    const readFile = vi.fn().mockResolvedValue("# 项目规则");

    const context = await loadProjectContext({
      readFile,
      workspaceRootPath: "C:/books/北境余烬",
    });

    expect(readFile).toHaveBeenCalledWith("C:/books/北境余烬", DEFAULT_PROJECT_AGENT_PATH);
    expect(context).toEqual({
      source: "项目默认上下文",
      files: [
        {
          content: "# 项目规则",
          name: "AGENTS.md",
          path: ".project/AGENTS.md",
        },
      ],
    });
  });

  it("缺少 .project/AGENTS.md 时返回空", async () => {
    const context = await loadProjectContext({
      readFile: vi.fn().mockRejectedValue(new Error("missing")),
      workspaceRootPath: "C:/books/北境余烬",
    });

    expect(context).toBeNull();
  });
});
