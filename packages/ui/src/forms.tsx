import type { ChangeEvent, ComponentProps, ReactNode } from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "./cn";

const FIELD =
  "w-full rounded-2xl border border-line bg-surface px-4 text-sm text-ink shadow-[inset_0_1px_2px_rgb(60_40_20/0.03)] placeholder:text-ink-faint transition-[border-color,box-shadow] duration-200 outline-none hover:border-ink-faint/50 focus-visible:border-coral focus-visible:ring-4 focus-visible:ring-coral/15 aria-[invalid=true]:border-danger aria-[invalid=true]:focus-visible:ring-danger/15 disabled:opacity-50";

export function Input({ className, ...rest }: ComponentProps<"input">) {
  return <input className={cn(FIELD, "h-10", className)} {...rest} />;
}

export function Textarea({ className, ...rest }: ComponentProps<"textarea">) {
  return <textarea className={cn(FIELD, "min-h-24 resize-y py-2.5 leading-relaxed", className)} {...rest} />;
}

export function Switch({ className, ...rest }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "inline-flex h-6 w-11 shrink-0 items-center rounded-pill bg-line p-0.5 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-coral/40 data-[state=checked]:bg-coral cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed",
        className,
      )}
      {...rest}
    >
      <SwitchPrimitive.Thumb className="block size-5 rounded-full bg-white shadow-soft transition-transform duration-200 ease-muster data-[state=checked]:translate-x-5" />
    </SwitchPrimitive.Root>
  );
}

export interface SliderProps extends Omit<ComponentProps<"input">, "type" | "value" | "onChange" | "defaultValue"> {
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

export interface FieldProps {
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
      <label htmlFor={htmlFor} className="text-sm font-medium text-ink">
        {label}
        {required && <span className="ml-0.5 text-coral">*</span>}
      </label>
      {children}
      {error ? (
        <p role="alert" className="muster-fade-in text-xs text-danger">{error}</p>
      ) : hint ? (
        <p className="text-xs text-ink-faint">{hint}</p>
      ) : null}
    </div>
  );
}
