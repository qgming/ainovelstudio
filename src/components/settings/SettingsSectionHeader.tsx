import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type SettingsSectionHeaderProps = {
  actions?: ReactNode;
  icon?: ReactNode;
  title: string;
};

export function SettingsSectionHeader({
  actions,
  icon,
  title,
}: SettingsSectionHeaderProps) {
  return (
    <header className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-border bg-app px-3">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {icon ? <span className="shrink-0 text-foreground">{icon}</span> : null}
        <h2 className="min-w-0 truncate text-[15px] font-semibold tracking-[-0.03em] text-foreground">
          {title}
        </h2>
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
    </header>
  );
}

export function SettingsHeaderButton({
  className,
  size = "sm",
  variant = "outline",
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <Button
      size={size}
      variant={variant}
      className={cn("bg-transparent text-foreground", className)}
      {...props}
    />
  );
}

export function SettingsHeaderIconButton({
  className,
  size = "icon-sm",
  variant = "ghost",
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <Button
      size={size}
      variant={variant}
      className={cn("text-foreground", className)}
      {...props}
    />
  );
}
