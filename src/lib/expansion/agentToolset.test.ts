import { beforeEach, describe, expect, it, vi } from "vitest";
import { createExpansionAgentToolset } from "./agentToolset";

const apiMocks = vi.hoisted(() => ({
  getExpansionWorkspaceDetail: vi.fn(),
  readExpansionEntry: vi.fn(),
  writeExpansionEntry: vi.fn(),
  createExpansionEntry: vi.fn(),
  renameExpansionEntry: vi.fn(),
  deleteExpansionEntry: vi.fn(),
}));

vi.mock("./api", () => apiMocks);

describe("createExpansionAgentToolset", () => {
  beforeEach(() => {
    apiMocks.getExpansionWorkspaceDetail.mockReset();
    apiMocks.readExpansionEntry.mockReset();
    apiMocks.writeExpansionEntry.mockReset();
    apiMocks.createExpansionEntry.mockReset();
    apiMocks.renameExpansionEntry.mockReset();
    apiMocks.deleteExpansionEntry.mockReset();
  });

  it("json 工具支持对章节正文属性追加文本", async () => {
    apiMocks.readExpansionEntry.mockResolvedValue(
      `${JSON.stringify({
        id: "1",
        name: "第一章",
        outline: "## 情节点\n\n- 旧细纲",
        content: "第一段正文",
      }, null, 2)}\n`,
    );

    const tools = createExpansionAgentToolset({ workspaceId: "workspace-1" });
    const result = await tools.json.execute({
      action: "text_append",
      path: "chapters/001/第一章",
      pointer: "/content",
      separator: "\n\n",
      value: "第二段正文",
    });

    expect(apiMocks.writeExpansionEntry).toHaveBeenCalledWith(
      "workspace-1",
      "chapters",
      "001/第一章",
      expect.stringContaining('"content": "第一段正文\\n\\n第二段正文"'),
    );
    expect(apiMocks.writeExpansionEntry.mock.calls[0]?.[3]).toContain(
      '"outline": "## 情节点\\n\\n- 旧细纲"',
    );
    expect(result).toEqual({
      ok: true,
      summary: "已更新 chapters/001/第一章 中 /content 的 JSON 数据。",
      data: {
        action: "text_append",
        path: "chapters/001/第一章",
        pointer: "/content",
        value: "第一段正文\n\n第二段正文",
      },
    });
  });
});
