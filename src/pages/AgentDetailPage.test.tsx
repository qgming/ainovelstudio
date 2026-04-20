import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentDetailPage } from "./AgentDetailPage";
import { TooltipProvider } from "../components/ui/tooltip";
import { useSubAgentStore } from "../stores/subAgentStore";

vi.mock("../lib/agents/api", () => ({
  readAgentFileContent: vi.fn(),
  writeAgentFileContent: vi.fn(),
}));

import { readAgentFileContent } from "../lib/agents/api";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/agents/editor"]}>
      <TooltipProvider>
        <Routes>
          <Route path="/agents/:agentId" element={<AgentDetailPage />} />
        </Routes>
      </TooltipProvider>
    </MemoryRouter>,
  );
}

describe("AgentDetailPage", () => {
  beforeEach(() => {
    vi.mocked(readAgentFileContent).mockReset();
    vi.mocked(readAgentFileContent).mockImplementation(async (_agentId, relativePath) => {
      if (relativePath === "AGENTS.md") {
        return "# editor\n\n负责审稿。";
      }
      return '{\n  "id": "editor"\n}';
    });

    useSubAgentStore.setState({
      errorMessage: null,
      lastScannedAt: 1,
      manifests: [
        {
          id: "editor",
          name: "编辑",
          description: "审查叙事节奏与章节衔接",
          body: "编辑代理",
          defaultEnabled: true,
          discoveredAt: 1,
          isBuiltin: false,
          manifestFilePath: "agents/editor/manifest.json",
          sourceKind: "installed-package",
          suggestedTools: [],
          tags: ["edit"],
          validation: { errors: [], isValid: true, warnings: [] },
          role: "editor",
          dispatchHint: "当用户需要审稿时使用",
        },
      ],
      preferences: { enabledById: {} },
      status: "ready",
      toggleAgent: vi.fn(),
      deleteInstalledAgentById: vi.fn(),
      refresh: vi.fn(),
      createAgent: vi.fn(),
      hydrate: vi.fn(),
      importAgentPackage: vi.fn(),
      initialize: vi.fn(),
      reset: vi.fn(),
    });
  });

  it("只展示 manifest.json 和 AGENTS.md 文件入口", async () => {
    renderPage();

    expect(await screen.findByRole("button", { name: "manifest.json" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "AGENTS.md" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "TOOLS.md" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "MEMORY.md" })).not.toBeInTheDocument();
    expect(screen.queryByText("审查叙事节奏与章节衔接")).not.toBeInTheDocument();
  });

  it("切换文件时只读取保留的两个文件", async () => {
    renderPage();

    await waitFor(() => {
      expect(vi.mocked(readAgentFileContent)).toHaveBeenCalledWith("editor", "manifest.json");
    });

    fireEvent.click(screen.getByRole("button", { name: "AGENTS.md" }));

    await waitFor(() => {
      expect(vi.mocked(readAgentFileContent)).toHaveBeenCalledWith("editor", "AGENTS.md");
    });
  });
});
