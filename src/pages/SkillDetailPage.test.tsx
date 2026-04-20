import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "../components/ui/tooltip";
import { readSkillFileContent } from "../lib/skills/api";
import { SkillDetailPage } from "./SkillDetailPage";
import { useSkillsStore } from "../stores/skillsStore";

vi.mock("../lib/skills/api", () => ({
  readSkillFileContent: vi.fn(),
  writeSkillFileContent: vi.fn(),
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/skills/story-state"]}>
      <TooltipProvider>
        <Routes>
          <Route path="/skills/:skillId" element={<SkillDetailPage />} />
        </Routes>
      </TooltipProvider>
    </MemoryRouter>,
  );
}

describe("SkillDetailPage", () => {
  beforeEach(() => {
    vi.mocked(readSkillFileContent).mockReset();
    vi.mocked(readSkillFileContent).mockImplementation(async (_skillId, relativePath) => {
      if (relativePath === "references/state-files.md") {
        return "# state-files";
      }
      if (relativePath === "templates/latest-plot.template.json") {
        return '{\n  "chapter": 12\n}';
      }
      return "# story-state";
    });

    useSkillsStore.setState({
      errorMessage: null,
      lastScannedAt: 1,
      manifests: [
        {
          body: "技能正文",
          defaultEnabled: true,
          description: "管理剧情状态与模板文件",
          discoveredAt: 1,
          id: "story-state",
          isBuiltin: false,
          name: "story-state",
          rawMarkdown: "---\nname: story-state\n---\n技能正文",
          references: [
            {
              name: "state-files.md",
              path: "references/state-files.md",
              size: 1,
            },
          ],
          sourceKind: "installed-package",
          suggestedTools: [],
          tags: ["state"],
          templates: [
            {
              name: "latest-plot.template.json",
              path: "templates/latest-plot.template.json",
              size: 1,
            },
          ],
          validation: {
            errors: [],
            isValid: true,
            warnings: [],
          },
        },
      ],
      preferences: { enabledById: {} },
      status: "ready",
      toggleSkill: vi.fn(),
      deleteInstalledSkillById: vi.fn(),
      createReferenceFile: vi.fn(),
      refresh: vi.fn(),
      createSkill: vi.fn(),
      hydrate: vi.fn(),
      importSkillPackage: vi.fn(),
      initialize: vi.fn(),
      reset: vi.fn(),
    });
  });

  it("显示参考文献和模板分组，并按真实路径读取文件", async () => {
    renderPage();

    await waitFor(() => {
      expect(vi.mocked(readSkillFileContent)).toHaveBeenCalledWith("story-state", "SKILL.md");
    });

    expect(screen.getByText("参考文献")).toBeInTheDocument();
    expect(screen.getByText("模板")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "state-files.md" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "latest-plot.template.json" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "latest-plot.template.json" }));

    await waitFor(() => {
      expect(vi.mocked(readSkillFileContent)).toHaveBeenCalledWith(
        "story-state",
        "templates/latest-plot.template.json",
      );
    });
  });
});
