import type { HTMLAttributes, ReactNode } from "react"

import { cn } from "@/lib/utils"

export function Panel({
  className,
  ...props
}: HTMLAttributes<HTMLElement>) {
  return <section className={cn("editor-panel", className)} {...props} />
}

export function PanelHeader({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <header className={cn("editor-panel-header", className)} {...props} />
}

export function PanelTitle({
  className,
  ...props
}: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("editor-panel-title", className)} {...props} />
}

export function PanelBody({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("editor-panel-body", className)} {...props} />
}

export function PanelToolbar({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("editor-toolbar", className)} {...props} />
}

export function PanelNotice({
  children,
  className,
  tone = "default",
}: {
  children: ReactNode
  className?: string
  tone?: "default" | "error"
}) {
  return (
    <div className={cn("editor-callout", className)} data-tone={tone}>
      {children}
    </div>
  )
}

export function PanelEmptyState({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return <div className={cn("editor-empty-state", className)}>{children}</div>
}
