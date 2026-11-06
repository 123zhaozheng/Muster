import { useState } from "react";
import { Link, useNavigate } from "react-router";
import type { Bot, Task } from "@muster/protocol";
import { Badge, Button, Card } from "@muster/ui";
import { MessageCircle, Settings2 } from "lucide-react";
import { BotStatusBadge, MemberAvatar } from "../common";
import { intro, latestTask, modelTag, specialty } from "./meta";

export interface MemberCardProps {
  bot: Bot;
  tasks: Task[];
  onConfigure: (bot: Bot) => void;
}

/** One team member: who they are, what they are good at, what they did last. */
export function MemberCard({ bot, tasks, onConfigure }: MemberCardProps) {
  const navigate = useNavigate();
  const [noTask, setNoTask] = useState(false);
  const last = latestTask(tasks, bot.id);
  const spec = specialty(bot);

  function message() {
    if (last) return navigate(`/task/${last.id}`);
    setNoTask(true);
  }

  return (
    <Card className="flex flex-col gap-3 p-5" data-testid="crew-card" data-bot-id={bot.id}>
      <div className="flex items-start gap-3">
        <MemberAvatar bot={bot} size={44} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-section font-semibold leading-7 text-fg">{bot.name}</h2>
          <div className="flex items-center gap-2 text-sm text-fg-2">
            {spec && <span className="min-w-0 truncate">{spec}</span>}
            <Badge variant="outline" size="sm" className="shrink-0">{modelTag(bot)}</Badge>
          </div>
        </div>
        <BotStatusBadge status={bot.status} className="shrink-0" />
      </div>

      <p className="line-clamp-2 text-body text-fg-2">{intro(bot)}</p>
      <p className="truncate text-sm text-fg-2">技能：{bot.skills.length ? bot.skills.join("、") : "未设置"}</p>

      <div className="mt-auto flex items-center gap-3 border-t border-border pt-3">
        <p className="min-w-0 flex-1 truncate text-sm text-fg-2">
          {noTask ? (
            <span role="status">还没有任务，回主线派一个吧</span>
          ) : last ? (
            <>
              最近任务：
              <Link to={`/task/${last.id}`} className="rounded-sm text-fg hover:text-accent focus-visible:outline-2 focus-visible:outline-accent">
                {last.title}
              </Link>
            </>
          ) : (
            "最近任务：暂无"
          )}
        </p>
        <Button variant="ghost" size="sm" icon={<MessageCircle size={16} />} onClick={message} aria-label={`给${bot.name}发消息`}>
          发消息
        </Button>
        <Button variant="ghost" size="sm" icon={<Settings2 size={16} />} onClick={() => onConfigure(bot)} aria-label={`配置${bot.name}`}>
          配置
        </Button>
      </div>
    </Card>
  );
}
