import type { Bot } from "@muster/protocol";
import { Badge, Button, Card } from "@muster/ui";
import { Pencil } from "lucide-react";
import { BotStatusBadge, MemberAvatar } from "../common";

/** Pip, the coordinator: one slim row above the member grid. */
export function PipRow({ bot, onEdit }: { bot: Bot; onEdit: (bot: Bot) => void }) {
  return (
    <Card className="flex flex-wrap items-center gap-x-4 gap-y-3 p-4 md:px-5" data-testid="pip-row">
      <MemberAvatar bot={bot} size={48} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h2 className="truncate text-section font-semibold text-fg">{bot.name}</h2>
          <Badge size="sm">协调伙伴</Badge>
        </div>
        <p className="truncate text-sm text-fg-2">{bot.tagline ?? "理解你的想法，安排合适的成员"}</p>
      </div>
      <BotStatusBadge status={bot.status} />
      <Button variant="secondary" size="sm" icon={<Pencil size={14} />} onClick={() => onEdit(bot)} aria-label={`编辑${bot.name}`}>
        编辑
      </Button>
    </Card>
  );
}
