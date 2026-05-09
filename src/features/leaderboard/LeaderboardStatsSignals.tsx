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
import { formatPercent, type LeaderboardStats } from "./leaderboardStats";

export function LineSection({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="min-w-0 border-b border-border">
      <header className="border-b border-border px-4 py-3 sm:px-5">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      </header>
      <div>{children}</div>
    </section>
  );
}

export function SplitGrid({ children }: { children: ReactNode }) {
  return <div className="grid lg:grid-cols-2">{children}</div>;
}

export function SplitCell({ children }: { children: ReactNode }) {
  return (
    <div className="min-w-0 border-t border-border px-4 py-4 first:border-t-0 sm:px-5 lg:border-t-0 lg:border-l lg:odd:border-l-0 lg:[&:nth-child(n+3)]:border-t">
      {children}
    </div>
  );
}

function PercentBar({ label, value }: { label: string; value: number }) {
  const width = `${Math.max(2, Math.min(100, value * 100))}%`;
  return (
    <div className="min-w-0" aria-label={`${label}：${formatPercent(value)}`}>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="truncate text-sm font-semibold text-foreground">{label}</span>
        <span className="font-medium tabular-nums text-foreground">{formatPercent(value)}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-panel-subtle">
        <div className="h-full rounded-full bg-primary" style={{ width }} />
      </div>
    </div>
  );
}

function IndexBar({ label, max, value }: { label: string; max: number; value: number }) {
  const width = `${Math.max(2, Math.min(100, (value / Math.max(1, max)) * 100))}%`;
  return (
    <div className="min-w-0" aria-label={`${label}：${formatIndex(value)}`}>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="truncate text-sm font-semibold text-foreground">{label}</span>
        <span className="font-medium tabular-nums text-foreground">{formatIndex(value)}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-panel-subtle">
        <div className="h-full rounded-full bg-primary" style={{ width }} />
      </div>
    </div>
  );
}

function formatIndex(value: number) {
  return `${value.toFixed(2).replace(/\.?0+$/, "")}x`;
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
        className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
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
          <MetricInfoRow label="计算公式" value={info.formula} />
          <MetricInfoRow label="新作家怎么看" value={info.newWriter} />
          <MetricInfoRow label="老作家怎么看" value={info.experiencedWriter} />
          <MetricInfoRow label="注意事项" value={info.caution} />
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

function SignalEmpty({ text }: { text: string }) {
  return <p className="border-l border-border px-2 py-1.5 text-xs text-muted-foreground">{text}</p>;
}

export function InterestSignals({ stats }: { stats: LeaderboardStats }) {
  const demandTopics = getDemandMultiplierTopics(stats, 5);
  const efficiencyTopics = getEfficiencyTopics(stats, 5);
  const midTierTopics = getMidTierTopics(stats, 5);
  const longTermTopics = getLongTermDigestionTopics(stats, 5);
  return (
    <LineSection title="兴趣信号">
      <SplitGrid>
        <SplitCell>
          <SignalColumn infoKey="demandMultiplier" title="需求倍率">
            {demandTopics.length > 0 ? demandTopics.map((stat) => (
              <IndexBar key={stat.name} label={`${stat.name} ${formatIndex(stat.demandMultiplierIndex)}`} value={stat.demandMultiplierIndex} max={demandTopics[0].demandMultiplierIndex} />
            )) : <SignalEmpty text="各分类阅读份额与作品供给接近" />}
          </SignalColumn>
        </SplitCell>
        <SplitCell>
          <SignalColumn infoKey="absorptionEfficiency" title="字数吸量效率">
            {efficiencyTopics.map((stat) => (
              <IndexBar key={stat.name} label={`${stat.name} ${formatIndex(stat.absorptionEfficiencyIndex)}`} value={stat.absorptionEfficiencyIndex} max={efficiencyTopics[0].absorptionEfficiencyIndex} />
            ))}
          </SignalColumn>
        </SplitCell>
        <SplitCell>
          <SignalColumn infoKey="midTierStrength" title="腰部承接力">
            {midTierTopics.map((stat) => (
              <PercentBar key={stat.name} label={`${stat.name} 第2-5名`} value={stat.midTierReadShare} />
            ))}
          </SignalColumn>
        </SplitCell>
        <SplitCell>
          <SignalColumn infoKey="longTermDigestion" title="长线消化力">
            {longTermTopics.map((stat) => (
              <IndexBar key={stat.name} label={`${stat.name} ${formatIndex(stat.longTermDigestionIndex)}`} value={stat.longTermDigestionIndex} max={longTermTopics[0].longTermDigestionIndex} />
            ))}
          </SignalColumn>
        </SplitCell>
      </SplitGrid>
    </LineSection>
  );
}

function SignalColumn({ children, infoKey, title }: {
  children: ReactNode;
  infoKey: MetricInfoKey;
  title: string;
}) {
  return (
    <div>
      <MetricLabel infoKey={infoKey} label={title} />
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function getDemandMultiplierTopics(stats: LeaderboardStats, limit: number) {
  return [...stats.categoryStats]
    .filter((stat) => stat.demandMultiplierIndex > 1)
    .sort((left, right) => right.demandMultiplierIndex - left.demandMultiplierIndex)
    .slice(0, limit);
}

function getEfficiencyTopics(stats: LeaderboardStats, limit: number) {
  return [...stats.categoryStats]
    .filter((stat) => stat.absorptionEfficiencyIndex > 0)
    .sort((left, right) => right.absorptionEfficiencyIndex - left.absorptionEfficiencyIndex)
    .slice(0, limit);
}

function getMidTierTopics(stats: LeaderboardStats, limit: number) {
  return [...stats.categoryStats]
    .filter((stat) => stat.midTierReadShare > 0)
    .sort((left, right) => right.midTierReadShare - left.midTierReadShare)
    .slice(0, limit);
}

function getLongTermDigestionTopics(stats: LeaderboardStats, limit: number) {
  return [...stats.categoryStats]
    .filter((stat) => stat.longTermDigestionIndex > 0)
    .sort((left, right) => right.longTermDigestionIndex - left.longTermDigestionIndex)
    .slice(0, limit);
}
