import { HelpCircle } from "lucide-react";
import { useState, type ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@shared/ui/dialog";
import { METRIC_INFO, type MetricInfo, type MetricInfoKey } from "./leaderboardMetricInfo";

export function LineSection({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="min-w-0 overflow-hidden rounded-xl border border-border/45 bg-card text-card-foreground shadow-[0_10px_28px_rgba(15,23,42,0.045)] dark:bg-panel dark:shadow-none">
      <header className="flex min-h-10 items-center border-b border-border/45 px-3 pt-3 pb-1 sm:px-4">
        <h2 className="truncate text-[16px] font-medium tracking-[-0.03em] text-foreground">{title}</h2>
      </header>
      <div>{children}</div>
    </section>
  );
}

export function SplitGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-3 p-3 lg:grid-cols-2">{children}</div>;
}

export function SplitCell({ children }: { children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl border border-border/45 bg-background/65 px-3 py-3 sm:px-4 sm:py-4 dark:bg-background/25">
      {children}
    </div>
  );
}

export function MetricLabel({ infoKey, label }: { infoKey: MetricInfoKey; label: string }) {
  const [open, setOpen] = useState(false);
  const info = METRIC_INFO[infoKey];
  return (
    <div className="mb-2 flex items-center gap-1.5">
      <p className="text-xs font-medium text-foreground">{label}</p>
      <button
        type="button"
        aria-label={`${label}说明`}
        onClick={() => setOpen(true)}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <HelpCircle className="h-3.5 w-3.5" />
      </button>
      <MetricInfoDialog info={info} open={open} onOpenChange={setOpen} />
    </div>
  );
}

function MetricInfoDialog({ info, onOpenChange, open }: {
  info: MetricInfo;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{info.name}</DialogTitle>
          <DialogDescription>{info.meaning}</DialogDescription>
        </DialogHeader>
        <div className="border-y border-border text-sm">
          <MetricInfoRow label="参数含义" value={info.meaning} />
          <MetricInfoRow label="怎么用" value={info.guide} />
          <MetricInfoRow label="计算公式" value={info.formula} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MetricInfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 border-b border-border py-3 last:border-b-0 sm:grid-cols-[108px_minmax(0,1fr)]">
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <p className="leading-6 text-foreground">{label === "计算公式" ? `计算公式：${value}` : value}</p>
    </div>
  );
}

