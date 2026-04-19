import { useMemo, useState } from "react";
import { Check, LoaderCircle, Sparkles } from "lucide-react";
import type { AgentProviderConfig } from "../../stores/agentSettingsStore";
import { fetchProviderModels } from "../../lib/agent/modelCatalog";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { SettingsHeaderResponsiveButton } from "./SettingsSectionHeader";

type ModelCatalogButtonProps = {
  config: AgentProviderConfig;
  iconOnly?: boolean;
  onSelectModel: (model: string) => void;
  onError: (message: string) => void;
};

function formatModelCount(count: number) {
  return `已获取 ${count} 个模型`;
}

export function ModelCatalogButton({ config, iconOnly = false, onSelectModel, onError }: ModelCatalogButtonProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const baseURL = config.baseURL.trim();
  const apiKey = config.apiKey.trim();
  const canFetchModels = baseURL.length > 0 && apiKey.length > 0 && !isLoading;
  const dialogDescription = useMemo(() => formatModelCount(models.length), [models.length]);

  async function handleOpenCatalog() {
    if (!canFetchModels) {
      return;
    }

    setIsLoading(true);

    try {
      const nextModels = await fetchProviderModels(config);
      setModels(nextModels);
      setSelectedModel((current) => {
        if (current && nextModels.includes(current)) {
          return current;
        }

        return nextModels.includes(config.model.trim()) ? config.model.trim() : nextModels[0] ?? "";
      });
      setIsDialogOpen(true);
    } catch (error) {
      const message = error instanceof Error && error.message.trim()
        ? error.message
        : "获取模型列表失败，请稍后重试。";
      onError(message);
    } finally {
      setIsLoading(false);
    }
  }

  function handleUseModel() {
    if (!selectedModel) {
      return;
    }

    onSelectModel(selectedModel);
    setIsDialogOpen(false);
  }

  return (
    <>
      <SettingsHeaderResponsiveButton
        type="button"
        label={isLoading ? "获取中..." : "获取模型"}
        disabled={!canFetchModels}
        size={iconOnly ? "icon-sm" : "sm"}
        text="获取模型"
        icon={isLoading ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
        onClick={() => void handleOpenCatalog()}
      />

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>选择模型</DialogTitle>
            <DialogDescription>{dialogDescription}</DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <p className="text-xs font-medium text-[#475569] dark:text-zinc-300">模型列表</p>
            <div className="max-h-72 overflow-y-auto rounded-[12px] border border-[#d8dee8] bg-white p-1 dark:border-[#2b313a] dark:bg-[#16191f]">
              <div className="space-y-1">
                {models.map((model) => {
                  const isSelected = model === selectedModel;

                  return (
                    <button
                      key={model}
                      type="button"
                      onClick={() => setSelectedModel(model)}
                      className={[
                        "flex w-full items-center justify-between rounded-[10px] px-3 py-2 text-left text-sm transition-colors",
                        isSelected
                          ? "bg-[#eef4ff] text-[#0f172a] dark:bg-[#1a2433] dark:text-zinc-100"
                          : "text-[#334155] hover:bg-[#f8fafc] dark:text-zinc-300 dark:hover:bg-[#1b2029]",
                      ].join(" ")}
                    >
                      <span className="truncate pr-3">{model}</span>
                      {isSelected ? <Check className="h-4 w-4 shrink-0 text-[#2563eb] dark:text-[#93c5fd]" /> : null}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
              取消
            </Button>
            <Button type="button" disabled={!selectedModel} onClick={handleUseModel}>
              使用模型
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
