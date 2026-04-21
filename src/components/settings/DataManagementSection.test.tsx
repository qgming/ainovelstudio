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

const { applyAppClientStateAndReloadMock } = vi.hoisted(() => ({
  applyAppClientStateAndReloadMock: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: toastMock,
}));

vi.mock("../../lib/dataManagement/clientState", () => ({
  applyAppClientStateAndReload: applyAppClientStateAndReloadMock,
}));

vi.mock("../../hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

describe("DataManagementSection", () => {
  const downloadCloudBackupMock = vi.fn();
  const initializeMock = vi.fn();
  const reinitializeSkillsMock = vi.fn();
  const reinitializeAgentsMock = vi.fn();
  const reinitializeWorkflowsMock = vi.fn();
  const refreshWorkflowStoreMock = vi.fn();
  const initializeSkillsStoreMock = vi.fn();
  const initializeAgentsStoreMock = vi.fn();
  const uploadCloudBackupMock = vi.fn();

  beforeEach(() => {
    downloadCloudBackupMock.mockReset();
    downloadCloudBackupMock.mockResolvedValue({
      clientState: { entries: {}, updatedAt: 123 },
      restoredAt: 123,
    });
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
    uploadCloudBackupMock.mockReset();
    uploadCloudBackupMock.mockResolvedValue({
      localUpdatedAt: 123,
      remoteUpdatedAt: 120,
    });
    toastMock.mockReset();
    toastMock.success.mockReset();
    toastMock.error.mockReset();
    applyAppClientStateAndReloadMock.mockReset();

    useDataManagementStore.setState({
      config: {
        enabled: false,
        password: "",
        remotePath: "ainovelstudio",
        serverUrl: "",
        username: "",
      },
      downloadCloudBackup: downloadCloudBackupMock,
      errorMessage: null,
      exportBackup: vi.fn(),
      importBackup: vi.fn(),
      initialize: initializeMock,
      reinitializeAgents: reinitializeAgentsMock,
      reinitializeSkills: reinitializeSkillsMock,
      reinitializeWorkflows: reinitializeWorkflowsMock,
      saveConfig: vi.fn(),
      status: "ready",
      uploadCloudBackup: uploadCloudBackupMock,
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

  it("展示上传和下载云备份按钮", () => {
    useDataManagementStore.setState((state) => ({
      ...state,
      config: {
        ...state.config,
        serverUrl: "https://dav.example.com",
      },
    }));

    render(<DataManagementSection />);

    expect(screen.getByText("云备份")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上传云备份" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下载云备份" })).toBeInTheDocument();
  });

  it("确认后会下载云备份并提示刷新", async () => {
    useDataManagementStore.setState((state) => ({
      ...state,
      config: {
        ...state.config,
        serverUrl: "https://dav.example.com",
      },
    }));

    render(<DataManagementSection />);

    fireEvent.click(screen.getByRole("button", { name: "下载云备份" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("下载后会用云端备份覆盖当前本地数据，并在完成后刷新应用。请确认本地数据已经完成备份。")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "覆盖并下载" }));

    await waitFor(() => {
      expect(downloadCloudBackupMock).toHaveBeenCalledTimes(1);
      expect(toastMock.success).toHaveBeenCalledWith("云备份已下载", {
        description: "应用将刷新为云端备份内容。",
      });
      expect(applyAppClientStateAndReloadMock).toHaveBeenCalledWith({ entries: {}, updatedAt: 123 });
    });
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
