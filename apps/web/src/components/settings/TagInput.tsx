import { useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { cn } from "@muster/ui";
import { splitModelIds } from "./modelMeta";

/** 标签输入：回车 / 逗号 / 空格确认，退格删除最后一个，失焦时自动提交未确认的文字。支持粘贴多个。 */
export function TagInput({ value, onChange, placeholder, invalid, id, "aria-label": ariaLabel }: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  invalid?: boolean;
  id?: string;
  "aria-label"?: string;
}) {
  const [draft, setDraft] = useState("");

  const commit = (raw: string) => {
    const add = splitModelIds(raw).filter((t) => !value.includes(t));
    if (add.length > 0) onChange([...value, ...add]);
    setDraft("");
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit(draft);
    } else if (e.key === "Backspace" && draft === "" && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };

  return (
    <div
      className={cn(
        "flex min-h-10 flex-wrap items-center gap-1.5 rounded-2xl border border-line bg-surface px-2.5 py-1.5 transition-[border-color,box-shadow] duration-200 focus-within:border-coral focus-within:ring-4 focus-within:ring-coral/15",
        invalid && "border-danger",
      )}
    >
      {value.map((t) => (
        <span key={t} className="inline-flex items-center gap-1 rounded-pill bg-coral-soft py-0.5 pl-2.5 pr-1 font-mono text-xs text-coral-deep">
          {t}
          <button
            type="button"
            aria-label={`移除 ${t}`}
            onClick={() => onChange(value.filter((x) => x !== t))}
            className="grid size-4 cursor-pointer place-items-center rounded-full hover:bg-coral/20"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        id={id}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        value={draft}
        onChange={(e) => (/[,\s，;；]$/.test(e.target.value) ? commit(e.target.value) : setDraft(e.target.value))}
        onKeyDown={onKey}
        onBlur={() => draft.trim() && commit(draft)}
        onPaste={(e) => {
          const text = e.clipboardData.getData("text");
          if (/[,\s，;；]/.test(text.trim())) {
            e.preventDefault();
            commit(text);
          }
        }}
        placeholder={value.length === 0 ? placeholder : "继续添加…"}
        className="h-7 min-w-32 flex-1 bg-transparent px-1 font-mono text-[13px] text-ink outline-none placeholder:font-sans placeholder:text-ink-faint"
      />
    </div>
  );
}
