// Local UI preferences that live in localStorage and are shared across pages.
import { useSyncExternalStore } from "react";

/** How the main composer sends: plain Enter, or Ctrl/Cmd+Enter (Enter then inserts a newline). */
export type SendKey = "enter" | "ctrl-enter";

export const SEND_KEY_STORAGE = "muster.sendKey";

const listeners = new Set<() => void>();

export function readSendKey(): SendKey {
  try {
    return localStorage.getItem(SEND_KEY_STORAGE) === "ctrl-enter" ? "ctrl-enter" : "enter";
  } catch {
    return "enter";
  }
}

export function setSendKey(value: SendKey): void {
  try {
    localStorage.setItem(SEND_KEY_STORAGE, value);
  } catch {
    /* private mode: nothing to persist */
  }
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

/** Current send-key preference; re-renders when the setting changes (also across tabs). */
export function useSendKey(): SendKey {
  return useSyncExternalStore(subscribe, readSendKey, () => "enter");
}

interface SendKeyEvent {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  /** True while an IME composition is active: Enter then confirms the candidate and must not send. */
  isComposing?: boolean;
}

/** Whether this keydown should send the message under the given preference. Shift+Enter always means newline. */
export function shouldSend(e: SendKeyEvent, sendKey: SendKey): boolean {
  if (e.key !== "Enter" || e.isComposing || e.shiftKey) return false;
  return sendKey === "ctrl-enter" ? e.ctrlKey || e.metaKey : true;
}
