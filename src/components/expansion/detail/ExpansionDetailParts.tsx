/** 扩写详情页公共 UI 子组件：DetailTitle / EntryButton / SectionHeader。 */
import { Link } from "react-router-dom";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "../../ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/tooltip";
import { buildExpansionListRoute } from "../../../lib/expansion/routes";
import { cn } from "../../../lib/utils";

/** 顶部标题：返回创作台 / 当前条目名。 */
export function DetailTitle({ name }: { name: string }) {
  return (
    <div className="truncate text-[15px] font-semibold tracking-[-0.03em] text-foreground">
      <Link
        to={buildExpansionListRoute()}
        className="text-muted-foreground transition-colors hover:text-foreground"
      >
        创作台
      </Link>
      <span className="px-1.5 text-muted-foreground">/</span>
      <span>{name}</span>
    </div>
  );
}

/** 左侧条目行：选中态、点击、悬浮重命名/删除。 */
export function EntryButton({
  active,
  canModify,
  label,
  onClick,
  onDelete,
  onRename,
}: {
  active: boolean;
  canModify: boolean;
  label: string;
  onClick: () => void;
  onDelete?: () => void;
  onRename?: () => void;
}) {
  return (
    <div
      className={cn(
        "group flex w-full items-center border-b border-border transition",
        active
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      <button
        type="button"
        onClick={onClick}
        className="flex min-w-0 flex-1 items-center px-3 py-2 text-left"
      >
        <span className="block min-w-0 truncate text-sm font-medium">{label}</span>
      </button>
      {canModify ? (
        <div className="hidden shrink-0 items-center gap-0.5 pr-1 group-hover:flex">
          {onRename ? (
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label="重命名"
              onClick={(event) => {
                event.stopPropagation();
                onRename();
              }}
              className="text-muted-foreground"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          ) : null}
          {onDelete ? (
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label="删除"
              onClick={(event) => {
                event.stopPropagation();
                onDelete();
              }}
              className="text-muted-foreground"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** 分组标题行：左侧 label + 可选 + 按钮。 */
export function SectionHeader({
  label,
  onAdd,
}: {
  label: string;
  onAdd?: () => void;
}) {
  return (
    <div className="flex h-10 items-center justify-between gap-2 border-b border-border px-3">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {onAdd ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              aria-label={`新建${label}`}
              variant="ghost"
              size="icon-sm"
              onClick={onAdd}
              className="text-muted-foreground"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{`新建${label}`}</TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  );
}
