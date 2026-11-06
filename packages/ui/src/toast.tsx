import { useSyncExternalStore, type ReactNode } from "react";
import { CircleAlert, CircleCheck, Info, Loader2, TriangleAlert, X } from "lucide-react";
import { cn } from "./cn";

type ToastTone = "success" | "error" | "info" | "warning" | "loading";

interface ToastOptions {
  /** Reuse an id to update an existing toast in place (e.g. loading -> success). */
  id?: string;
  title: ReactNode;
  description?: ReactNode;
  tone?: ToastTone;
  /** ms before auto-dismiss. 0 keeps it until dismissed. Default 4000 (loading: never). */
  duration?: number;
  action?: { label: string; onClick: () => void };
}
interface ToastItem extends ToastOptions {
  id: string;
  tone: ToastTone;
}

let items: ToastItem[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const emit = () => listeners.forEach((l) => l());

function remove(id: string) {
  clearTimeout(timers.get(id));
  timers.delete(id);
  if (!items.some((t) => t.id === id)) return;
  items = items.filter((t) => t.id !== id);
  emit();
}

function show(input: string | ToastOptions, tone?: ToastTone): string {
  const o: ToastOptions = typeof input === "string" ? { title: input } : input;
  const id = o.id ?? `t${++seq}`;
  const t: ToastItem = { ...o, id, tone: o.tone ?? tone ?? "info" };
  const exists = items.some((x) => x.id === id);
  items = exists ? items.map((x) => (x.id === id ? t : x)) : [...items.slice(-4), t];
  clearTimeout(timers.get(id));
  const ms = t.duration ?? (t.tone === "loading" ? 0 : t.tone === "error" ? 6000 : 4000);
  if (ms > 0) timers.set(id, setTimeout(() => remove(id), ms));
  emit();
  return id;
}

type ToastInput = string | Omit<ToastOptions, "tone">;
const withTone = (tone: ToastTone) => (input: ToastInput, opts?: Omit<ToastOptions, "title" | "tone">) =>
  show(typeof input === "string" ? { title: input, ...opts, tone } : { ...input, ...opts, tone });

/**
 * Imperative toast API (mount <Toaster/> once near the app root).
 *   toast.success("已保存"); toast.error({ title: "失败", description: err.message });
 *   toast.promise(save(), { loading: "保存中…", success: "已保存", error: (e) => String(e) })
 */
export const toast = Object.assign((input: string | ToastOptions) => show(input), {
  success: withTone("success"),
  error: withTone("error"),
  info: withTone("info"),
  warning: withTone("warning"),
  loading: withTone("loading"),
  dismiss(id?: string) {
    if (id) return remove(id);
    [...items].forEach((t) => remove(t.id));
  },
  promise<T>(p: Promise<T>, msgs: { loading: string; success: string | ((v: T) => string); error: string | ((e: unknown) => string) }): Promise<T> {
    const id = show({ title: msgs.loading, tone: "loading" });
    p.then(
      (v) => void show({ id, title: typeof msgs.success === "function" ? msgs.success(v) : msgs.success, tone: "success" }),
      (e: unknown) => void show({ id, title: typeof msgs.error === "function" ? msgs.error(e) : msgs.error, tone: "error" }),
    );
    return p;
  },
});

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => void listeners.delete(cb);
};
const getItems = () => items;

const TONE_ICON: Record<ToastTone, { icon: ReactNode; className: string }> = {
  success: { icon: <CircleCheck className="size-4" />, className: "text-success" },
  error: { icon: <CircleAlert className="size-4" />, className: "text-danger" },
  info: { icon: <Info className="size-4" />, className: "text-accent" },
  warning: { icon: <TriangleAlert className="size-4" />, className: "text-warning" },
  loading: { icon: <Loader2 className="size-4 animate-spin" />, className: "text-accent" },
};

const POSITION = {
  "bottom-right": "bottom-5 right-5 items-end",
  "bottom-center": "bottom-5 left-1/2 -translate-x-1/2 items-center",
  "top-right": "top-5 right-5 items-end",
} as const;

interface ToasterProps {
  position?: keyof typeof POSITION;
  className?: string;
}
/** Renders the toast stack. Mount once, e.g. next to the router. */
export function Toaster({ position = "bottom-right", className }: ToasterProps) {
  const list = useSyncExternalStore(subscribe, getItems, getItems);
  return (
    <div role="region" aria-label="通知" aria-live="polite" className={cn("pointer-events-none fixed z-[100] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2", POSITION[position], className)}>
      {list.map((t) => (
        <div
          key={t.id}
          role={t.tone === "error" ? "alert" : "status"}
          className="muster-toast pointer-events-auto flex w-full items-start gap-3 rounded-card border border-border bg-surface py-3 pl-4 pr-2 shadow-overlay"
        >
          <span className={cn("mt-0.5 shrink-0", TONE_ICON[t.tone].className)} aria-hidden>
            {TONE_ICON[t.tone].icon}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium leading-5 text-fg">{t.title}</div>
            {t.description && <div className="mt-0.5 text-caption text-fg-2">{t.description}</div>}
            {t.action && (
              <button
                type="button"
                className="mt-1.5 cursor-pointer text-caption font-medium text-accent hover:underline"
                onClick={() => {
                  t.action?.onClick();
                  remove(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
          <button
            type="button"
            aria-label="关闭通知"
            onClick={() => remove(t.id)}
            className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-control text-fg-3 transition-colors hover:bg-surface-muted hover:text-fg"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
