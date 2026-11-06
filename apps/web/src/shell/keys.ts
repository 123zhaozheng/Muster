// 快捷键相关的小工具。

export const isMac = (): boolean => typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || "");

/** UI 上展示用的修饰键： Mac 为 ⌘，其余为 Ctrl。 */
export const modLabel = (): string => (isMac() ? "⌘" : "Ctrl");

/** 事件是否带了“主修饰键”（Mac: ⌘；其余: Ctrl；两者任一都接受，方便外接键盘）。 */
export const hasMod = (e: Pick<KeyboardEvent, "ctrlKey" | "metaKey">): boolean => e.ctrlKey || e.metaKey;
