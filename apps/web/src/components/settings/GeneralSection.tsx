import { useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Badge, Section, SettingsRow, Segmented, Switch, cn, setReduceMotion, useReduceMotionSetting } from "@muster/ui";
import { setSendKey, useSendKey, type SendKey } from "../../lib/preferences";

const SEND_OPTIONS: Array<{ value: SendKey; label: string }> = [
  { value: "enter", label: "Enter 发送" },
  { value: "ctrl-enter", label: "Ctrl+Enter 发送" },
];

/** localStorage keys written by lib/preferences setSendKey and @muster/ui setReduceMotion. */
const SEND_KEY_STORAGE = "muster.sendKey";
const REDUCE_MOTION_STORAGE = "muster.reduceMotion";

type SaveState = "idle" | "saved" | "failed";

const SAVE_TEXT: Record<Exclude<SaveState, "idle">, string> = { saved: "已保存", failed: "保存失败，已恢复" };

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Applies an instantly-saved preference and checks that it really reached storage.
 * If it did not (e.g. storage blocked), the previous value is restored.
 */
function useInstantSave<T>(apply: (v: T) => void, persisted: (v: T) => boolean) {
  const [state, setState] = useState<SaveState>("idle");
  const save = (next: T, prev: T) => {
    apply(next);
    if (persisted(next)) {
      setState("saved");
    } else {
      apply(prev);
      setState("failed");
    }
  };
  return [state, save] as const;
}

function SaveStatus({ state }: { state: SaveState }) {
  if (state === "idle") return null;
  return <span role="status" className={cn("text-xs", state === "failed" ? "text-danger" : "text-fg-3")}>{SAVE_TEXT[state]}</span>;
}

export function GeneralSection() {
  const sendKey = useSendKey();
  const reduceMotion = useReduceMotionSetting();
  const [sendState, saveSendKey] = useInstantSave<SendKey>(setSendKey, (v) => readStored(SEND_KEY_STORAGE) === v);
  const [motionState, saveReduceMotion] = useInstantSave<boolean>(setReduceMotion, (v) => readStored(REDUCE_MOTION_STORAGE) === (v ? "1" : "0"));

  return (
    <div className="grid gap-8">
      <Section title="外观与语言" card>
        <SettingsRow label="主题" description="目前只有浅色主题。">
          <Badge tone="accent" icon={<Sun className="size-3" />}>浅色</Badge>
          <Badge tone="neutral" icon={<Moon className="size-3" />}>深色 · 未开放</Badge>
        </SettingsRow>
        <SettingsRow label="语言" description="界面语言目前只支持中文。">
          <Badge tone="neutral">简体中文</Badge>
        </SettingsRow>
      </Section>

      <Section title="输入与动效" card>
        <SettingsRow label="发送方式" description="选 Ctrl+Enter 时，Enter 用来换行；Shift+Enter 始终换行。">
          <div className="flex items-center gap-2">
            <SaveStatus state={sendState} />
            <Segmented<SendKey> value={sendKey} onChange={(v) => saveSendKey(v, sendKey)} options={SEND_OPTIONS} />
          </div>
        </SettingsRow>
        <SettingsRow label="减少动态效果" description="关闭头像的眨眼与过渡动画。同时遵循系统的“减少动态效果”设置。">
          <div className="flex items-center gap-2">
            <SaveStatus state={motionState} />
            <Switch aria-label="减少动态效果" checked={reduceMotion} onCheckedChange={(v) => saveReduceMotion(v, reduceMotion)} />
          </div>
        </SettingsRow>
      </Section>
    </div>
  );
}
