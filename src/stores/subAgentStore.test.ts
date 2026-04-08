import { beforeEach, describe, expect, it } from "vitest";
import { useSubAgentStore } from "./subAgentStore";

describe("subAgentStore", () => {
  beforeEach(() => {
    // 重置 store 到初始状态
    useSubAgentStore.setState({
      subAgents: useSubAgentStore.getState().subAgents.map((a) => ({
        ...a,
        enabled: a.id === "editor" || a.id === "senior-reader",
      })),
    });
  });

  it("包含 4 个内置子代理", () => {
    const { subAgents } = useSubAgentStore.getState();
    expect(subAgents).toHaveLength(4);
    expect(subAgents.map((a) => a.id)).toEqual([
      "editor",
      "senior-reader",
      "internet-critic",
      "risk-reviewer",
    ]);
  });

  it("默认启用编辑和资深读者", () => {
    const { subAgents } = useSubAgentStore.getState();
    expect(subAgents.find((a) => a.id === "editor")?.enabled).toBe(true);
    expect(subAgents.find((a) => a.id === "senior-reader")?.enabled).toBe(true);
    expect(subAgents.find((a) => a.id === "internet-critic")?.enabled).toBe(false);
    expect(subAgents.find((a) => a.id === "risk-reviewer")?.enabled).toBe(false);
  });

  it("toggleSubAgent 切换启用状态", () => {
    useSubAgentStore.getState().toggleSubAgent("internet-critic");
    expect(
      useSubAgentStore.getState().subAgents.find((a) => a.id === "internet-critic")?.enabled,
    ).toBe(true);

    useSubAgentStore.getState().toggleSubAgent("internet-critic");
    expect(
      useSubAgentStore.getState().subAgents.find((a) => a.id === "internet-critic")?.enabled,
    ).toBe(false);
  });

  it("所有子代理 source 均为 builtin", () => {
    const { subAgents } = useSubAgentStore.getState();
    expect(subAgents.every((a) => a.source === "builtin")).toBe(true);
  });
});
