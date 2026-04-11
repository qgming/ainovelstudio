import { useEffect } from "react";

export type ToastTone = "info" | "success" | "error";

type ToastProps = {
  description?: string;
  duration?: number;
  onClose?: () => void;
  open: boolean;
  title: string;
  tone?: ToastTone;
};

const toneClassName: Record<ToastTone, string> = {
  error:
    "border-[#f3d0d0] bg-[#fff7f7] text-[#8f1d1d] dark:border-[#5b2525] dark:bg-[#241516] dark:text-[#f3b3b3]",
  info:
    "border-[#d8e3f0] bg-white text-[#334155] dark:border-[#2b3340] dark:bg-[#15181d] dark:text-[#dbe3ef]",
  success:
    "border-[#d6eadf] bg-[#f4fbf7] text-[#17603d] dark:border-[#244732] dark:bg-[#122017] dark:text-[#98e0b8]",
};

export function Toast({
  description,
  duration = 3200,
  onClose,
  open,
  title,
  tone = "info",
}: ToastProps) {
  useEffect(() => {
    if (!open || !onClose || duration <= 0) {
      return;
    }

    const timer = window.setTimeout(() => {
      onClose();
    }, duration);

    return () => window.clearTimeout(timer);
  }, [duration, onClose, open]);

  if (!open) {
    return null;
  }

  const message = [title, description].filter(Boolean).join("：");

  return (
    <div className="pointer-events-none fixed top-4 left-1/2 z-50 w-[min(520px,calc(100vw-2rem))] -translate-x-1/2">
      <div
        role={tone === "error" ? "alert" : "status"}
        className={`pointer-events-auto rounded-full border px-4 py-2 text-center shadow-[0_18px_45px_rgba(15,23,42,0.12)] backdrop-blur-sm ${toneClassName[tone]}`}
      >
        <p className="truncate text-sm leading-6">{message}</p>
      </div>
    </div>
  );
}
