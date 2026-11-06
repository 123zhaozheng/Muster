import { Card, StatusBadge } from "@muster/ui";

const STEPS = ["在这台设备上保持 Muster 运行并在线", "在设备上启用远程浏览器", "成员需要操作网页时，会在这里展示画面，你可以随时接管"];

/** Honest "not connected" state: no live session, no fake controls. */
export function RemoteBrowserPanel() {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-section font-semibold text-fg">远程浏览器</h3>
          <p className="mt-0.5 text-sm text-fg-2">让成员替你操作网页，你随时可以接管。</p>
        </div>
        <StatusBadge>未接入</StatusBadge>
      </div>
      <p className="mt-4 text-sm text-fg-2">这台设备还没有接入远程浏览器，目前没有进行中的会话。该功能即将推出，接入后的步骤如下：</p>
      <ol className="mt-3 space-y-2">
        {STEPS.map((s, i) => (
          <li key={s} className="flex items-start gap-3 text-sm text-fg-2">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-surface-muted text-xs font-semibold text-fg-2">{i + 1}</span>
            <span className="pt-0.5">{s}</span>
          </li>
        ))}
      </ol>
    </Card>
  );
}
