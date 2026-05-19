import { useMemo, useState } from "react";
import { Check, Download, LoaderCircle } from "lucide-react";
import type { AgentProviderConfig } from "@features/settings/stores/useAgentSettingsStore";
import { fetchProviderModels } from "@features/agent/lib/modelCatalog";
import { getSurfaceActionClassName } from "@shared/ui/action-button";
import { Button } from "@shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@shared/ui/dialog";
import { cn } from "@shared/utils";

type ModelCatalogButtonProps = {
  className?: string;
  config: AgentProviderConfig;
  onSelectModel: (model: string) => void | Promise<void>;
  onError: (message: string) => void;
};

function formatModelCount(count: number) {
  return `已获取 ${count} 个模型`;
}

export function ModelCatalogButton({ className, config, onSelectModel, onError }: ModelCatalogButtonProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const baseURL = config.baseURL.trim();
  const apiKey = config.apiKey.trim();
  const canFetchModels = baseURL.length > 0 && apiKey.length > 0 && !isLoading && !isApplying;
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

  async function handleUseModel(model = selectedModel) {
    if (!model || isApplying) {
      return;
    }

    setSelectedModel(model);
    setIsApplying(true);

    try {
      await onSelectModel(model);
      setIsDialogOpen(false);
    } catch (error) {
      const message = error instanceof Error && error.message.trim()
        ? error.message
        : "应用模型失败，请稍后重试。";
      onError(message);
    } finally {
      setIsApplying(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        aria-label={isLoading ? "获取中..." : "获取模型"}
        title={isLoading ? "获取中..." : "获取模型"}
        disabled={!canFetchModels}
        variant="ghost"
        size="icon-sm"
        className={cn("text-muted-foreground", className)}
        onClick={() => void handleOpenCatalog()}
      >
        {isLoading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
      </Button>

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
                      disabled={isApplying}
                      onClick={() => void handleUseModel(model)}
                      className={[
                        "flex w-full items-center justify-between rounded-[10px] px-3 py-2 text-left text-sm transition-colors",
                        isSelected
                          ? "bg-[#eef4ff] text-[#0f172a] dark:bg-[#1a2433] dark:text-zinc-100"
                          : "text-[#334155] hover:bg-[#f8fafc] disabled:cursor-wait disabled:opacity-60 dark:text-zinc-300 dark:hover:bg-[#1b2029]",
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
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsDialogOpen(false)}
              className={getSurfaceActionClassName({ tone: "default" })}
            >
              取消
            </Button>
            <Button
              type="button"
              disabled={!selectedModel || isApplying}
              onClick={() => void handleUseModel()}
              className={getSurfaceActionClassName({ tone: "primary" })}
            >
              {isApplying ? "保存中..." : "使用模型"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
