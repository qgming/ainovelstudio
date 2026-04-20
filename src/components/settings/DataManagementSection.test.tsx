import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DataManagementSection } from "./DataManagementSection";
import { useDataManagementStore } from "../../stores/dataManagementStore";
import { useSkillsStore } from "../../stores/skillsStore";
import { useSubAgentStore } from "../../stores/subAgentStore";
import { useWorkflowStore } from "../../stores/workflowStore";

const { toastMock } = vi.hoisted(() => ({
  toastMock: Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
  }),
}));

vi.mock("sonner", () => ({
  toast: toastMock,
}));

vi.mock("../../hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

describe("DataManagementSection", () => {
  const initializeMock = vi.fn();
  const reinitializeSkillsMock = vi.fn();
  const reinitializeAgentsMock = vi.fn();
  const reinitializeWorkflowsMock = vi.fn();
  const refreshWorkflowStoreMock = vi.fn();
  const initializeSkillsStoreMock = vi.fn();
  const initializeAgentsStoreMock = vi.fn();

  beforeEach(() => {
    initializeMock.mockReset();
    initializeMock.mockResolvedValue(undefined);
    reinitializeSkillsMock.mockReset();
    reinitializeSkillsMock.mockResolvedValue({
      initializedSkillIds: ["builtin-skill"],
      skippedSkillIds: [],
    });
    reinitializeAgentsMock.mockReset();
    reinitializeAgentsMock.mockResolvedValue({
      initializedAgentIds: ["builtin-agent"],
      skippedAgentIds: [],
    });
    reinitializeWorkflowsMock.mockReset();
    reinitializeWorkflowsMock.mockResolvedValue({
      initializedWorkflowIds: ["builtin-workflow-a", "builtin-workflow-b"],
      skippedTemplateKeys: [],
    });
    refreshWorkflowStoreMock.mockReset();
    refreshWorkflowStoreMock.mockResolvedValue(undefined);
    initializeSkillsStoreMock.mockReset();
    initializeSkillsStoreMock.mockResolvedValue(undefined);
    initializeAgentsStoreMock.mockReset();
    initializeAgentsStoreMock.mockResolvedValue(undefined);
    toastMock.mockReset();
    toastMock.success.mockReset();
    toastMock.error.mockReset();

    useDataManagementStore.setState({
      config: {
        enabled: false,
        password: "",
        remotePath: "ainovelstudio",
        serverUrl: "",
        username: "",
      },
      errorMessage: null,
      exportBackup: vi.fn(),
      importBackup: vi.fn(),
      initialize: initializeMock,
      reinitializeAgents: reinitializeAgentsMock,
      reinitializeSkills: reinitializeSkillsMock,
      reinitializeWorkflows: reinitializeWorkflowsMock,
      saveConfig: vi.fn(),
      status: "ready",
      syncNow: vi.fn(),
    });
    useSkillsStore.setState((state) => ({ ...state, initialize: initializeSkillsStoreMock }));
    useSubAgentStore.setState((state) => ({ ...state, initialize: initializeAgentsStoreMock }));
    useWorkflowStore.setState((state) => ({ ...state, refreshList: refreshWorkflowStoreMock }));
  });

  it("展示三个重写初始化按钮", () => {
    render(<DataManagementSection />);

    expect(screen.getByText("重写初始化")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重写技能" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重写代理" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重写工作流" })).toBeInTheDocument();
  });

  it("确认后会重写工作流并刷新工作流 store", async () => {
    render(<DataManagementSection />);

    fireEvent.click(screen.getByRole("button", { name: "重写工作流" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("重写工作流初始化")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "重写工作流" }));

    await waitFor(() => {
      expect(reinitializeWorkflowsMock).toHaveBeenCalledTimes(1);
      expect(refreshWorkflowStoreMock).toHaveBeenCalledTimes(1);
    });

    expect(toastMock.success).toHaveBeenCalledWith("工作流已重写初始化", {
      description: "已重新写入 2 个内置工作流。",
    });
  });

  it("重写技能失败时会提示错误", async () => {
    reinitializeSkillsMock.mockRejectedValue(new Error("技能重写失败"));
    render(<DataManagementSection />);

    fireEvent.click(screen.getByRole("button", { name: "重写技能" }));

    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "重写技能" }));

    await waitFor(() => {
      expect(reinitializeSkillsMock).toHaveBeenCalledTimes(1);
      expect(toastMock.error).toHaveBeenCalledWith("重写初始化失败", {
        description: "技能重写失败",
      });
    });

    expect(initializeSkillsStoreMock).not.toHaveBeenCalled();
  });
});
