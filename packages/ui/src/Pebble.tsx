import { useEffect, useId, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import type { BotColor, BotStatus, PebbleShape } from "@muster/protocol";
import { cn } from "./cn";
import { usePrefersReducedMotion } from "./motion";

export const STATUS_LABEL: Record<BotStatus, string> = {
  idle: "空闲",
  thinking: "思考",
  working: "工作中",
  waiting_approval: "等你审批",
  done: "已完成",
  error: "出错",
  sleeping: "睡眠",
};

/** Unified status colours (docs/10): working=mint, thinking=lavender, waiting=amber, error=red, done=mint, idle/sleeping=grey. */
export const STATUS_COLOR: Record<BotStatus, string> = {
  idle: "#a69b92",
  thinking: "#8b7cf6",
  working: "#34c58a",
  waiting_approval: "#f5a524",
  done: "#34c58a",
  error: "#e5484d",
  sleeping: "#a69b92",
};

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

/** Per-shape anchors: `top` = y of the head top (sprout root), `eyeY` = face centre, `edge` = body half-width near the arms. */
const META: Record<PebbleShape, { top: number; eyeY: number; edge: number }> = {
  round: { top: 14, eyeY: 56, edge: 40 },
  square: { top: 18, eyeY: 54, edge: 40 },
  blob: { top: 14, eyeY: 56, edge: 39 },
  egg: { top: 8, eyeY: 55, edge: 33 },
  flat: { top: 28, eyeY: 62, edge: 43 },
};

const INK = "#3a2f2a";

export type PebbleMood = "calm" | "normal" | "lively";
const MOOD_K: Record<PebbleMood, number> = { calm: 0.6, normal: 1, lively: 1.5 };

export interface PebbleProps {
  shape?: PebbleShape;
  color?: BotColor;
  status?: BotStatus;
  size?: number;
  className?: string;
  title?: string;
  /** Set false to freeze every animation and interaction (animations already respect prefers-reduced-motion). Default true. */
  animated?: boolean;
  /** Hover: eyes follow the cursor and the body perks up; click: squash & stretch hop. Default true. */
  interactive?: boolean;
  /** Cheap mode for list avatars: only breathing + blinking, no sprout/extras animation, no interaction. */
  lite?: boolean;
  /** Soft status-coloured glow behind the body. */
  halo?: boolean;
  /** Animation intensity: "calm" 0.6x, "normal" 1x, "lively" 1.5x, or a custom multiplier. */
  mood?: PebbleMood | number;
  onClick?: () => void;
}

function Eye({ cx, cy, r = 5.8, fill }: { cx: number; cy: number; r?: number; fill: string }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill={fill} />
      <circle cx={cx - r * 0.3} cy={cy - r * 0.38} r={r * 0.36} fill="#fff" />
      <circle cx={cx + r * 0.32} cy={cy + r * 0.4} r={r * 0.16} fill="#fff" opacity="0.75" />
    </g>
  );
}

const stroke = { stroke: INK, fill: "none", strokeLinecap: "round", strokeLinejoin: "round" } as const;

function spiralPath(cx: number, cy: number, r: number, turns = 2.3, steps = 30): string {
  let d = "";
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = t * turns * Math.PI * 2;
    const rad = r * t;
    d += `${i ? "L" : "M"}${(cx + rad * Math.cos(a)).toFixed(1)} ${(cy + rad * Math.sin(a)).toFixed(1)}`;
  }
  return d;
}

interface FaceParts {
  eyes: ReactNode;
  /** Wrap eyes in the blink group (round bead eyes only). */
  blink?: boolean;
  /** Wrap eyes in the idle "glance around" group. */
  glance?: boolean;
  mouth: ReactNode;
  extras: ReactNode;
}

