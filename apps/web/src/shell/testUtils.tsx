// 外壳测试共用的挂载与复位工具。
import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { emptyModel } from "@muster/protocol/reducer";
import { attachClient, useHub } from "../lib/hub";
import { createMockClient } from "../lib/mockClient";
import { useCommandPalette } from "./CommandPalette";
import { Shell } from "./Shell";
import { useSidebar } from "./sidebarState";

let detach: (() => void) | undefined;

/** jsdom 缺少 Radix 浮层需要的 ResizeObserver / scrollIntoView。 */
export function stubBrowser(): void {
  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver ??= RO;
  Element.prototype.scrollIntoView ??= () => undefined;
}

export function resetShellState(): void {
  localStorage.clear();
  useSidebar.setState({ pref: false, narrow: false, override: null, recentOpen: true });
  useCommandPalette.setState({ open: false });
  useHub.setState({ model: emptyModel(), status: "connecting", client: null, mock: false, loadedThreads: {} });
}

export function teardownShell(): void {
  detach?.();
  detach = undefined;
  useHub.getState().client?.close();
}

export function LocationProbe() {
  const l = useLocation();
  return <div data-testid="loc">{l.pathname + l.search}</div>;
}

export function mountShell(path = "/") {
  detach = attachClient(createMockClient(), true);
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<Shell />}>
          <Route path="*" element={<LocationProbe />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}
