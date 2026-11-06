import { useSyncExternalStore, type ReactNode } from "react";
import type { BotStatus } from "@muster/protocol";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { cn } from "./cn";
import { EASE, usePrefersReducedMotion } from "./motion";
import { Pebble } from "./Pebble";

export type ToastTone = "success" | "error" | "info" | "warning" | "loading";

export interface ToastOptions {
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

const TONE_STATUS: Record<ToastTone, BotStatus> = { success: "done", error: "error", info: "idle", warning: "waiting_approval", loading: "working" };
const TONE_BAR: Record<ToastTone, string> = {
  success: "bg-mint",
  error: "bg-danger",
  info: "bg-lavender",
  warning: "bg-amber",
  loading: "bg-coral",
};

const POSITION = {
  "bottom-right": "bottom-5 right-5 items-end",
  "bottom-center": "bottom-5 left-1/2 -translate-x-1/2 items-center",
  "top-right": "top-5 right-5 items-end",
} as const;

export interface ToasterProps {
  position?: keyof typeof POSITION;
  className?: string;
}
/** Renders the toast stack. Mount once, e.g. next to the router. */
export function Toaster({ position = "bottom-right", className }: ToasterProps) {
  const list = useSyncExternalStore(subscribe, getItems, getItems);
  const reduced = usePrefersReducedMotion();
  return (
    <div role="region" aria-label="通知" aria-live="polite" className={cn("muster-toaster pointer-events-none flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2.5", POSITION[position], className)}>
      <AnimatePresence initial={false}>
        {list.map((t) => (
          <motion.div
            key={t.id}
            layout={!reduced}
            initial={reduced ? false : { opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, x: 40, scale: 0.96 }}
            transition={{ duration: 0.3, ease: EASE as unknown as [number, number, number, number] }}
            role={t.tone === "error" ? "alert" : "status"}
            className="muster-glass-3 pointer-events-auto relative flex w-full items-start gap-3 overflow-hidden rounded-2xl py-3 pl-4 pr-3"
          >
            <span className={cn("absolute inset-y-0 left-0 w-1", TONE_BAR[t.tone])} aria-hidden />
            <Pebble status={TONE_STATUS[t.tone]} size={34} lite className="mt-0.5" />
            <div className="min-w-0 flex-1 py-0.5">
              <div className="text-sm font-semibold leading-5 text-ink">{t.title}</div>
              {t.description && <div className="mt-0.5 text-[13px] leading-5 text-ink-soft">{t.description}</div>}
              {t.action && (
                <button
                  type="button"
                  className="mt-1.5 cursor-pointer text-[13px] font-medium text-coral-deep hover:underline"
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
              className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-full text-ink-faint transition-colors hover:bg-canvas-deep hover:text-ink"
            >
              <X className="size-3.5" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
