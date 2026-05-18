import type { ReactNode } from "react";
import { Button } from "@shared/ui/button";
import { cn } from "@shared/utils";
import { useIsMobile } from "@shared/hooks/useMobile";

type SettingsActionTone = "default" | "primary" | "destructive";

type SettingsSectionHeaderProps = {
  actions?: ReactNode;
  icon?: ReactNode;
  showTitle?: boolean;
  title: string;
};

export function SettingsSectionHeader({
  actions,
  icon,
  showTitle = false,
  title,
}: SettingsSectionHeaderProps) {
  if (!actions && !showTitle) {
    return null;
  }

  return (
    <header className={cn(
      "flex min-h-9 shrink-0 items-center gap-3 bg-app px-4",
      showTitle ? "justify-between" : "justify-end",
    )}>
      {showTitle ? (
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {icon ? <span className="shrink-0 text-foreground">{icon}</span> : null}
          <h2 className="min-w-0 truncate text-[22px] font-semibold leading-tight tracking-[-0.04em] text-foreground">
            {title}
          </h2>
        </div>
      ) : null}
      {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
    </header>
  );
}

function resolveActionTone(tone?: SettingsActionTone, variant?: React.ComponentProps<typeof Button>["variant"]) {
  if (tone) return tone;
  if (variant === "default") return "primary";
  if (variant === "destructive") return "destructive";
  return "default";
}

function getActionVariant(tone: SettingsActionTone): React.ComponentProps<typeof Button>["variant"] {
  if (tone === "primary") return "default";
  if (tone === "destructive") return "destructive";
  return "outline";
}

function getSettingsActionClassName({
  className,
  iconOnly = false,
  tone = "default",
}: {
  className?: string;
  iconOnly?: boolean;
  tone?: SettingsActionTone;
}) {
  return cn(
    "settings-action-button shadow-[0_8px_18px_rgba(15,23,42,0.045)] transition-all duration-150 hover:-translate-y-px hover:shadow-[0_10px_22px_rgba(15,23,42,0.07)] dark:shadow-none dark:hover:shadow-none",
    iconOnly ? "h-9 w-9 rounded-xl px-0" : "h-9 rounded-xl gap-1.5 px-3.5 text-[13px]",
    tone === "default" && "border-border/55 bg-panel text-foreground hover:border-border/75 hover:bg-panel-subtle dark:bg-panel dark:hover:bg-panel-subtle",
    tone === "primary" && "border-primary/25 bg-primary text-primary-foreground shadow-[0_8px_18px_color-mix(in_oklab,var(--color-primary)_14%,transparent)] hover:border-primary/28 hover:bg-primary/92 hover:shadow-[0_10px_22px_color-mix(in_oklab,var(--color-primary)_18%,transparent)] dark:shadow-none dark:hover:shadow-none",
    tone === "destructive" && "border-destructive/25 bg-destructive/10 text-destructive hover:border-destructive/35 hover:bg-destructive/14 hover:shadow-[0_12px_24px_rgba(185,28,28,0.12)]",
    className,
  );
}

type SettingsActionButtonProps = React.ComponentProps<typeof Button> & {
  icon?: ReactNode;
  iconOnly?: boolean;
  label?: string;
  text?: string;
  tone?: SettingsActionTone;
};

export function SettingsActionButton({
  children,
  className,
  icon,
  iconOnly = false,
  label,
  size,
  text,
  tone,
  variant,
  ...props
}: SettingsActionButtonProps) {
  const resolvedTone = resolveActionTone(tone, variant);

  return (
    <Button
      aria-label={label}
      title={label}
      size={size ?? (iconOnly ? "icon-sm" : "sm")}
      variant={getActionVariant(resolvedTone)}
      className={getSettingsActionClassName({ className, iconOnly, tone: resolvedTone })}
      {...props}
    >
      {iconOnly ? (icon ?? children) : (
        <>
          {icon}
          {children ?? (text ? <span>{text}</span> : null)}
        </>
      )}
    </Button>
  );
}

type SettingsActionLinkProps = React.ComponentProps<"a"> & {
  icon?: ReactNode;
  iconOnly?: boolean;
  label?: string;
  text?: string;
  tone?: SettingsActionTone;
};

export function SettingsActionLink({
  children,
  className,
  icon,
  iconOnly = false,
  label,
  text,
  tone = "default",
  ...props
}: SettingsActionLinkProps) {
  return (
    <a
      aria-label={label}
      title={label}
      className={getSettingsActionClassName({ className, iconOnly, tone })}
      {...props}
    >
      {iconOnly ? (icon ?? children) : (
        <>
          {icon}
          {children ?? (text ? <span>{text}</span> : null)}
        </>
      )}
    </a>
  );
}

export function SettingsHeaderButton({
  className,
  size = "sm",
  variant = "outline",
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <SettingsActionButton
      size={size}
      variant={variant}
      className={className}
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
    <SettingsActionButton
      iconOnly
      size={size}
      variant={variant}
      className={className}
      {...props}
    />
  );
}

type SettingsHeaderResponsiveButtonProps = React.ComponentProps<typeof Button> & {
  icon: ReactNode;
  label: string;
  text?: string;
  tone?: SettingsActionTone;
};

export function SettingsHeaderResponsiveButton({
  className,
  icon,
  label,
  text,
  size,
  tone,
  variant = "outline",
  children,
  ...props
}: SettingsHeaderResponsiveButtonProps) {
  const isMobile = useIsMobile();
  const desktopText = text ?? label;

  return (
    <SettingsActionButton
      icon={icon}
      iconOnly={isMobile}
      size={size ?? (isMobile ? "icon-sm" : "sm")}
      tone={tone}
      variant={variant}
      label={label}
      text={desktopText}
      className={className}
      {...props}
    >
      {children}
    </SettingsActionButton>
  );
}
