import type { ReactNode } from "react";
import { Button } from "@shared/ui/button";
import { cn } from "@shared/utils";
import { useIsMobile } from "@shared/hooks/useMobile";
import {
  getSurfaceActionClassName,
  getSurfaceActionVariant,
  resolveSurfaceActionTone,
  type SurfaceActionTone,
} from "@shared/ui/action-button";

type SettingsActionTone = Extract<SurfaceActionTone, "default" | "primary" | "destructive">;

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
  const resolved = resolveSurfaceActionTone(tone, variant);
  return resolved === "dark" ? "default" : resolved;
}

function getActionVariant(tone: SettingsActionTone): React.ComponentProps<typeof Button>["variant"] {
  return getSurfaceActionVariant(tone);
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
  return getSurfaceActionClassName({
    className,
    iconOnly,
    tone,
  });
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
