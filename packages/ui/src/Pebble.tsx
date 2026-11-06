import { useEffect, useId, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import type { BotColor, BotStatus, PebbleShape } from "@muster/protocol";
import { cn } from "./cn";
import { useReducedMotion } from "./motion";

const COLOR_VAR: Record<BotColor, string> = {
  cream: "var(--color-pebble-cream)",
  mint: "var(--color-pebble-mint)",
  peach: "var(--color-pebble-peach)",
  sky: "var(--color-pebble-sky)",
  lilac: "var(--color-pebble-lilac)",
  rose: "var(--color-pebble-rose)",
  butter: "var(--color-pebble-butter)",
};

const BODY: Record<PebbleShape, string> = {
  round: "M50 14C74 14 90 32 90 56C90 78 74 90 50 90C26 90 10 78 10 56C10 32 26 14 50 14Z",
  square: "M30 18H70C82 18 90 26 90 38V68C90 82 82 90 68 90H32C18 90 10 82 10 68V38C10 26 18 18 30 18Z",
  blob: "M46 14C66 12 90 30 90 56C90 80 72 91 48 90C24 89 10 76 10 56C10 34 28 16 46 14Z",
  egg: "M50 8C70 8 84 40 84 62C84 80 70 91 50 91C30 91 16 80 16 62C16 40 30 8 50 8Z",
  flat: "M50 28C78 28 94 40 94 62C94 80 76 90 50 90C24 90 6 80 6 62C6 40 22 28 50 28Z",
};

/** Per-shape anchors: `top` = y of the head top (sprout root), `eyeY` = face centre. */
const META: Record<PebbleShape, { top: number; eyeY: number }> = {
  round: { top: 14, eyeY: 56 },
  square: { top: 18, eyeY: 54 },
  blob: { top: 14, eyeY: 56 },
  egg: { top: 8, eyeY: 55 },
  flat: { top: 28, eyeY: 62 },
};

const INK = "#3a2f2a";
const stroke = { stroke: INK, fill: "none", strokeLinecap: "round", strokeLinejoin: "round" } as const;

export interface PebbleProps {
  shape?: PebbleShape;
  color?: BotColor;
  status?: BotStatus;
  /** Suggested: 28-32 in nav / messages, 40-48 in lists, 72 max in empty states. */
  size?: number;
  className?: string;
  /** Accessible name. Without it the mascot is decorative (aria-hidden). */
  title?: string;
  /** false freezes everything (animations are also off under reduced motion). */
  animated?: boolean;
  /** Hover: eyes follow the cursor and the body perks up; click: a small hop. Default true. */
  interactive?: boolean;
  onClick?: () => void;
}

function Eyes({ y }: { y: number }) {
  return (
    <g fill={INK}>
      <circle cx={38} cy={y} r={5.4} />
      <circle cx={62} cy={y} r={5.4} />
      <circle cx={36.2} cy={y - 2} r={1.7} fill="#fff" />
      <circle cx={60.2} cy={y - 2} r={1.7} fill="#fff" />
    </g>
  );
}

interface Face {
  eyes: ReactNode;
  blink?: boolean;
  mouth: ReactNode;
  badge: ReactNode;
}

/** Face and a small status glyph per status: distinguishable without any animation. */
function face(status: BotStatus, y: number): Face {
  switch (status) {
    case "thinking":
      return {
        eyes: (
          <g fill={INK}>
            <circle cx={40} cy={y - 2} r={5.2} />
            <circle cx={64} cy={y - 2} r={5.2} />
            <circle cx={38.4} cy={y - 4.4} r={1.7} fill="#fff" />
            <circle cx={62.4} cy={y - 4.4} r={1.7} fill="#fff" />
          </g>
        ),
        blink: true,
        mouth: <path d={`M47 ${y + 12}h7`} {...stroke} strokeWidth="2.6" />,
        badge: (
          <g fill="var(--color-fg-3)">
            <circle className="pebble-dot" cx={78} cy={8} r={3} />
            <circle className="pebble-dot pebble-dot-b" cx={88} cy={4} r={3.4} />
            <circle className="pebble-dot pebble-dot-c" cx={99} cy={0} r={3.8} />
          </g>
        ),
      };
    case "working":
      return {
        eyes: (
          <g {...stroke} strokeWidth="3.6">
            <path d={`M30 ${y - 6}L41 ${y}L30 ${y + 6}`} />
            <path d={`M70 ${y - 6}L59 ${y}L70 ${y + 6}`} />
          </g>
        ),
        mouth: <path d={`M45 ${y + 10}q5 5 10 0`} {...stroke} strokeWidth="2.6" />,
        badge: (
          <g className="pebble-ticks" stroke="var(--color-accent)" strokeWidth="3.4" strokeLinecap="round">
            <path d="M78 14l4-7" />
            <path d="M87 18l7-3" />
            <path d="M89 28l6 1" />
          </g>
        ),
      };
    case "waiting_approval":
      return {
        eyes: <Eyes y={y} />,
        blink: true,
        mouth: <path d={`M46 ${y + 11}q4 3 8 0`} {...stroke} strokeWidth="2.6" />,
        badge: (
          <g>
            <circle className="pebble-ring" cx={14} cy={14} r={11} fill="none" stroke="var(--color-warning)" strokeWidth="1.6" />
            <g className="pebble-bang">
              <circle cx={14} cy={14} r={11} fill="var(--color-warning)" />
              <path d="M14 8v7" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" />
              <circle cx={14} cy={20} r={1.9} fill="#fff" />
            </g>
          </g>
        ),
      };
    case "done":
      return {
        eyes: (
          <g {...stroke} strokeWidth="3.6">
            <path d={`M31 ${y + 3}q6.5 -9 13 0`} />
            <path d={`M56 ${y + 3}q6.5 -9 13 0`} />
          </g>
        ),
        mouth: <path d={`M44 ${y + 9}q6 7 12 0`} {...stroke} strokeWidth="2.6" />,
        badge: (
          <g className="pebble-cheer">
            <circle cx={88} cy={14} r={11} fill="var(--color-success)" />
            <path d="M82.5 14.5l4 4 7-8" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </g>
        ),
      };
    case "error":
      return {
        eyes: (
          <g {...stroke} strokeWidth="3.4">
            <path d={`M32 ${y - 5}l10 10M42 ${y - 5}l-10 10`} />
            <path d={`M58 ${y - 5}l10 10M68 ${y - 5}l-10 10`} />
          </g>
        ),
        mouth: <path d={`M44 ${y + 12}q3 -3 6 0t6 0`} {...stroke} strokeWidth="2.4" />,
        badge: (
          <g className="pebble-alert">
            <circle cx={88} cy={14} r={11} fill="var(--color-danger)" />
            <path d="M88 8v7" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" />
            <circle cx={88} cy={20} r={1.9} fill="#fff" />
          </g>
        ),
      };
    case "sleeping":
      return {
        eyes: (
          <g {...stroke} strokeWidth="3.4">
            <path d={`M30 ${y}q6.5 6.5 13 0`} />
            <path d={`M57 ${y}q6.5 6.5 13 0`} />
          </g>
        ),
        mouth: <path d={`M47 ${y + 12}q3 2.5 6 0`} {...stroke} strokeWidth="2.4" />,
        badge: (
          <g fontWeight="700" fontFamily="system-ui, sans-serif" fill="var(--color-fg-3)">
            <text className="pebble-zzz" x="80" y="14" fontSize="16">z</text>
            <text className="pebble-zzz pebble-zzz-b" x="92" y="2" fontSize="11">z</text>
          </g>
        ),
      };
    default:
      return {
        eyes: <Eyes y={y} />,
        blink: true,
        mouth: <path d={`M45.5 ${y + 10}q4.5 4 9 0`} {...stroke} strokeWidth="2.6" />,
        badge: null,
      };
  }
}

function frac(seed: string, salt: number): number {
  let h = salt;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 9973;
  return (h % 1000) / 1000;
}

/** Squash & stretch when the status changes (~260ms). */
const SQUASH: Keyframe[] = [
  { transform: "scale(1, 1)" },
  { transform: "scale(1.1, 0.9)", offset: 0.3 },
  { transform: "scale(0.96, 1.06)", offset: 0.62 },
  { transform: "scale(1, 1)" },
];
/** Click: a small hop. */
const HOP: Keyframe[] = [
  { transform: "translateY(0) scale(1, 1)" },
  { transform: "translateY(0) scale(1.1, 0.88)", offset: 0.18 },
  { transform: "translateY(-9px) scale(0.95, 1.08)", offset: 0.45 },
  { transform: "translateY(0) scale(1.06, 0.94)", offset: 0.72 },
  { transform: "translateY(0) scale(1, 1)" },
];
const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

/**
 * The mascot: 5 body shapes x 7 status expressions, readable without motion.
 * Alive by default: CSS keyframes drive a gentle per-status loop (breathing, blinking, sprout sway,
 * thinking dots, working bob, waving "!" badge, sleepy z's...), Web Animations drive the squash on a
 * status change and the click hop; on hover the eyes follow the cursor. Fully still under reduced
 * motion (system prefers-reduced-motion or the in-app setting) and with `animated={false}`.
 */
export function Pebble({ shape = "round", color = "cream", status = "idle", size = 40, className, title, animated = true, interactive = true, onClick }: PebbleProps) {
  const uid = useId().replace(/:/g, "");
  const reduced = useReducedMotion();
  const live = animated && !reduced;
  const canInteract = live && interactive;
  const fill = COLOR_VAR[color];
  const { top, eyeY } = META[shape];
  const d = BODY[shape];
  const { eyes, blink, mouth, badge } = face(status, eyeY);

  const svgRef = useRef<SVGSVGElement>(null);
  const transRef = useRef<SVGGElement>(null);
  const popRef = useRef<SVGGElement>(null);
  const prevStatus = useRef(status);
  useEffect(() => {
    if (prevStatus.current === status) return;
    prevStatus.current = status;
    if (live) transRef.current?.animate?.(SQUASH, { duration: 260, easing: EASE });
  }, [status, live]);

  const onPointerMove = canInteract
    ? (e: ReactPointerEvent<SVGSVGElement>) => {
        const el = svgRef.current;
        const r = el?.getBoundingClientRect();
        if (!el || !r?.width) return;
        const nx = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (r.width / 2)));
        const ny = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height * 0.55)) / (r.height / 2)));
        el.style.setProperty("--ex", (nx * 3).toFixed(2));
        el.style.setProperty("--ey", (ny * 2.2).toFixed(2));
      }
    : undefined;
  const onPointerLeave = canInteract
    ? () => {
        svgRef.current?.style.setProperty("--ex", "0");
        svgRef.current?.style.setProperty("--ey", "0");
      }
    : undefined;
  const handleClick =
    canInteract || onClick
      ? () => {
          if (canInteract) popRef.current?.animate?.(HOP, { duration: 520, easing: EASE });
          onClick?.();
        }
      : undefined;

  const blinkPeriod = 3.6 + frac(uid, 7) * 2.6;
  const style = {
    "--pb-blink": `${blinkPeriod.toFixed(2)}s`,
    "--pb-blink-d": `${(-frac(uid, 13) * blinkPeriod).toFixed(2)}s`,
    "--pb-sway-d": `${(-frac(uid, 29) * 3.6).toFixed(2)}s`,
  } as CSSProperties;
  const sprouting = status === "sleeping" ? "rotate(-12 50 21)" : undefined;

  return (
    <svg
      ref={svgRef}
      viewBox="-8 -12 116 118"
      width={size}
      height={size}
      overflow="visible"
      className={cn("pebble shrink-0", live && "pebble-live", canInteract && "pebble-interactive", className)}
      style={style}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      data-status={status}
      data-shape={shape}
      data-color={color}
      data-motion={live ? "live" : "still"}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      onClick={handleClick}
    >
      <defs>
        <linearGradient id={`${uid}s`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0.55" stopColor="#5b2a10" stopOpacity="0" />
          <stop offset="1" stopColor="#5b2a10" stopOpacity="0.16" />
        </linearGradient>
      </defs>

      <g ref={transRef} className="pebble-trans">
        <g ref={popRef} className="pebble-pop">
          <g className="pebble-body">
            <g transform={`translate(0 ${top - 14})`}>
              <g className="pebble-sprout" transform={sprouting}>
                <path d="M50 21V8" stroke="#5fbf6e" strokeWidth="3.8" strokeLinecap="round" />
                <path d="M50 10C42 0 30 4 33 13C41 17 48 16 50 10Z" fill="#8bd596" />
                <path d="M50 10C58 0 70 4 67 13C59 17 52 16 50 10Z" fill="#5fbf6e" />
              </g>
            </g>

            <path d={d} fill={fill} />
            <path d={d} fill={`url(#${uid}s)`} />
            <path d={d} fill="none" stroke="#5b2a10" strokeOpacity="0.14" strokeWidth="1" />
            <ellipse cx="32" cy={top + 16} rx="9" ry="4.4" fill="#fff" opacity="0.4" transform={`rotate(-28 32 ${top + 16})`} />

            <g className="pebble-cheeks" fill="#ff7d6a" opacity="0.3">
              <ellipse cx="25.5" cy={eyeY + 7} rx="6.4" ry="3.6" />
              <ellipse cx="74.5" cy={eyeY + 7} rx="6.4" ry="3.6" />
            </g>

            <g className="pebble-look">
              <g className={cn(status === "idle" && "pebble-glance")}>
                <g className={cn(blink && "pebble-blink")}>{eyes}</g>
              </g>
            </g>
            {mouth}
          </g>
        </g>
      </g>

      {badge}
    </svg>
  );
}
