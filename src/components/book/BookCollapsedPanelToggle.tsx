import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { COLLAPSED_PANEL_TOGGLE_WIDTH } from "../../lib/bookWorkspace/layout";

type BookCollapsedPanelToggleProps = {
  ariaLabel: string;
  onClick: () => void;
  side: "left" | "right";
};

// 折叠展开面板切换按钮：使用 shadcn Button + 主题 token，避免硬编码品牌色。
export function BookCollapsedPanelToggle({
  ariaLabel,
  onClick,
  side,
}: BookCollapsedPanelToggleProps) {
  const Icon = side === "left" ? ChevronRight : ChevronLeft;
  const sideClass =
    side === "left"
      ? "left-0 rounded-r-full border-l-0"
      : "right-0 rounded-l-full border-r-0";

  return (
    <div
      style={{ width: COLLAPSED_PANEL_TOGGLE_WIDTH }}
      className="relative flex h-full shrink-0 bg-app"
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            aria-label={ariaLabel}
            onClick={onClick}
            variant="default"
            className={cn(
              "absolute top-[30%] z-10 h-12 w-[18px] -translate-y-1/2 border bg-primary p-0 text-primary-foreground shadow-md transition-all duration-150 hover:scale-[1.03] hover:bg-primary",
              sideClass,
            )}
          >
            <Icon className="h-4 w-4 transition-transform duration-150 group-hover/button:scale-110" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side={side === "left" ? "right" : "left"}>{ariaLabel}</TooltipContent>
      </Tooltip>
    </div>
  );
}
