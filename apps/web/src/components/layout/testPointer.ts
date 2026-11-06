// 测试工具：jsdom 下的指针拖动。
import { fireEvent } from "@testing-library/react";

/** jsdom 没有 PointerEvent 时用 MouseEvent 补上（保留 clientX / pointerId）。 */
export function ensurePointerEvent(): void {
  if (typeof window.PointerEvent === "function") return;
  class PE extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
    }
  }
  (window as unknown as { PointerEvent: typeof PE }).PointerEvent = PE;
}

/** 在分隔条上按下 → 移动 dx → 松开（或取消）。 */
export function drag(el: HTMLElement, dx: number, end: "up" | "cancel" = "up"): void {
  fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX: 500 });
  fireEvent.pointerMove(el, { pointerId: 1, clientX: 500 + dx });
  if (end === "up") fireEvent.pointerUp(el, { pointerId: 1, clientX: 500 + dx });
  else fireEvent.pointerCancel(el, { pointerId: 1, clientX: 500 + dx });
}
