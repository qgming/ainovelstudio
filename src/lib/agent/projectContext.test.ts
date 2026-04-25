import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PROJECT_AGENT_PATH,
  DEFAULT_PROJECT_README_PATH,
  DEFAULT_PROJECT_STATUS_PATH,
  loadProjectContext,
} from "./projectContext";

describe("project context", () => {
  it("读取工作区默认的 .project/AGENTS.md、.project/README.md 和状态真值层 JSON", async () => {
    const readFile = vi.fn().mockResolvedValue("# 项目规则");
    const readTree = vi.fn().mockResolvedValue({
      children: [
        {
          children: [
            {
              kind: "file",
              name: "README.md",
              path: DEFAULT_PROJECT_README_PATH,
            },
            {
              children: [
                {
                  kind: "file",
                  name: "latest-plot.json",
                  path: `${DEFAULT_PROJECT_STATUS_PATH}/latest-plot.json`,
                },
              ],
              kind: "directory",
              name: "status",
              path: DEFAULT_PROJECT_STATUS_PATH,
            },
            {
              kind: "file",
              name: "AGENTS.md",
              path: DEFAULT_PROJECT_AGENT_PATH,
            },
          ],
          kind: "directory",
          name: ".project",
          path: ".project",
        },
      ],
    });
    readFile.mockImplementation(async (_rootPath: string, path: string) =>
      path === DEFAULT_PROJECT_AGENT_PATH
        ? "# 项目规则"
        : path === DEFAULT_PROJECT_README_PATH
          ? "# 项目说明\n\n主角目标：活下去。"
          : '{"chapter": 12}',
    );

    const context = await loadProjectContext({
      readFile,
      readTree,
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
        {
          content: "# 项目说明\n\n主角目标：活下去。",
          name: "README.md",
          path: ".project/README.md",
        },
        {
          content: '{"chapter": 12}',
          name: "latest-plot.json",
          path: ".project/status/latest-plot.json",
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

  it("缺少 AGENTS 时仍会回退到状态 JSON 作为默认上下文", async () => {
    const readFile = vi.fn().mockImplementation(async (_rootPath: string, path: string) => {
      if (path === DEFAULT_PROJECT_AGENT_PATH || path === DEFAULT_PROJECT_README_PATH) {
        throw new Error("missing");
      }
      return '{"arc":"trial"}';
    });
    const readTree = vi.fn().mockResolvedValue({
      children: [
        {
          children: [
            {
              children: [
                {
                  kind: "file",
                  name: "project-state.json",
                  path: `${DEFAULT_PROJECT_STATUS_PATH}/project-state.json`,
                },
              ],
              kind: "directory",
              name: "status",
              path: DEFAULT_PROJECT_STATUS_PATH,
            },
          ],
          kind: "directory",
          name: ".project",
          path: ".project",
        },
      ],
    });

    const context = await loadProjectContext({
      readFile,
      readTree,
      workspaceRootPath: "C:/books/北境余烬",
    });

    expect(context).toEqual({
      source: "项目默认上下文",
      files: [
        {
          content: '{"arc":"trial"}',
          name: "project-state.json",
          path: ".project/status/project-state.json",
        },
      ],
    });
  });

  it("缺少 AGENTS 和状态时仍会注入 README", async () => {
    const readFile = vi.fn().mockImplementation(async (_rootPath: string, path: string) => {
      if (path === DEFAULT_PROJECT_README_PATH) {
        return "# 项目说明\n\n当前重点：先补设定。";
      }
      throw new Error("missing");
    });

    const context = await loadProjectContext({
      readFile,
      workspaceRootPath: "C:/books/北境余烬",
    });

    expect(context).toEqual({
      source: "项目默认上下文",
      files: [
        {
          content: "# 项目说明\n\n当前重点：先补设定。",
          name: "README.md",
          path: ".project/README.md",
        },
      ],
    });
  });
});
