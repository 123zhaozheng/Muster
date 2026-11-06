import type { Bot } from "@muster/protocol";
import { Pebble } from "@muster/ui";

/** Bot -> mascot, driven by bot.status. Shared by every page (OWNER: lead; F1 may restyle but keep the props). */
export function BotAvatar({ bot, size = 40, className }: { bot: Pick<Bot, "shape" | "color" | "status" | "name">; size?: number; className?: string }) {
  return <Pebble shape={bot.shape} color={bot.color} status={bot.status} size={size} className={className} title={bot.name} />;
}
