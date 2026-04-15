import type { ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type DialogShellProps = {
  children: ReactNode;
  onClose: () => void;
  title: string;
};

export function DialogShell({ children, onClose, title }: DialogShellProps) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="gap-0 overflow-hidden border-border-strong bg-panel p-0 sm:max-w-md"
      >
        <DialogHeader className="border-b border-border bg-panel-subtle px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <DialogTitle className="truncate text-[14px] font-medium tracking-[0.01em] text-foreground">
              {title}
            </DialogTitle>
            <Button
              type="button"
              aria-label="关闭弹窗"
              onClick={onClose}
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>
        <div className="flex flex-1 px-4 py-5">{children}</div>
      </DialogContent>
    </Dialog>
  );
}
