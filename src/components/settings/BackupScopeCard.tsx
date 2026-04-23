import { CloudUpload, HardDriveDownload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const BACKUP_SCOPE_ITEMS = [
  "书籍工作区",
  "对话记录",
  "技能 / 代理 / 工作流",
  "模型配置",
  "工具开关",
  "主代理 AGENTS.md",
  "WebDAV 配置",
];

const BACKUP_SCOPE_COPY = {
  cloud: {
    description:
      "上传和下载云备份都会使用同一份完整数据包，跨设备恢复时会同步带回模型配置、主代理 AGENTS 和数据管理设置。",
    Icon: CloudUpload,
  },
  local: {
    description:
      "导出和导入本地备份都会使用同一份完整数据包，恢复后会同步覆盖数据库内容、模型配置和页面偏好。",
    Icon: HardDriveDownload,
  },
} as const;

type BackupScopeCardProps = {
  className?: string;
  variant: keyof typeof BACKUP_SCOPE_COPY;
};

export function BackupScopeCard({
  className,
  variant,
}: BackupScopeCardProps) {
  const { description, Icon } = BACKUP_SCOPE_COPY[variant];

  return (
    <div
      className={cn(
        "rounded-2xl border border-border/70 bg-muted/35 p-4",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-background text-foreground shadow-xs">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">完整备份范围</p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {description}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {BACKUP_SCOPE_ITEMS.map((item) => (
              <Badge
                key={item}
                variant="outline"
                className="bg-background/85 text-foreground"
              >
                {item}
              </Badge>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
