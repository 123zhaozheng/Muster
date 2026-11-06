import { Badge, Section, SettingsRow, Switch } from "@muster/ui";
import { useHub } from "../../lib/hub";

const DEFAULT_DAEMON = "ws://127.0.0.1:7788/ws";

const STATUS_BADGE = {
  open: { label: "已连接", tone: "success" },
  connecting: { label: "连接中", tone: "warning" },
  closed: { label: "已断开", tone: "danger" },
} as const;

/** 当前连接的 daemon 地址（与 startHub 的取值规则一致）。 */
function daemonUrl(): string {
  const q = new URLSearchParams(window.location.search + "&" + (window.location.hash.split("?")[1] ?? ""));
  return q.get("daemon") ?? DEFAULT_DAEMON;
}

function toggleMock(mock: boolean): void {
  if (mock) {
    localStorage.removeItem("muster.mock");
    // URL 里的 ?mock=1 会强制进入演示模式，一并清掉。
    const url = new URL(window.location.href);
    if (url.searchParams.has("mock")) {
      url.searchParams.delete("mock");
      window.history.replaceState(null, "", url);
    }
  } else {
    localStorage.setItem("muster.mock", "1");
  }
  window.location.reload();
}

/** daemon 地址、连接状态、演示模式。 */
export function ConnectionSection() {
  const status = useHub((s) => s.status);
  const mock = useHub((s) => s.mock);
  const badge = STATUS_BADGE[status];

  return (
    <Section title="连接" description="Muster 的后台守护进程，所有成员都跑在它里面。" card>
      <SettingsRow label="守护进程地址">
        <span className="max-w-[320px] truncate rounded-control bg-surface-muted px-2.5 py-1 font-mono text-xs text-fg" title={mock ? undefined : daemonUrl()}>
          {mock ? "演示模式（内置样例数据）" : daemonUrl()}
        </span>
      </SettingsRow>
      <SettingsRow label="连接状态">
        <Badge tone={badge.tone} dot>{badge.label}</Badge>
      </SettingsRow>
      <SettingsRow label="演示模式" description="使用内置样例数据，不连接守护进程。切换后会刷新页面。">
        <Switch aria-label="演示模式" checked={mock} onCheckedChange={() => toggleMock(mock)} />
      </SettingsRow>
    </Section>
  );
}
