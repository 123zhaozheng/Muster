import type { Bot, BotStatus } from "@muster/protocol";
import { Dot, Pebble, cn } from "@muster/ui";
import { botStatusMeta } from "../../lib/status";

/** Statuses whose corner dot pings (the member is busy or needs you). */
const LIVE: ReadonlySet<BotStatus> = new Set(["working", "thinking", "waiting_approval"]);

interface MemberAvatarProps {
  bot: Pick<Bot, "shape" | "color" | "status" | "name">;
  /** 28-32 in nav / messages, 40-48 in lists, 72 at most in empty states. */
  size?: number;
  /** Small status dot at the bottom-right corner (tone from lib/status); pings while busy / waiting. */
  statusDot?: boolean;
  className?: string;
}

/** A member's Pebble: shape, colour, expression and its little status animation all come from the bot. */
export function MemberAvatar({ bot, size = 40, statusDot, className }: MemberAvatarProps) {
  const pebble = <Pebble shape={bot.shape} color={bot.color} status={bot.status} size={size} title={bot.name} />;
  if (!statusDot) return className ? <span className={cn("inline-flex shrink-0", className)}>{pebble}</span> : pebble;
  const meta = botStatusMeta(bot.status);
  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      {pebble}
      <Dot tone={meta.tone} pulse={LIVE.has(bot.status)} size={Math.max(8, Math.round(size / 4))} role="img" aria-label={meta.label} className="absolute -bottom-0.5 -right-0.5 ring-2 ring-canvas" />
    </span>
  );
}