/** Face (eyes + mouth) and floating decorations for each status. */
function face(status: BotStatus, y: number, eyeFill: string): FaceParts {
  const smile = <path d={`M45.5 ${y + 10}q4.5 4 9 0`} {...stroke} strokeWidth="2.6" />;
  switch (status) {
    case "thinking":
      return {
        eyes: (
          <g>
            {[36, 64].map((cx) => (
              <g key={cx}>
                <circle cx={cx} cy={y} r="7.8" fill="#fff" stroke={INK} strokeOpacity="0.18" strokeWidth="1" />
                <g className="pebble-pupil">
                  <circle cx={cx} cy={y - 1} r="4.3" fill={eyeFill} />
                  <circle cx={cx + 1.3} cy={y - 2.7} r="1.4" fill="#fff" />
                </g>
              </g>
            ))}
          </g>
        ),
        blink: true,
        mouth: <path d={`M47 ${y + 12}h7`} {...stroke} strokeWidth="2.6" />,
        extras: (
          <g className="pebble-bubble">
            <rect x="70" y="-11" width="31" height="19" rx="9.5" fill="#fff" stroke="#8b7cf6" strokeOpacity="0.35" strokeWidth="1.2" />
            <circle cx="72" cy="13" r="2.4" fill="#fff" stroke="#8b7cf6" strokeOpacity="0.35" strokeWidth="1" />
            <circle cx="67.5" cy="18" r="1.5" fill="#fff" stroke="#8b7cf6" strokeOpacity="0.35" strokeWidth="1" />
            {[79, 85.5, 92].map((cx, i) => (
              <circle key={cx} className={cn("pebble-dot", i === 1 && "pebble-dot-b", i === 2 && "pebble-dot-c")} cx={cx} cy="-1.5" r="2.3" fill="#8b7cf6" />
            ))}
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
        extras: (
          <g>
            <g className="pebble-ticks" stroke="#ff9a3c" strokeWidth="3.2" strokeLinecap="round">
              <path d="M74 12l4-6" />
              <path d="M83 16l7-3" />
              <path d="M85 26l6 1" />
            </g>
            <g stroke="#ff9a3c" strokeWidth="2.6" strokeLinecap="round" fill="none">
              <path className="pebble-streak" d="M-1 50h9" />
              <path className="pebble-streak pebble-streak-b" d="M-5 60h12" />
              <path className="pebble-streak pebble-streak-c" d="M-2 70h9" />
            </g>
          </g>
        ),
      };
    case "waiting_approval":
      return {
        eyes: (
          <g>
            <Eye cx={38} cy={y} fill={eyeFill} />
            <Eye cx={62} cy={y} fill={eyeFill} />
          </g>
        ),
        blink: true,
        mouth: <path d={`M46 ${y + 11}q4 3 8 0`} {...stroke} strokeWidth="2.6" />,
        extras: (
          <g>
            <circle className="pebble-ring" cx="14" cy="14" r="10" fill="none" stroke="#f5a524" strokeWidth="1.8" />
            <g className="pebble-bang">
              <path d="M14 3v10" stroke="#f5a524" strokeWidth="4.6" strokeLinecap="round" />
              <circle cx="14" cy="21" r="2.8" fill="#f5a524" />
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
        extras: (
          <g fill="#ffbf3c">
            <path className="pebble-twinkle" d="M82 4l2.4 6.2L91 12.6l-6.6 2.4L82 21l-2.4-6L73 12.6l6.6-2.4z" />
            <path className="pebble-twinkle pebble-twinkle-b" d="M95 28l1.3 3.4 3.4 1.3-3.4 1.3L95 37.4l-1.3-3.4-3.4-1.3 3.4-1.3z" />
            <circle className="pebble-twinkle pebble-twinkle-c" cx="6" cy="14" r="2.2" fill="#ff9a8a" />
            <circle className="pebble-twinkle pebble-twinkle-b" cx="97" cy="12" r="1.8" fill="#8b7cf6" />
          </g>
        ),
      };
    case "error":
      return {
        eyes: (
          <g>
            {[35.5, 64.5].map((cx) => (
              <g key={cx}>
                <circle cx={cx} cy={y} r="7.8" fill="#fff" stroke={INK} strokeOpacity="0.2" strokeWidth="1" />
                <g className="pebble-swirl">
                  <circle cx={cx} cy={y} r="6" fill="none" />
                  <path d={spiralPath(cx, y, 5.6)} {...stroke} strokeWidth="1.7" />
                </g>
              </g>
            ))}
          </g>
        ),
        mouth: <path d={`M44 ${y + 12}q3 -3 6 0t6 0`} {...stroke} strokeWidth="2.4" />,
        extras: (
          <g className="pebble-spin" fill="none" stroke="#a79bb8" strokeWidth="2.2" strokeLinecap="round">
            <path d={spiralPath(84, 12, 9, 2.1)} />
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
        extras: (
          <g fontWeight="800" fontFamily="system-ui, sans-serif" fill="#8b7cf6">
            <text className="pebble-zzz" x="72" y="14" fontSize="15">Z</text>
            <text className="pebble-zzz pebble-zzz-b" x="84" y="4" fontSize="11" fill="#5aa9f5">z</text>
            <text className="pebble-zzz pebble-zzz-c" x="92" y="-4" fontSize="8" fill="#a69be0">z</text>
          </g>
        ),
      };
    default:
      return {
        eyes: (
          <g>
            <Eye cx={38} cy={y} fill={eyeFill} />
            <Eye cx={62} cy={y} fill={eyeFill} />
          </g>
        ),
        blink: true,
        glance: true,
        mouth: smile,
        extras: null,
      };
  }
}

function frac(seed: string, salt: number): number {
  let h = salt;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 9973;
  return (h % 1000) / 1000;
}

const SQUASH_STATUS: Keyframe[] = [
  { transform: "scale(1,1)" },
  { transform: "scale(1.13,0.87)", offset: 0.3 },
  { transform: "scale(0.94,1.1)", offset: 0.62 },
  { transform: "scale(1,1)" },
];
const POP_KEYS: Keyframe[] = [
  { transform: "translateY(0) scale(1,1)" },
  { transform: "translateY(0) scale(1.14,0.84)", offset: 0.18 },
  { transform: "translateY(-11px) scale(0.93,1.12)", offset: 0.45 },
  { transform: "translateY(0) scale(1.1,0.9)", offset: 0.72 },
  { transform: "translateY(0) scale(1,1)" },
];

/**
 * The mascot. 5 body shapes x 7 status expressions; scales cleanly from 16 to 200 px.
 * Always alive: CSS keyframes drive the per-status loops (cheap enough for 30 on one screen),
 * Web Animations drive the squash&stretch on status change and the click hop.
 */
export function Pebble({
  shape = "round",
  color = "cream",
  status = "idle",
  size = 40,
  className,
  title,
  animated = true,
  interactive = true,
  lite = false,
  halo = false,
  mood = "normal",
  onClick,
}: PebbleProps) {
  const uid = useId().replace(/:/g, "");
  const reduced = usePrefersReducedMotion();
  const live = animated && !reduced;
  const canInteract = live && interactive && !lite;
  const fill = COLOR_VAR[color];
  const { top, eyeY, edge } = META[shape];
  const d = BODY[shape];
  const eyeFill = `url(#${uid}e)`;
  const { eyes, blink, glance, mouth, extras } = face(status, eyeY, eyeFill);
  const armY = eyeY + 15;
  const raised = status === "waiting_approval";
  const k = typeof mood === "number" ? mood : MOOD_K[mood];

  const svgRef = useRef<SVGSVGElement>(null);
  const transRef = useRef<SVGGElement>(null);
  const popRef = useRef<SVGGElement>(null);
  const prevStatus = useRef(status);

  // 200ms-ish squash & stretch whenever the status changes
  useEffect(() => {
    if (prevStatus.current === status) return;
    prevStatus.current = status;
    if (!live) return;
    transRef.current?.animate?.(SQUASH_STATUS, { duration: 260, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
  }, [status, live]);

  const onPointerMove = canInteract
    ? (e: ReactPointerEvent<SVGSVGElement>) => {
        const el = svgRef.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        if (!r.width) return;
        const nx = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (r.width / 2)));
        const ny = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height * 0.55)) / (r.height / 2)));
        el.style.setProperty("--ex", (nx * 3.4).toFixed(2));
        el.style.setProperty("--ey", (ny * 2.4).toFixed(2));
      }
    : undefined;
  const onPointerLeave = canInteract
    ? () => {
        svgRef.current?.style.setProperty("--ex", "0");
        svgRef.current?.style.setProperty("--ey", "0");
      }
    : undefined;
  const onSvgClick = (canInteract || onClick)
    ? () => {
        if (canInteract) popRef.current?.animate?.(POP_KEYS, { duration: 520, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
        onClick?.();
      }
    : undefined;

  const eyeNode = (
    <g className="pebble-look">
      <g className={cn(glance && "pebble-glance")}>
        <g className={cn(blink && "pebble-blink")}>{eyes}</g>
      </g>
    </g>
  );

  const blinkPeriod = 3.4 + frac(uid, 7) * 2.4;
  const style = {
    "--pb-k": k,
    "--pb-blink": `${blinkPeriod.toFixed(2)}s`,
    "--pb-blink-d": `${(-frac(uid, 13) * blinkPeriod).toFixed(2)}s`,
    "--pb-sway-d": `${(-frac(uid, 29) * 3.6).toFixed(2)}s`,
  } as CSSProperties;
  const statusColor = STATUS_COLOR[status];
  const shade = `color-mix(in oklab, ${fill} 72%, #5b2a10)`;
  const light = `color-mix(in oklab, ${fill} 55%, #ffffff)`;

  return (
    <svg
      ref={svgRef}
      viewBox="-8 -12 116 118"
      width={size}
      height={size}
      overflow="visible"
      className={cn(
        "pebble shrink-0",
        live && `pebble-anim-${status}`,
        live && lite && "pebble-lite",
        canInteract && "pebble-interactive",
        className,
      )}
      style={style}
      role="img"
      aria-label={title ?? STATUS_LABEL[status]}
      data-status={status}
      data-shape={shape}
      data-color={color}
      data-motion={live ? (lite ? "lite" : "full") : "still"}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      onClick={onSvgClick}
    >
      <defs>
        <radialGradient id={`${uid}h`} cx="32%" cy="22%" r="72%">
          <stop offset="0" stopColor="#fff" stopOpacity="0.85" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.14" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${uid}s`} x1="0" y1="0" x2="0.15" y2="1">
          <stop offset="0.5" style={{ stopColor: shade }} stopOpacity="0" />
          <stop offset="1" style={{ stopColor: shade }} stopOpacity="0.62" />
        </linearGradient>
        <radialGradient id={`${uid}r`} cx="50%" cy="100%" r="55%">
          <stop offset="0" style={{ stopColor: light }} stopOpacity="0.55" />
          <stop offset="1" style={{ stopColor: light }} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${uid}e`} cx="38%" cy="32%" r="80%">
          <stop offset="0" stopColor="#5b4640" />
          <stop offset="1" stopColor="#1f1714" />
        </radialGradient>
        <linearGradient id={`${uid}l`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#b6f2b8" />
          <stop offset="1" stopColor="#4fb865" />
        </linearGradient>
        <linearGradient id={`${uid}m`} x1="1" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#6fd47e" />
          <stop offset="1" stopColor="#3ea857" />
        </linearGradient>
        <radialGradient id={`${uid}g`} cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor={statusColor} stopOpacity="0.5" />
          <stop offset="0.6" stopColor={statusColor} stopOpacity="0.16" />
          <stop offset="1" stopColor={statusColor} stopOpacity="0" />
        </radialGradient>
      </defs>

      {canInteract && <rect x="-8" y="-12" width="116" height="118" fill="transparent" />}

      {halo && <circle className="pebble-halo" cx="50" cy="56" r="66" fill={`url(#${uid}g)`} />}

      {/* ground shadow */}
      <ellipse className="pebble-shadow" cx="50" cy="94" rx="32" ry="4.2" fill="#5a3214" opacity="0.14" />

      <g ref={transRef} className="pebble-trans">
        <g ref={popRef} className="pebble-pop">
          <g className="pebble-body">
            {/* sprout */}
            <g transform={`translate(0 ${top - 14})`}>
              <g className="pebble-sprout">
                <path d="M50 21V8" stroke="#5fbf6e" strokeWidth="3.8" strokeLinecap="round" />
                <path d="M50 10C42 0 30 4 33 13C41 17 48 16 50 10Z" fill={`url(#${uid}l)`} />
                <path d="M50 10C58 0 70 4 67 13C59 17 52 16 50 10Z" fill={`url(#${uid}m)`} />
                <path d="M50 10C45 5.5 40 6.5 37.5 9.5" stroke="#fff" strokeOpacity="0.55" strokeWidth="1.2" strokeLinecap="round" fill="none" />
                <path d="M50 10C55 5.5 60 6.5 62.5 9.5" stroke="#fff" strokeOpacity="0.3" strokeWidth="1.2" strokeLinecap="round" fill="none" />
              </g>
            </g>

            {/* lower arms (nubs) */}
            <g fill={fill} stroke="#c46a3a" strokeOpacity="0.22" strokeWidth="1">
              <ellipse cx={50 - edge - 1} cy={armY + 2} rx="5.5" ry="8" transform={`rotate(18 ${50 - edge - 1} ${armY + 2})`} />
              {!raised && <ellipse cx={50 + edge + 1} cy={armY + 2} rx="5.5" ry="8" transform={`rotate(-18 ${50 + edge + 1} ${armY + 2})`} />}
            </g>

            {/* body: base colour, then volume (top light, bottom shade, bounce light) */}
            <path d={d} fill={fill} />
            <path d={d} fill={`url(#${uid}h)`} />
            <path d={d} fill={`url(#${uid}s)`} />
            <path d={d} fill={`url(#${uid}r)`} />
            <path d={d} fill="none" style={{ stroke: shade }} strokeOpacity="0.28" strokeWidth="1" />
            <ellipse cx="32" cy={top + 16} rx="9.5" ry="4.8" fill="#fff" opacity="0.42" transform={`rotate(-28 32 ${top + 16})`} />
            <ellipse cx="22" cy={top + 29} rx="2.4" ry="1.6" fill="#fff" opacity="0.4" transform={`rotate(-40 22 ${top + 29})`} />

            {/* raised hand (waiting_approval) */}
            {raised && (
              <g className="pebble-hand">
                <ellipse cx={50 + edge + 2} cy={eyeY - 4} rx="6.5" ry="13" fill={fill} stroke="#c46a3a" strokeOpacity="0.28" strokeWidth="1" transform={`rotate(-24 ${50 + edge + 2} ${eyeY - 4})`} />
                <ellipse cx={50 + edge + 4} cy={eyeY - 14} rx="2.4" ry="4" fill="#fff" opacity="0.5" transform={`rotate(-24 ${50 + edge + 4} ${eyeY - 14})`} />
              </g>
            )}

            {/* cheeks */}
            <g className="pebble-cheeks" fill="#ff7d6a" opacity={status === "thinking" || status === "done" ? 0.46 : 0.3}>
              <ellipse cx="25.5" cy={eyeY + 7} rx="6.4" ry="3.6" />
              <ellipse cx="74.5" cy={eyeY + 7} rx="6.4" ry="3.6" />
            </g>

            {eyeNode}
            {mouth}
          </g>
        </g>
      </g>

      {extras}
    </svg>
  );
}
