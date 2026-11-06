import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "./cn";
import { Button, BUTTON_VARIANT } from "./basics";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogTrigger, Tooltip } from "./overlays";

/* ───────── IconButton ───────── */
type IconVariant = "ghost" | "secondary" | "primary";
const ICON_SIZE = { sm: "size-8 [&_svg]:size-4", md: "size-9 [&_svg]:size-[18px]", lg: "size-10 [&_svg]:size-5" } as const;

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> {
  /** Accessible name (aria-label) and tooltip text. Required because there is no visible text. */
  label: string;
  variant?: IconVariant;
  size?: keyof typeof ICON_SIZE;
  /** Keyboard shortcut shown inside the tooltip, e.g. "Ctrl+B". */
  shortcut?: string;
  /** Show the tooltip (default true). */
  tooltip?: boolean;
  loading?: boolean;
  /** Small slot in the top-right corner (e.g. a CountBadge). */
  badge?: ReactNode;
}
/** Icon-only button with a mandatory accessible name. Pass the icon as children. */
export function IconButton({ label, variant = "ghost", size = "md", shortcut, tooltip = true, loading, badge, className, children, disabled, type = "button", ...rest }: IconButtonProps) {
  const btn = (
    <button
      type={type}
      aria-label={label}
      disabled={disabled || loading}
      className={cn(
        "relative inline-grid shrink-0 cursor-pointer place-items-center rounded-control transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50",
        BUTTON_VARIANT[variant],
        ICON_SIZE[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="animate-spin" aria-hidden /> : children}
      {badge && <span className="absolute -right-1 -top-1">{badge}</span>}
    </button>
  );
  return tooltip ? (
    <Tooltip content={label} shortcut={shortcut}>
      {btn}
    </Tooltip>
  ) : (
    btn
  );
}

/* ───────── ConfirmDialog ───────── */
interface ConfirmDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Uncontrolled usage: the element that opens the dialog. */
  trigger?: ReactNode;
  title: string;
  description?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  /** danger = red confirm button (delete, stop, revoke). */
  tone?: "primary" | "danger";
  /** May be async; the button shows a spinner and the dialog closes on success. Throwing keeps it open. */
  onConfirm: () => void | Promise<void>;
  /** Extra content between the text and the buttons. */
  children?: ReactNode;
}
/** Second confirmation for destructive actions. Controlled (`open`) or with a `trigger`. */
export function ConfirmDialog({ open, onOpenChange, trigger, title, description, confirmText = "确认", cancelText = "取消", tone = "primary", onConfirm, children }: ConfirmDialogProps) {
  const [inner, setInner] = useState(false);
  const [busy, setBusy] = useState(false);
  const isOpen = open ?? inner;
  const setOpen = (v: boolean) => {
    if (busy && !v) return;
    setInner(v);
    onOpenChange?.(v);
  };
  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
      setBusy(false);
      setInner(false);
      onOpenChange?.(false);
    } catch {
      setBusy(false);
    }
  };
  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent title={title} className="w-[min(92vw,26rem)]">
        <div className="text-sm leading-relaxed text-fg-2">
          {description}
          {children}
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" disabled={busy}>
              {cancelText}
            </Button>
          </DialogClose>
          <Button variant={tone === "danger" ? "danger" : "primary"} loading={busy} onClick={() => void confirm()}>
            {confirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
