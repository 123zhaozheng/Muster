import { useState } from "react";
import { useNavigate } from "react-router";
import type { Bot, Task } from "@muster/protocol";
import { Badge, Button, Card, Chip, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, IconButton, Pebble, StatusPill, cn } from "@muster/ui";
import { Cpu, MessageCircle, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { KIND_LABEL, KIND_TONE, SKILL_TONE, hasModel, isMainBot, latestTask } from "./meta";

export interface CrewCardProps {
  bot: Bot;
  tasks: Task[];
  onEdit: (bot: Bot) => void;
  onDelete: (bot: Bot) => void;
  /** 刚创建：播放入场动画。 */
  fresh?: boolean;
}

export function CrewCard({ bot, tasks, onEdit, onDelete, fresh }: CrewCardProps) {
  const navigate = useNavigate();
  const [hint, setHint] = useState(false);
  const isMain = isMainBot(bot);
  const removable = !isMain && !bot.builtin;
  const kindLabel = KIND_LABEL[bot.kind];
  const running = tasks.find((t) => t.botId === bot.id && (t.status === "running" || t.status === "waiting_approval"));
  const current = bot.statusDetail ?? running?.title;
  const subtitle = bot.engineLabel !== kindLabel ? bot.engineLabel : bot.tagline;

  function chat() {
    if (isMain) return navigate("/");
    const task = latestTask(tasks, bot.id);
    if (task) return navigate(`/task/${task.id}`);
    setHint(true);
  }

  return (
    <Card hoverable frosted className={cn("group/crew flex flex-col overflow-hidden", fresh && "muster-rise ring-2 ring-coral/40")} data-testid="crew-card" data-bot-id={bot.id}>
      {/* 头部：同色系光晕 + 大号会动的 Pebble */}
      <div
        className="relative flex flex-col items-center px-5 pb-3 pt-6"
        style={{ background: `radial-gradient(120% 90% at 50% 0%, color-mix(in srgb, var(--color-pebble-${bot.color}) 55%, transparent), transparent 75%)` }}
      >
        <div className="absolute right-3 top-3 flex gap-1 opacity-0 transition-opacity duration-200 focus-within:opacity-100 group-hover/crew:opacity-100 max-md:opacity-100">
          <IconButton label={`编辑${bot.name}`} size="sm" variant="outline" onClick={() => onEdit(bot)}>
            <Pencil />
          </IconButton>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton label={`${bot.name}更多操作`} size="sm" variant="outline" tooltip={false}>
                <MoreHorizontal />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem icon={<Pencil size={16} />} onSelect={() => onEdit(bot)}>编辑</DropdownMenuItem>
              {removable ? (
                <DropdownMenuItem danger icon={<Trash2 size={16} />} onSelect={() => onDelete(bot)}>删除</DropdownMenuItem>
              ) : (
                <DropdownMenuItem disabled icon={<Trash2 size={16} />}>{isMain ? "主 Bot 不可删除" : "内置成员不可删除"}</DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <Pebble shape={bot.shape} color={bot.color} status={bot.status} size={116} title={bot.name} />
        <h2 className="mt-3 max-w-full truncate text-lg font-semibold text-ink">{bot.name}</h2>
        <div className="mt-1.5 flex flex-wrap items-center justify-center gap-1.5">
          <Badge tone={KIND_TONE[bot.kind]} variant="soft">{kindLabel}</Badge>
          {hasModel(bot) && (
            <Chip icon={<Cpu size={12} />} title={isMain ? "Pip 的路由模型" : "使用的模型"}>
              {bot.model?.modelId ?? "默认模型"}
            </Chip>
          )}
        </div>
        {subtitle && <p className="mt-1.5 max-w-full truncate text-sm text-ink-soft">{subtitle}</p>}
      </div>

      <div className="flex flex-1 flex-col gap-3 px-5 pb-5">
        <div className="flex items-center justify-between gap-2">
          <StatusPill status={bot.status} />
          <span className="min-w-0 truncate text-xs text-ink-faint" title={current}>{current ?? "暂无进行中的任务"}</span>
        </div>

        <div className="flex items-end justify-between border-t border-line pt-3">
          <div>
            <div className="text-xs text-ink-soft">本周已用</div>
            <div className="text-xl font-semibold tabular-nums text-ink">${bot.costWeekUsd.toFixed(2)}</div>
          </div>
        </div>

        <div className="flex min-h-7 flex-wrap gap-1.5">
          {bot.skills.length ? bot.skills.map((s) => <Chip key={s} tone={SKILL_TONE[bot.color]}>{s}</Chip>) : <span className="text-xs text-ink-faint">还没有技能标签</span>}
        </div>

        <Button variant={isMain ? "primary" : "outline"} className="mt-auto w-full" icon={<MessageCircle size={16} />} onClick={chat} aria-label={`和${bot.name}聊天`}>
          聊天
        </Button>
        {hint && <p role="status" className="text-center text-xs text-ink-soft">还没有任务，回主线派一个吧</p>}
      </div>
    </Card>
  );
}
