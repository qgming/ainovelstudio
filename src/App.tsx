import { useEffect } from "react";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { Sidebar } from "./components/Sidebar";
import { TitleBar } from "./components/TitleBar";
import { AgentDetailPage } from "./pages/AgentDetailPage";
import { AgentsPage } from "./pages/AgentsPage";
import { BookPage } from "./pages/BookPage";
import { SettingPage } from "./pages/SettingPage";
import { SkillDetailPage } from "./pages/SkillDetailPage";
import { SkillsPage } from "./pages/SkillsPage";
import { useAgentSettingsStore } from "./stores/agentSettingsStore";
import { useAgentStore } from "./stores/agentStore";
import { useThemeStore } from "./stores/themeStore";
import { useSkillsStore } from "./stores/skillsStore";
import { useSubAgentStore } from "./stores/subAgentStore";

function AppShell() {
  const initializeTheme = useThemeStore((state) => state.initializeTheme);
  const initializeSkills = useSkillsStore((state) => state.initialize);
  const initializeAgents = useSubAgentStore((state) => state.initialize);
  const initializeAgentSettings = useAgentSettingsStore((state) => state.initialize);
  const initializeAgentHistory = useAgentStore((state) => state.initialize);

  useEffect(() => {
    initializeTheme();
    void initializeSkills();
    void initializeAgents();
    void initializeAgentSettings();
    void initializeAgentHistory();
  }, [initializeAgentHistory, initializeAgentSettings, initializeAgents, initializeSkills, initializeTheme]);

  return (
    <div className="h-screen overflow-hidden bg-white text-[#111827] transition-colors duration-200 dark:bg-[#0a0a0b] dark:text-zinc-50">
      <div className="flex h-full flex-col overflow-hidden">
        <TitleBar />
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <Sidebar />
          <main className="min-h-0 flex-1 overflow-hidden bg-[#f7f8fb] dark:bg-[#0f1012]">
            <Routes>
              <Route path="/" element={<Navigate to="/book" replace />} />
              <Route path="/book" element={<BookPage />} />
              <Route path="/skills" element={<SkillsPage />} />
              <Route path="/skills/:skillId" element={<SkillDetailPage />} />
              <Route path="/agents" element={<AgentsPage />} />
              <Route path="/agents/:agentId" element={<AgentDetailPage />} />
              <Route path="/setting" element={<SettingPage />} />
            </Routes>
          </main>
        </div>
      </div>
    </div>
  );
}

function App() {
  return (
    <HashRouter>
      <AppShell />
    </HashRouter>
  );
}

export default App;
