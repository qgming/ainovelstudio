import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";
import { getSurfaceActionClassName } from "@shared/ui/action-button";
import { cn } from "@shared/utils";

type PageBackTitleProps = {
  backLabel: string;
  className?: string;
  onBack?: () => void;
  title: string;
  titleClassName?: string;
  to?: string;
};

export function PageBackTitle({
  backLabel,
  className,
  onBack,
  title,
  titleClassName,
  to,
}: PageBackTitleProps) {
  const buttonClassName = getSurfaceActionClassName({
    className: "editor-page-action",
    iconOnly: true,
  });
  const icon = <ArrowLeft className="h-4 w-4" aria-hidden="true" />;

  return (
    <div className={cn("flex min-w-0 items-center gap-2", className)}>
      {to ? (
        <Link
          to={to}
          aria-label={backLabel}
          title={backLabel}
          className={buttonClassName}
        >
          {icon}
        </Link>
      ) : (
        <button
          type="button"
          aria-label={backLabel}
          title={backLabel}
          onClick={onBack}
          className={buttonClassName}
        >
          {icon}
        </button>
      )}
      <span
        className={cn(
          "truncate text-[22px] font-semibold leading-tight tracking-[-0.04em] text-foreground",
          titleClassName,
        )}
      >
        {title}
      </span>
    </div>
  );
}

