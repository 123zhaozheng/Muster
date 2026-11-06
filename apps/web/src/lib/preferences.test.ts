import { afterEach, describe, expect, it } from "vitest";
import { readSendKey, setSendKey, shouldSend, SEND_KEY_STORAGE } from "./preferences";

afterEach(() => localStorage.clear());

const key = (init: Partial<Parameters<typeof shouldSend>[0]> = {}) => ({ key: "Enter", shiftKey: false, ctrlKey: false, metaKey: false, ...init });

describe("发送方式偏好", () => {
  it("默认 Enter 发送；设置后写入 localStorage 并可读回", () => {
    expect(readSendKey()).toBe("enter");
    setSendKey("ctrl-enter");
    expect(localStorage.getItem(SEND_KEY_STORAGE)).toBe("ctrl-enter");
    expect(readSendKey()).toBe("ctrl-enter");
  });

  it("Enter 模式：Enter 发送，Shift+Enter 换行，输入法组合中不发送", () => {
    expect(shouldSend(key(), "enter")).toBe(true);
    expect(shouldSend(key({ shiftKey: true }), "enter")).toBe(false);
    expect(shouldSend(key({ isComposing: true }), "enter")).toBe(false);
    expect(shouldSend(key({ key: "a" }), "enter")).toBe(false);
  });

  it("Ctrl+Enter 模式：只有 Ctrl / ⌘ + Enter 发送", () => {
    expect(shouldSend(key(), "ctrl-enter")).toBe(false);
    expect(shouldSend(key({ ctrlKey: true }), "ctrl-enter")).toBe(true);
    expect(shouldSend(key({ metaKey: true }), "ctrl-enter")).toBe(true);
    expect(shouldSend(key({ ctrlKey: true, isComposing: true }), "ctrl-enter")).toBe(false);
  });
});
