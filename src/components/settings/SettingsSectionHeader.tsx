import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useIsMobile } from "../../hooks/use-mobile";

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

type SettingsHeaderResponsiveButtonProps = React.ComponentProps<typeof Button> & {
  icon: ReactNode;
  label: string;
  text?: string;
};

export function SettingsHeaderResponsiveButton({
  className,
  icon,
  label,
  text,
  size,
  variant = "outline",
  children,
  ...props
}: SettingsHeaderResponsiveButtonProps) {
  const isMobile = useIsMobile();
  const desktopText = text ?? label;

  return (
    <Button
      size={size ?? (isMobile ? "icon-sm" : "sm")}
      variant={variant}
      aria-label={label}
      title={label}
      className={cn("bg-transparent text-foreground", className)}
      {...props}
    >
      {icon}
      {isMobile ? null : (children ?? <span>{desktopText}</span>)}
    </Button>
  );
}
