import { useEffect, useRef } from "react";
import { toast } from "sonner";

export type ToastTone = "info" | "success" | "error";

type ToastProps = {
  description?: string;
  duration?: number;
  onClose?: () => void;
  open: boolean;
  title: string;
  tone?: ToastTone;
};

export function Toast({
  description,
  duration = 3200,
  onClose,
  open,
  title,
  tone = "info",
}: ToastProps) {
  const toastIdRef = useRef<string | number | null>(null);
  const message = [title, description].filter(Boolean).join("：");

  useEffect(() => {
    if (!open) {
      if (toastIdRef.current !== null) {
        toast.dismiss(toastIdRef.current);
        toastIdRef.current = null;
      }
      return;
    }

    const createToast =
      tone === "success"
        ? toast.success
        : tone === "error"
          ? toast.error
          : toast;

    toastIdRef.current = createToast(title, {
      description,
      duration,
      onDismiss: onClose,
    });

    return () => {
      if (toastIdRef.current !== null) {
        toast.dismiss(toastIdRef.current);
        toastIdRef.current = null;
      }
    };
  }, [description, duration, onClose, open, title, tone]);

  if (!open) {
    return null;
  }

  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      aria-live={tone === "error" ? "assertive" : "polite"}
      className="sr-only"
    >
      {message}
    </div>
  );
}
