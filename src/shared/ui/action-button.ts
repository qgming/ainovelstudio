import type { ComponentProps } from "react";
import type { Button } from "@shared/ui/button";
import { cn } from "@shared/utils";

export type SurfaceActionTone = "default" | "dark" | "primary" | "destructive";

type ButtonVariant = ComponentProps<typeof Button>["variant"];

export function resolveSurfaceActionTone(
  tone?: SurfaceActionTone,
  variant?: ButtonVariant,
): SurfaceActionTone {
  if (tone) return tone;
  if (variant === "default") return "primary";
  if (variant === "destructive") return "destructive";
  if (variant === "secondary") return "dark";
  return "default";
}

export function getSurfaceActionVariant(tone: SurfaceActionTone): ButtonVariant {
  if (tone === "primary") return "default";
  if (tone === "destructive") return "destructive";
  if (tone === "dark") return "secondary";
  return "outline";
}

export function getSurfaceActionClassName({
  className,
  iconOnly = false,
  tone = "default",
}: {
  className?: string;
  iconOnly?: boolean;
  tone?: SurfaceActionTone;
}) {
  return cn(
    "editor-surface-action inline-flex shrink-0 items-center justify-center border border-transparent whitespace-nowrap shadow-[0_8px_18px_rgba(15,23,42,0.045)] transition-all duration-150 outline-none select-none hover:-translate-y-px hover:shadow-[0_10px_22px_rgba(15,23,42,0.07)] focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 dark:shadow-none dark:hover:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
    iconOnly ? "h-9 w-9 rounded-xl px-0" : "h-9 rounded-xl gap-1.5 px-3.5 text-[13px]",
    tone === "default" && "border-border/55 bg-panel text-foreground hover:border-border/75 hover:bg-panel-subtle dark:bg-panel dark:hover:bg-panel-subtle",
    tone === "dark" && "border-border/55 bg-secondary text-foreground hover:border-border/75 hover:bg-accent",
    tone === "primary" && "border-primary/25 bg-primary text-primary-foreground shadow-[0_8px_18px_color-mix(in_oklab,var(--color-primary)_14%,transparent)] hover:border-primary/28 hover:bg-primary/92 hover:shadow-[0_10px_22px_color-mix(in_oklab,var(--color-primary)_18%,transparent)] dark:shadow-none dark:hover:shadow-none",
    tone === "destructive" && "border-destructive/25 bg-destructive/10 text-destructive hover:border-destructive/35 hover:bg-destructive/14 hover:shadow-[0_12px_24px_rgba(185,28,28,0.12)]",
    className,
  );
}
