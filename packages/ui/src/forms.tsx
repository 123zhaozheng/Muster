import { useLayoutEffect, useRef, type ChangeEvent, type ComponentProps, type ReactNode } from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "./cn";

const FIELD =
  "w-full rounded-control border border-border bg-surface px-3 text-sm text-fg placeholder:text-fg-3 transition-colors duration-150 outline-none hover:border-fg-3/60 focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20 aria-[invalid=true]:border-danger aria-[invalid=true]:focus-visible:ring-danger/20 disabled:opacity-50";

export function Input({ className, ...rest }: ComponentProps<"input">) {
  return <input className={cn(FIELD, "h-9", className)} {...rest} />;
}

interface TextareaProps extends ComponentProps<"textarea"> {
  /** Grow with the content up to `maxRows` (then scroll). */
  autoGrow?: boolean;
  maxRows?: number;
}
export function Textarea({ autoGrow, maxRows = 8, className, value, onChange, ref, ...rest }: TextareaProps) {
  const inner = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    const el = inner.current;
    if (!autoGrow || !el) return;
    el.style.height = "auto";
    const line = parseFloat(getComputedStyle(el).lineHeight) || 22;
    const max = line * maxRows;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
  }, [autoGrow, maxRows, value]);
  return (
    <textarea
      ref={(el) => {
        inner.current = el;
        if (typeof ref === "function") ref(el);
        else if (ref) ref.current = el;
      }}
      value={value}
      onChange={onChange}
      rows={autoGrow ? 1 : undefined}
      className={cn(FIELD, "py-2 leading-relaxed", autoGrow ? "resize-none" : "min-h-24 resize-y", className)}
      {...rest}
    />
  );
}

export function Switch({ className, ...rest }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full bg-border p-0.5 outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-accent/40 data-[state=checked]:bg-accent disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...rest}
    >
      <SwitchPrimitive.Thumb className="block size-4 rounded-full bg-white transition-transform duration-150 ease-muster data-[state=checked]:translate-x-4" />
    </SwitchPrimitive.Root>
  );
}

interface SliderProps extends Omit<ComponentProps<"input">, "type" | "value" | "onChange" | "defaultValue"> {
  value: number;
  onValueChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
}

/** Simple range slider (native input styled via `.muster-slider`). */
export function Slider({ value, onValueChange, min = 0, max = 100, step = 1, className, style, ...rest }: SliderProps) {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <input
      type="range"
      className={cn("muster-slider w-full", className)}
      style={{ ["--muster-slider-pct" as string]: `${pct}%`, ...style }}
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(e: ChangeEvent<HTMLInputElement>) => onValueChange(Number(e.target.value))}
      {...rest}
    />
  );
}

interface FieldProps {
  label: ReactNode;
  /** Helper text under the control (hidden while an error is shown). */
  hint?: ReactNode;
  /** Validation message; also give the control `aria-invalid` to colour its border. */
  error?: ReactNode;
  required?: boolean;
  htmlFor?: string;
  className?: string;
  children: ReactNode;
}
/** Label + control + hint/error, the standard form row. */
export function Field({ label, hint, error, required, htmlFor, className, children }: FieldProps) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-sm font-medium text-fg">
        {label}
        {required && <span className="ml-0.5 text-danger">*</span>}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-fg-3">{hint}</p>
      ) : null}
    </div>
  );
}
